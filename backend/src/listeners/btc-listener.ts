import axios from 'axios';
import { prisma } from '../prisma.js';
import { creditDeposit } from '../services/depositService.js';
import { getUsdRate } from '../services/priceService.js';
import { Coin } from '@prisma/client';

// mempool.space is free, no API key, supports mainnet + testnet
const API_BASE: Record<string, string> = {
  btc_mainnet: 'https://mempool.space/api',
  btc_testnet: 'https://mempool.space/testnet/api',
};

// How many confirmations before crediting.
// 1 is fine for testnet; mainnet use 2-3 depending on your risk tolerance.
const MIN_CONFIRMATIONS: Record<string, number> = {
  btc_mainnet: 2,
  btc_testnet: 1,
};

async function axiosGetWithRetry(url: string, retries = 3, baseDelay = 2000): Promise<any> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await axios.get(url, { timeout: 10_000 });
    } catch (err: any) {
      if (attempt === retries) throw err;
      const status = err.response?.status;
      // Retry on 429 (Too Many Requests) or 5xx server errors, or network timeouts (!status)
      if (status === 429 || (status >= 500 && status < 600) || !status) {
        const delay = baseDelay * (2 ** attempt);
        console.warn(`[BTC] Rate limited or transient error for ${url}, retrying in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
      } else {
        throw err;
      }
    }
  }
}

async function getCurrentBlockHeight(base: string): Promise<number> {
  const { data } = await axiosGetWithRetry(`${base}/blocks/tip/height`);
  return parseInt(data, 10);
}

// USD rate now fetched from centralized priceService (Redis-cached + stale fallback)

async function checkAddress(
  address: string,
  userId: string,
  network: string,
  tipHeight: number,
) {
  const base = API_BASE[network];
  const minConf = MIN_CONFIRMATIONS[network];

  const { data: txs } = await axiosGetWithRetry(`${base}/address/${address}/txs`);
  if (!Array.isArray(txs) || txs.length === 0) return;

  for (const tx of txs) {
    if (!tx.status?.confirmed) continue;

    const conf = tipHeight - tx.status.block_height + 1;
    if (conf < minConf) continue;

    for (let voutIndex = 0; voutIndex < tx.vout.length; voutIndex++) {
      const vout = tx.vout[voutIndex];
      if (vout.scriptpubkey_address !== address) continue;

      const amountBTC = vout.value / 1e8;
      if (amountBTC <= 0) continue;

      // vout index disambiguates multiple outputs in same tx to same address
      const uniqueHash = `${tx.txid}:${voutIndex}`;
      const usdRate = await getUsdRate('BTC');
      const usdValue = amountBTC * usdRate;

      const deposit = await creditDeposit(
        uniqueHash,
        userId,
        'BTC' as Coin,
        network,
        amountBTC,
        usdValue,
      );

      if (deposit) {
        console.log(
          `[BTC/${network}] ✅ Credited ${amountBTC} BTC ($${usdValue.toFixed(2)}) → user ${userId} | tx: ${tx.txid}`,
        );
      }
    }
  }
}

async function poll(network: string) {
  const base = API_BASE[network];
  // Only poll for USER-role deposit addresses — skip MARKETERs
  const addresses = await prisma.depositAddress.findMany({
    where: {
      network,
      user: { role: 'USER' },
    },
    select: { address: true, userId: true },
  });

  if (addresses.length === 0) return;

  // Fetch tip height once per poll cycle — shared across all address checks
  const tipHeight = await getCurrentBlockHeight(base);

  // Process in chunks of 3 with a larger delay to respect mempool.space's free tier limits
  for (let i = 0; i < addresses.length; i += 3) {
    const chunk = addresses.slice(i, i + 3);
    const results = await Promise.allSettled(
      chunk.map(a => checkAddress(a.address, a.userId, network, tipHeight)),
    );

    results.forEach((res, idx) => {
      if (res.status === 'rejected') {
        const err = res.reason;
        const msg = err?.response?.data ? JSON.stringify(err.response.data) : (err?.message || String(err));
        console.error(`[BTC/${network}] checkAddress error (${chunk[idx].address}):`, msg);
      }
    });

    if (i + 3 < addresses.length) {
      await new Promise(r => setTimeout(r, 1500));
    }
  }
}

export function startBTCListener(network: string, intervalMs = 60_000) {
  if (!API_BASE[network]) throw new Error(`No API base for BTC network: ${network}`);
  console.log(`[BTC] Listener started on ${network} (every ${intervalMs / 1000}s)`);

  const run = async () => {
    try { await poll(network); }
    catch (err: any) {
      const msg = err?.response?.data ? JSON.stringify(err.response.data) : (err?.message || String(err));
      console.error(`[BTC/${network}] Poll error:`, msg);
    }
  };

  run();
  setInterval(run, intervalMs);
}
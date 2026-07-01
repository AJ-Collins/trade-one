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

async function getCurrentBlockHeight(base: string): Promise<number> {
  const { data } = await axios.get(`${base}/blocks/tip/height`, { timeout: 10_000 });
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

  const { data: txs } = await axios.get(`${base}/address/${address}/txs`, { timeout: 10_000 });
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

  // Process in chunks of 5 with a small delay to stay within rate limits
  for (let i = 0; i < addresses.length; i += 5) {
    const chunk = addresses.slice(i, i + 5);
    await Promise.allSettled(
      chunk.map(a => checkAddress(a.address, a.userId, network, tipHeight)),
    );
    if (i + 5 < addresses.length) {
      await new Promise(r => setTimeout(r, 300));
    }
  }
}

export function startBTCListener(network: string, intervalMs = 60_000) {
  if (!API_BASE[network]) throw new Error(`No API base for BTC network: ${network}`);
  console.log(`[BTC] Listener started on ${network} (every ${intervalMs / 1000}s)`);

  const run = async () => {
    try { await poll(network); }
    catch (err: any) { console.error(`[BTC/${network}] Poll error:`, err.message); }
  };

  run();
  setInterval(run, intervalMs);
}
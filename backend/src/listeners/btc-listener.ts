import axios from 'axios';
import { prisma } from '../prisma.js';
import { creditDeposit } from '../services/depositService.js';
import { getUsdRate } from '../services/priceService.js';
import { Coin } from '@prisma/client';

// Multiple public Esplora-compatible APIs. If one IP-bans or rate limits us,
// we instantly fall back to the next one in the list.
const BTC_APIS: Record<string, string[]> = {
  btc_mainnet: [
    'https://blockstream.info/api',
    'https://mempool.space/api',
    'https://mempool.emzy.de/api', // Public mirror
  ],
  btc_testnet: ['https://mempool.space/testnet/api'],
};

const activeApiIndex: Record<string, number> = {
  btc_mainnet: 0,
  btc_testnet: 0,
};

// How many confirmations before crediting.
// 1 is fine for testnet; mainnet use 2-3 depending on your risk tolerance.
const MIN_CONFIRMATIONS: Record<string, number> = {
  btc_mainnet: 2,
  btc_testnet: 1,
};

async function fetchWithFallback(network: string, endpoint: string): Promise<any> {
  const apis = BTC_APIS[network];
  if (!apis) throw new Error(`No APIs defined for ${network}`);

  let currentApi = activeApiIndex[network] ?? 0;
  
  for (let attempt = 0; attempt < apis.length; attempt++) {
    const base = apis[currentApi];
    const url = `${base}${endpoint}`;
    
    // Try the current API up to 2 times
    for (let retry = 0; retry < 2; retry++) {
      try {
        const res = await axios.get(url, { timeout: 10_000 });
        return res.data; // Success
      } catch (err: any) {
        const status = err.response?.status;
        // 429 = Rate Limit, 5xx = Server Error, undefined = Connection Drop (AggregateError)
        if (status === 429 || (status >= 500 && status < 600) || !status) {
           const delay = 2000 * (retry + 1);
           console.warn(`[BTC] Rate limited/transient error for ${base}. Retrying in ${delay}ms...`);
           await new Promise(r => setTimeout(r, delay));
           continue;
        }
        throw err; // Non-retryable error (e.g., 400 Bad Request)
      }
    }
    
    // If it failed 2 times on this API, rotate to the next one
    console.warn(`[BTC] API ${base} exhausted retries. Rotating to fallback provider.`);
    currentApi = (currentApi + 1) % apis.length;
    activeApiIndex[network] = currentApi;
  }
  
  throw new Error(`All BTC API providers failed for ${network}`);
}

async function getCurrentBlockHeight(network: string): Promise<number> {
  const data = await fetchWithFallback(network, '/blocks/tip/height');
  return parseInt(data, 10);
}

// USD rate now fetched from centralized priceService (Redis-cached + stale fallback)

async function checkAddress(
  address: string,
  userId: string,
  network: string,
  tipHeight: number,
) {
  const minConf = MIN_CONFIRMATIONS[network];

  const txs = await fetchWithFallback(network, `/address/${address}/txs`);
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
  const tipHeight = await getCurrentBlockHeight(network);

  // Process entirely sequentially to guarantee we never trip a 429 rate limit
  // across any of our fallback providers. A 600ms delay gives ~1.5 requests/sec max.
  for (const a of addresses) {
    try {
      await checkAddress(a.address, a.userId, network, tipHeight);
    } catch (err: any) {
      const msg = err?.response?.data ? JSON.stringify(err.response.data) : (err?.message || String(err));
      console.error(`[BTC/${network}] checkAddress error (${a.address}):`, msg);
    }
    // Small delay between every single address query to preserve API health
    await new Promise(r => setTimeout(r, 600));
  }
}

export function startBTCListener(network: string, intervalMs = 60_000) {
  if (!BTC_APIS[network]) throw new Error(`No API base for BTC network: ${network}`);
  console.log(`[BTC] Listener started on ${network} (every ${intervalMs / 1000}s)`);

  let isRunning = false;
  
  const run = async () => {
    // Concurrency lock: since we process sequentially, if the list of addresses
    // grows large enough that it takes longer than intervalMs to scan them all,
    // this lock prevents overlapping scans from stacking up and blasting the API.
    if (isRunning) return;
    isRunning = true;
    
    try { 
      await poll(network); 
    } catch (err: any) {
      const msg = err?.response?.data ? JSON.stringify(err.response.data) : (err?.message || String(err));
      console.error(`[BTC/${network}] Poll error:`, msg);
    } finally {
      isRunning = false;
    }
  };

  run();
  setInterval(run, intervalMs);
}
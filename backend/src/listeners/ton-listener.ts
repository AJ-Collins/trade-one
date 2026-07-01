import axios from 'axios';
import { prisma } from '../prisma.js';
import { creditDeposit } from '../services/depositService.js';
import { getUsdRate } from '../services/priceService.js';
import { Coin } from '@prisma/client';

// Toncenter free tier — get a free key at https://toncenter.com (no CC required)
const TONCENTER_BASE = process.env.TONCENTER_API_URL || 'https://toncenter.com/api/v2';
const TONCENTER_KEY  = process.env.TONCENTER_API_KEY  || '';

// USD rate now fetched from centralized priceService (Redis-cached + stale fallback)

async function checkAddress(address: string, userId: string) {
  const headers = TONCENTER_KEY ? { 'X-API-Key': TONCENTER_KEY } : {};

  const { data } = await axios.get(`${TONCENTER_BASE}/getTransactions`, {
    params: { address, limit: 20, archival: false },
    headers,
    timeout: 10_000,
  });

  const txs: any[] = data.result ?? [];

  for (const tx of txs) {
    const inMsg = tx.in_msg;
    // Only inbound messages with a non-zero value
    if (!inMsg?.value || inMsg.value === '0') continue;

    // Skip if source is empty — these are contract-generated internal messages
    // (e.g. excess refunds). A real user deposit has a proper source address.
    if (!inMsg.source) continue;

    const amountTON = parseInt(inMsg.value, 10) / 1e9; // nanotons → TON
    if (amountTON <= 0) continue;

    // TON unique identifier: logical time + hash (LT is per-account monotonic)
    const txHash = `${tx.transaction_id.lt}:${tx.transaction_id.hash}`;

    const usdRate  = await getUsdRate('TON');
    const usdValue = amountTON * usdRate;

    const deposit = await creditDeposit(
      txHash,
      userId,
      'TON' as Coin,
      'ton_mainnet',
      amountTON,
      usdValue,
    );

    if (deposit) {
      console.log(
        `[TON] ✅ Credited ${amountTON} TON ($${usdValue.toFixed(2)}) → user ${userId} | lt: ${tx.transaction_id.lt}`,
      );
    }
  }
}

async function poll() {
  // Only poll for USER-role deposit addresses — skip MARKETERs
  const addresses = await prisma.depositAddress.findMany({
    where: {
      network: 'ton_mainnet',
      user: { role: 'USER' },
    },
    select: { address: true, userId: true },
  });

  if (addresses.length === 0) return;

  // Toncenter free tier is ~1 req/s — process in small chunks
  for (let i = 0; i < addresses.length; i += 3) {
    const chunk = addresses.slice(i, i + 3);
    await Promise.allSettled(chunk.map(a => checkAddress(a.address, a.userId)));
    if (i + 3 < addresses.length) {
      await new Promise(r => setTimeout(r, 1_000));
    }
  }
}

export function startTONListener(intervalMs = 30_000) {
  console.log('[TON] Listener started');

  const run = async () => {
    try { await poll(); }
    catch (err: any) { console.error('[TON] Poll error:', err.message); }
  };

  run();
  setInterval(run, intervalMs);
}
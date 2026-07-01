import axios from 'axios';
import { prisma } from '../prisma.js';
import { creditDeposit } from '../services/depositService.js';
import { getUsdRate } from '../services/priceService.js';
import { Coin } from '@prisma/client';

// TronGrid free tier — get a key at https://www.trongrid.io (no CC required)
const TRONGRID_BASE = 'https://api.trongrid.io';
const TRONGRID_KEY  = process.env.TRONGRID_API_KEY || '';

async function checkAddress(address: string, userId: string) {
  const headers: Record<string, string> = TRONGRID_KEY
    ? { 'TRON-PRO-API-KEY': TRONGRID_KEY }
    : {};

  const { data } = await axios.get(
    `${TRONGRID_BASE}/v1/accounts/${address}/transactions`,
    {
      params: { limit: 20, only_confirmed: true, only_to: true },
      headers,
      timeout: 10_000,
    },
  );

  const txs: any[] = data.data ?? [];

  for (const tx of txs) {
    if (tx.ret?.[0]?.contractRet !== 'SUCCESS') continue;

    const contract = tx.raw_data?.contract?.[0];
    if (!contract || contract.type !== 'TransferContract') continue;

    const value = contract.parameter?.value;
    if (!value) continue;

    // only_to=true should handle this, but double-check
    if (value.to_address !== address) continue;

    const amountTRX = value.amount / 1e6; // sun → TRX
    if (amountTRX <= 0) continue;

    const txHash: string = tx.txID;
    const usdRate  = await getUsdRate('TRX');
    const usdValue = amountTRX * usdRate;

    const deposit = await creditDeposit(
      txHash,
      userId,
      'TRX' as Coin,
      'tron_mainnet',
      amountTRX,
      usdValue,
    );

    if (deposit) {
      console.log(
        `[TRX] ✅ Credited ${amountTRX} TRX ($${usdValue.toFixed(2)}) → user ${userId} | tx: ${txHash}`,
      );
    }
  }
}

const USDT_TRC20_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'; // mainnet USDT

async function checkTRC20(address: string, userId: string) {
  const headers: Record<string, string> = TRONGRID_KEY
    ? { 'TRON-PRO-API-KEY': TRONGRID_KEY }
    : {};

  const { data } = await axios.get(
    `${TRONGRID_BASE}/v1/accounts/${address}/transactions/trc20`,
    { params: { limit: 20, contract_address: USDT_TRC20_CONTRACT, only_confirmed: true }, headers, timeout: 10_000 },
  );
  const txs: any[] = data.data ?? [];
  for (const tx of txs) {
    if (tx.to !== address) continue;          // only inbound
    const amountUSDT = parseInt(tx.value, 10) / 1e6;  // USDT-TRC20 uses 6 decimals
    if (amountUSDT <= 0) continue;
    const usdValue = amountUSDT; // 1:1
    const deposit = await creditDeposit(tx.transaction_id, userId, 'USDT' as Coin, 'tron_mainnet', amountUSDT, usdValue);
    if (deposit) {
      console.log(`[TRC20] ✅ Credited ${amountUSDT} USDT → user ${userId} | tx: ${tx.transaction_id}`);
    }
  }
}

async function poll() {
  // Only poll for USER-role deposit addresses — skip MARKETERs
  const addresses = await prisma.depositAddress.findMany({
    where: {
      network: 'tron_mainnet',
      user: { role: 'USER' },
    },
    select: { address: true, userId: true, coin: true },
  });

  if (addresses.length === 0) return;

  for (let i = 0; i < addresses.length; i += 3) {
    const chunk = addresses.slice(i, i + 3);
    await Promise.allSettled(chunk.flatMap(a => {
      const tasks = [checkAddress(a.address, a.userId)];
      // Also check for TRC20 USDT deposits for addresses that watch USDT
      if (a.coin === 'USDT' || a.coin === 'TRX') {
        tasks.push(checkTRC20(a.address, a.userId));
      }
      return tasks;
    }));
    if (i + 3 < addresses.length) {
      await new Promise(r => setTimeout(r, 500));
    }
  }
}

export function startTronListener(intervalMs = 15_000) {
  console.log('[TRX] Listener started');

  const run = async () => {
    try { await poll(); }
    catch (err: any) { console.error('[TRX] Poll error:', err.message); }
  };

  run();
  setInterval(run, intervalMs);
}
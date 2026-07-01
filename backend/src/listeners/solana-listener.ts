import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { prisma } from '../prisma.js';
import { creditDeposit } from '../services/depositService.js';
import { getUsdRate } from '../services/priceService.js';
import { Coin } from '@prisma/client';

// Helius free tier: 100k credits/day, no CC required — sign up at helius.dev
// Falls back to public mainnet RPC if env var is missing (rate-limited, dev only)
const RPC = process.env.HELIUS_RPC_URL || 'https://api.mainnet-beta.solana.com';

// USD rate now fetched from centralized priceService (Redis-cached + stale fallback)

async function checkAddress(
  address: string,
  userId: string,
  connection: Connection,
) {
  const pubkey = new PublicKey(address);

  // Last 20 finalized signatures for this address
  const signatures = await connection.getSignaturesForAddress(pubkey, { limit: 20 }, 'finalized');

  for (const sigInfo of signatures) {
    // Skip failed or unfinalized transactions
    if (sigInfo.err || sigInfo.confirmationStatus !== 'finalized') continue;

    const tx = await connection.getTransaction(sigInfo.signature, {
      commitment: 'finalized',
      maxSupportedTransactionVersion: 0,
    });
    if (!tx?.meta) continue;

    // Resolve account keys — works for both legacy and versioned transactions
    const message = tx.transaction.message;
    const accountKeys = 'getAccountKeys' in message
      ? message.getAccountKeys().staticAccountKeys
      : (message as any).accountKeys as PublicKey[];

    const addrIndex = accountKeys.findIndex(k => k.toBase58() === address);
    if (addrIndex === -1) continue;

    const preBalance = tx.meta.preBalances[addrIndex] ?? 0;
    const postBalance = tx.meta.postBalances[addrIndex] ?? 0;
    const deltaLamports = postBalance - preBalance;

    // Only credit inbound transfers (positive delta)
    if (deltaLamports <= 0) continue;

    const amountSOL = deltaLamports / LAMPORTS_PER_SOL;
    const usdRate = await getUsdRate('SOL');
    const usdValue = amountSOL * usdRate;

    const deposit = await creditDeposit(
      sigInfo.signature,
      userId,
      'SOL' as Coin,
      'solana_mainnet',
      amountSOL,
      usdValue,
    );

    if (deposit) {
      console.log(
        `[SOL] ✅ Credited ${amountSOL} SOL ($${usdValue.toFixed(2)}) → user ${userId} | sig: ${sigInfo.signature}`,
      );
    }
  }
}

async function poll(connection: Connection) {
  // Only poll for USER-role deposit addresses — skip MARKETERs
  const addresses = await prisma.depositAddress.findMany({
    where: {
      network: 'solana_mainnet',
      user: { role: 'USER' },
    },
    select: { address: true, userId: true },
  });

  if (addresses.length === 0) return;

  for (let i = 0; i < addresses.length; i += 5) {
    const chunk = addresses.slice(i, i + 5);
    await Promise.allSettled(chunk.map(a => checkAddress(a.address, a.userId, connection)));
    if (i + 5 < addresses.length) {
      await new Promise(r => setTimeout(r, 500));
    }
  }
}

export function startSolanaListener(intervalMs = 15_000) {
  // 'finalized' commitment = ~32 slots, confirmed = ~2 slots.
  // Use 'finalized' for deposits to avoid crediting rolled-back txs.
  const connection = new Connection(RPC, 'finalized');
  console.log(`[SOL] Listener started (every ${intervalMs / 1000}s) — RPC: ${RPC}`);

  const run = async () => {
    try { await poll(connection); }
    catch (err: any) { console.error('[SOL] Poll error:', err.message); }
  };

  run();
  setInterval(run, intervalMs);
}
import { Coin } from '@prisma/client';
import { Worker, Job } from 'bullmq';
import { ethers } from 'ethers';
import { redis } from '../lib/redis.js';
import { prisma } from '../prisma.js';
import { creditDeposit } from '../services/depositService.js';
import { getUsdRate } from '../services/priceService.js';
import { getConfig } from '../utils/configLoader.js';
import {
  NATIVE_COIN,
  getStablecoinContracts,
  NETWORK_RPC_CONFIG_KEY,
  SupportedNetwork,
} from '../config/networks.js';
import { DEPOSIT_QUEUE_NAME, DepositActivityJob } from '../queues/depositQueue.js';

const MIN_CONFIRMATIONS: Record<SupportedNetwork, number> = {
  eth_mainnet:      12,
  bsc_mainnet:      15,
  polygon_mainnet:  64,
  arbitrum_mainnet: 1,
  btc_mainnet:      2,
  solana_mainnet:   30,
  ton_mainnet:      3,
  tron_mainnet:     20,
};

async function resolveCoinForActivity(activity: any, network: SupportedNetwork) {
  const contractAddress: string | undefined = activity.rawContract?.address?.toLowerCase();

  if (!contractAddress) {
    return { coin: NATIVE_COIN[network], decimals: 18 };
  }

  const contracts = await getStablecoinContracts(network);
  const known = contracts[contractAddress];
  if (!known) {
    console.warn(
      `[DepositWorker] Unrecognized contract ${contractAddress} on ${network} (asset: ${activity.asset})`
    );
    return null;
  }
  return { coin: known.symbol, decimals: known.decimals };
}

function resolveAmount(activity: any, expectedDecimals: number): number | null {
  const decodedValue: number | undefined = activity.value;
  const rawHexValue: string | undefined = activity.rawContract?.value;
  const reportedDecimals: number | undefined = activity.rawContract?.decimals;

  if (typeof decodedValue !== 'number' || decodedValue <= 0) return null;

  if (typeof reportedDecimals === 'number' && reportedDecimals !== expectedDecimals) {
    console.error(`[DepositWorker] Decimals mismatch: expected ${expectedDecimals}, got ${reportedDecimals}`);
    return null;
  }

  if (rawHexValue) {
    try {
      const raw = BigInt(rawHexValue);
      const recomputed = Number(raw) / 10 ** expectedDecimals;
      if (Math.abs(recomputed - decodedValue) / Math.max(decodedValue, 1e-9) > 0.0001) {
        console.error(`[DepositWorker] Value mismatch: decoded=${decodedValue} recomputed=${recomputed}`);
        return null;
      }
    } catch {
      // Unparseable rawContract.value — fall back to trusting decodedValue.
    }
  }

  return decodedValue;
}

/**
 * Fetch the LIVE confirmation count from the chain via RPC.
 * Used on retries (attemptsMade > 0) because the Alchemy webhook payload
 * contains a frozen confirmation count from the moment the webhook was fired,
 * which never increases on BullMQ retries.
 */
async function getLiveConfirmations(
  txHash: string,
  network: SupportedNetwork,
): Promise<number | null> {
  const rpcConfigKey = NETWORK_RPC_CONFIG_KEY[network];
  if (!rpcConfigKey) return null;

  const rpcUrl = await getConfig(rpcConfigKey);
  if (!rpcUrl) return null;

  try {
    const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt?.blockNumber) return null;

    const currentBlock = await provider.getBlockNumber();
    return currentBlock - receipt.blockNumber + 1;
  } catch (err: any) {
    console.warn(`[DepositWorker] RPC confirmation check failed for ${txHash}:`, err.message);
    return null;
  }
}

async function processActivity(job: Job<DepositActivityJob>) {
  const { network, activity } = job.data;
  const internalNetwork = network as SupportedNetwork;

  if (activity.fromAddress === activity.toAddress) return;
  const toAddr: string | undefined = activity.toAddress?.toLowerCase();
  if (!toAddr) return;

  const depositAddress = await prisma.depositAddress.findFirst({
    where: { address: { equals: toAddr, mode: 'insensitive' }, network: internalNetwork },
    include: { user: { select: { role: true } } },
  });
  if (!depositAddress) return;

  // Only process deposits for USER role — do not touch MARKETER logic
  if (depositAddress.user.role !== 'USER') return;

  // ── Confirmation check ─────────────────────────────────────────────────
  // On the first attempt, use the webhook payload's confirmation count.
  // On retries (attemptsMade > 0), fetch the LIVE count from the chain
  // because the webhook payload is frozen and never updates.
  let confirmations: number = activity.confirmations ?? 0;
  const txHash: string = activity.hash;
  const minRequired = MIN_CONFIRMATIONS[internalNetwork];

  if (job.attemptsMade > 0 && txHash) {
    const liveConfs = await getLiveConfirmations(txHash, internalNetwork);
    if (liveConfs !== null) {
      confirmations = liveConfs;
      console.log(
        `[DepositWorker] Retry #${job.attemptsMade}: live confirmations for ${txHash} = ${confirmations}/${minRequired}`
      );
    }
  }

  if (confirmations < minRequired) {
    // Throwing here triggers BullMQ's retry/backoff instead of silently dropping —
    // on the next retry we'll re-fetch the live confirmation count from the chain.
    throw new Error(
      `tx ${txHash} has ${confirmations}/${minRequired} confirmations on ${internalNetwork} — retrying`
    );
  }

  const resolved = await resolveCoinForActivity(activity, internalNetwork);
  if (!resolved) return; // unrecognized contract — not a transient failure, don't retry

  const value = resolveAmount(activity, resolved.decimals);
  if (value === null) return; // bad/inconsistent amount — don't retry, log already happened

  if (!txHash) return;

  const usdRate = await getUsdRate(resolved.coin); // throws -> job retries automatically
  const usdValue = value * usdRate;

  console.log(
    `[DepositWorker] Deposit: ${value} ${resolved.coin} → user ${depositAddress.userId} | $${usdValue.toFixed(2)} | tx: ${txHash}`
  );

  const coinType = resolved.coin as Coin;
  const deposit = await creditDeposit(
    txHash,
    depositAddress.userId,
    coinType,
    internalNetwork,
    value,
    usdValue,
    depositAddress.id, // pass the ID directly so creditDeposit doesn't need to re-lookup
  );

  if (deposit) {
    console.log(`[DepositWorker] Credited $${usdValue.toFixed(2)} to user ${depositAddress.userId}`);
  } else {
    console.log(`[DepositWorker] tx ${txHash} already credited — skipped`);
  }
}

// Concurrency: how many activities this worker processes in parallel.
// Tune based on your DB connection pool size — don't set this higher than
// (pool size / number of worker processes), or you'll exhaust connections
// under load instead of actually scaling throughput.
const CONCURRENCY = Number(process.env.DEPOSIT_WORKER_CONCURRENCY || 10);

export const depositWorker = new Worker<DepositActivityJob>(
  DEPOSIT_QUEUE_NAME,
  processActivity,
  {
    connection: redis,
    concurrency: CONCURRENCY,
    limiter: {
      // Cap CoinGecko/DB pressure under a burst of webhook deliveries.
      max: 50,
      duration: 1000, // 50 jobs/sec max across this worker
    },
  }
);

depositWorker.on('completed', (job) => {
  console.log(`[DepositWorker] Job ${job.id} completed`);
});

depositWorker.on('failed', (job, err) => {
  console.error(`[DepositWorker] Job ${job?.id} failed after ${job?.attemptsMade} attempts:`, err.message);
  // After all retries are exhausted, this job sits in the failed set (removeOnFail age: 1 day).
  // Wire up alerting here (Slack/PagerDuty) so a permanently-stuck deposit doesn't go unnoticed.
});

process.on('SIGTERM', async () => {
  console.log('[DepositWorker] Shutting down gracefully...');
  await depositWorker.close();
  process.exit(0);
});
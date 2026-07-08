import { ethers } from 'ethers';
import { prisma } from '../prisma.js';
import { getConfig, setConfig } from '../utils/configLoader.js';
import {
  getStablecoinContracts,
  NETWORK_RPC_CONFIG_KEY,
  SupportedNetwork,
} from '../config/networks.js';
import { creditDeposit } from '../services/depositService.js';
import { getUsdRate } from '../services/priceService.js';
import { Coin } from '@prisma/client';

const TRANSFER_TOPIC = ethers.utils.id('Transfer(address,address,uint256)');

const GETLOGS_CHUNK_SIZE = 10;

async function getLogsChunked(
  provider: ethers.providers.JsonRpcProvider,
  params: { address: string; topics: (string | string[] | null)[] },
  fromBlock: number,
  toBlock: number,
): Promise<ethers.providers.Log[]> {
  const allLogs: ethers.providers.Log[] = [];
  for (let start = fromBlock; start <= toBlock; start += GETLOGS_CHUNK_SIZE) {
    const end = Math.min(start + GETLOGS_CHUNK_SIZE - 1, toBlock);
    const logs = await provider.getLogs({
      fromBlock: start,
      toBlock: end,
      address: params.address,
      topics: params.topics,
    });
    allLogs.push(...logs);
  }
  return allLogs;
}


// Mirrors MIN_CONFIRMATIONS in depositWorker.ts — this poller only needs to
// be "safe enough", not identical, since creditDeposit() dedupes on txHash
// regardless of which path (webhook or poller) gets there first.
const CONFIRMATION_LAG: Partial<Record<SupportedNetwork, number>> = {
  eth_mainnet:      12,
  polygon_mainnet:  64,
  arbitrum_mainnet: 1,
};

// How many blocks to request per getLogs call. Kept narrow to avoid Alchemy
// response-size limits. The catch-up loop in pollEVMOnce() repeats this up to
// MAX_BATCHES_PER_CYCLE times per invocation so fast chains actually catch up.
const BATCH_SIZE: Partial<Record<SupportedNetwork, number>> = {
  eth_mainnet:      20,
  polygon_mainnet:  50,
  arbitrum_mainnet: 50,
};

// Safety cap: don't let a single pollEVMOnce() call loop forever if the chain
// is massively behind (e.g. after a long downtime). 20 batches × 50 blocks =
// 1 000 Arbitrum blocks = ~4 min of chain time caught up in one cycle.
const MAX_BATCHES_PER_CYCLE = 20;

// Track "running" per network independently so one slow chain doesn't block another.
const runningFlags: Record<string, boolean> = {};

/**
 * Processes one batch of blocks for the given network. Returns true when the
 * cursor has reached the safe chain head (i.e. caller should stop looping).
 *
 * NOTE: This is intentionally token-only (USDT/USDC via getLogs). Native-coin
 * transfers (ETH/MATIC) are deliberately excluded — getBlockWithTransactions
 * over hundreds of Arbitrum/Polygon blocks per cycle would burn through Alchemy
 * RPC quota fast, and the actual missed-deposit problem was a USDT webhook drop,
 * not native-coin. If native coverage is later needed, it should be added only
 * for eth_mainnet where block volume is manageable.
 */
async function pollOneBatch(
  network: SupportedNetwork,
  provider: ethers.providers.JsonRpcProvider,
  watchMap: Map<string, { id: string; userId: string; address: string }>,
  addressTopics: string[],
  lastBlockKey: string,
  batchSize: number,
  confirmationLag: number,
): Promise<boolean /* caughtUp */> {
  const latest = await provider.getBlockNumber();
  const safeHead = latest - confirmationLag;

  const storedLast = await getConfig(lastBlockKey);
  // First run: start at current safe head — don't retroactively backfill history
  const fromBlock = storedLast ? Number(storedLast) + 1 : safeHead;
  const toBlock = Math.min(safeHead, fromBlock + batchSize - 1);

  if (toBlock < fromBlock) return true; // already at head — nothing to do

  console.log(`[EVM Poller/${network}] Scanning blocks ${fromBlock}–${toBlock}`);

  // --- ERC-20 (USDT/USDC) transfers only ---
  const contracts = await getStablecoinContracts(network);

  for (const contractAddr of Object.keys(contracts)) {
    const logs = await getLogsChunked(
      provider,
      { address: contractAddr, topics: [TRANSFER_TOPIC, null, addressTopics] },
      fromBlock,
      toBlock,
    );

    for (const log of logs) {
      const to = ethers.utils.getAddress('0x' + log.topics[2].slice(26)).toLowerCase();
      const match = watchMap.get(to);
      if (!match) continue;

      const token = contracts[log.address.toLowerCase()];
      const rawValue = BigInt(log.data);
      const amount = Number(ethers.utils.formatUnits(rawValue, token.decimals));
      if (amount <= 0) continue;

      // logIndex is from the chain directly via getLogs — always reliable,
      // unlike the Alchemy webhook payload for AA-bundled txs where logIndex
      // may be missing or duplicated across activities.
      try {
        const usdRate = await getUsdRate(token.symbol);
        const usdValue = amount * usdRate;

        const deposit = await creditDeposit(
          log.transactionHash,
          match.userId,
          token.symbol as Coin,
          network,
          amount,
          usdValue,
          match.id,
        );

        if (deposit) {
          console.log(
            `[EVM Poller/${network}] ✅ Credited ${amount} ${token.symbol}` +
            ` ($${usdValue.toFixed(2)}) → user ${match.userId}` +
            ` | tx: ${log.transactionHash} (backfilled — webhook likely missed it)`
          );
        }
        // null = creditDeposit's txHash dedupe already caught it — expected
        // steady-state whenever the webhook path worked fine.
      } catch (err: any) {
        console.error(
          `[EVM Poller/${network}] Credit error for ${log.transactionHash}:`,
          err.message
        );
      }
    }
  }

  await setConfig(lastBlockKey, String(toBlock));

  // Return whether we've reached the safe head so the caller can stop looping.
  return toBlock >= safeHead;
}

/**
 * Redundant safety-net poller for any Alchemy-managed EVM network. Alchemy
 * webhooks (src/webhooks/alchemyWebhook.ts) are the primary path; this exists
 * purely to catch deposits dropped by webhook payload edge cases — e.g.
 * AA-bundled txs with multiple Transfer logs missing logIndex (see the
 * jobId dedupe fallback in enqueueDepositActivity).
 *
 * Safe to run alongside the webhook path: creditDeposit() is idempotent on
 * txHash, so a deposit already credited via webhook is a silent no-op here.
 *
 * Loops through up to MAX_BATCHES_PER_CYCLE batches per invocation so fast
 * chains (Arbitrum ~0.25s/block, Polygon ~2s/block) don't fall progressively
 * further behind on a fixed 50-block window.
 */
export async function pollEVMOnce(network: SupportedNetwork) {
  if (runningFlags[network]) return;
  runningFlags[network] = true;

  // e.g. ETH_MAINNET_POLLER_LAST_BLOCK — network-specific, never shared across chains
  const lastBlockKey = `${network.toUpperCase()}_POLLER_LAST_BLOCK`;
  const confirmationLag = CONFIRMATION_LAG[network] ?? 12;
  const batchSize = BATCH_SIZE[network] ?? 20;

  try {
    const rpcConfigKey = NETWORK_RPC_CONFIG_KEY[network];
    if (!rpcConfigKey) {
      console.warn(`[EVM Poller/${network}] No RPC config key mapped — skipping`);
      return;
    }

    const rpcUrl = await getConfig(rpcConfigKey);
    if (!rpcUrl) {
      console.warn(`[EVM Poller/${network}] No RPC URL configured — skipping`);
      return;
    }

    const provider = new ethers.providers.JsonRpcProvider(rpcUrl);

    // Only credit deposits for real USER accounts — mirrors the role check in
    // depositWorker.ts and every other poller (bsc-poller, btc-listener, etc.).
    // Without this filter the poller would credit MARKETER-role deposits that
    // the webhook path deliberately skips.
    const watched = await prisma.depositAddress.findMany({
      where: { network, user: { role: 'USER' } },
      select: { id: true, userId: true, address: true },
    });
    if (watched.length === 0) return;

    const watchMap = new Map(watched.map(w => [w.address.toLowerCase(), w]));
    const addressTopics = watched.map(w =>
      ethers.utils.hexZeroPad(w.address, 32).toLowerCase()
    );

    // Catch-up loop — runs multiple batches in one invocation so fast chains
    // (Arbitrum/Polygon) don't accumulate an unbounded lag between cycles.
    for (let i = 0; i < MAX_BATCHES_PER_CYCLE; i++) {
      const caughtUp = await pollOneBatch(
        network,
        provider,
        watchMap,
        addressTopics,
        lastBlockKey,
        batchSize,
        confirmationLag,
      );
      if (caughtUp) break;
    }
  } catch (err: any) {
    console.error(`[EVM Poller/${network}] Cycle failed:`, err.message);
  } finally {
    runningFlags[network] = false;
  }
}

/**
 * Starts a fallback poller for one network. Interval defaults to 3 min —
 * this is a safety net, not the primary path, so it doesn't need to be fast
 * and shouldn't chew through Alchemy RPC quota.
 */
export function startEVMPoller(network: SupportedNetwork, intervalMs = 180_000) {
  console.log(
    `[EVM Poller/${network}] Started as webhook fallback (every ${intervalMs / 1000}s)`
  );
  pollEVMOnce(network);
  setInterval(() => pollEVMOnce(network), intervalMs);
}

/**
 * Convenience helper — starts fallback pollers for every Alchemy-managed
 * mainnet in one call. Intervals are staggered slightly so they don't all
 * hit the RPC provider in the same tick.
 *
 * bsc_mainnet is intentionally excluded: it already has its own primary
 * poller (bsc-poller.ts) and doesn't use Alchemy webhooks.
 */
export function startAllEVMFallbackPollers() {
  startEVMPoller('eth_mainnet',      180_000);
  startEVMPoller('polygon_mainnet',  185_000);
  startEVMPoller('arbitrum_mainnet', 190_000);
}

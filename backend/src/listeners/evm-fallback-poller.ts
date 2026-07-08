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

// --- Retry-with-backoff for transient RPC errors ---------------------------
// Alchemy occasionally returns 503 "Unable to complete request at this time"
// for an otherwise-valid eth_getLogs call. Previously a single stuck chunk
// would make the *whole* pollOneBatch() throw, which meant setConfig() never
// ran and the cursor sat frozen on that exact range every cycle until the
// transient error happened to clear on its own (observed: same block range
// failing across two consecutive 90s cycles). Retrying a few times with
// backoff inside the chunk loop resolves the overwhelming majority of these
// within seconds, so the cursor keeps moving instead of stalling for cycles.
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const MAX_RETRIES_PER_CHUNK = 4;
const RETRY_BASE_DELAY_MS = 1000; // 1s, 2s, 4s, 8s

function isRetryableRpcError(err: any): boolean {
  if (err?.code === 'SERVER_ERROR' || err?.code === 'TIMEOUT' || err?.code === 'NETWORK_ERROR') return true;
  const status = err?.status ?? err?.error?.status;
  if (status && RETRYABLE_STATUS_CODES.has(Number(status))) return true;
  // ethers wraps the raw response text/body — some providers only surface
  // the status inside that string rather than as a top-level field.
  const bodyText: string = err?.body ?? err?.error?.body ?? '';
  if (typeof bodyText === 'string' && /"?status"?\s*[:=]\s*"?(429|500|502|503|504)"?/.test(bodyText)) return true;
  return false;
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getLogsWithRetry(
  provider: ethers.providers.JsonRpcProvider,
  params: { address: string; topics: (string | string[] | null)[]; fromBlock: number; toBlock: number },
): Promise<ethers.providers.Log[]> {
  let lastErr: any;
  for (let attempt = 0; attempt <= MAX_RETRIES_PER_CHUNK; attempt++) {
    try {
      return await provider.getLogs(params);
    } catch (err: any) {
      lastErr = err;
      if (!isRetryableRpcError(err) || attempt === MAX_RETRIES_PER_CHUNK) throw err;
      const delay = RETRY_BASE_DELAY_MS * 2 ** attempt;
      console.warn(
        `[EVM Poller] Transient RPC error on blocks ${params.fromBlock}-${params.toBlock}` +
        ` (attempt ${attempt + 1}/${MAX_RETRIES_PER_CHUNK + 1}), retrying in ${delay}ms: ${err.message}`
      );
      await sleep(delay);
    }
  }
  throw lastErr;
}

// Detects Alchemy's "too many results" error specifically — distinct from
// the transient 5xx/429 errors already handled by isRetryableRpcError.
function isResponseTooLargeError(err: any): boolean {
  const msg = (err?.message ?? err?.error?.message ?? '').toLowerCase();
  return (
    msg.includes('response size exceeded') ||
    msg.includes('query returned more than') ||
    (msg.includes('block range') && msg.includes('limit'))
  );
}

// Adaptive getLogs: tries the full range in one call. On a genuine "too
// many results" error, halves the range and recurses — so most batches cost
// ONE RPC call instead of many sequential chunks, and we only pay the split
// cost on the rare batch that's actually dense with matching transfers.
async function getLogsAdaptive(
  provider: ethers.providers.JsonRpcProvider,
  params: { address: string; topics: (string | string[] | null)[] },
  fromBlock: number,
  toBlock: number,
): Promise<ethers.providers.Log[]> {
  try {
    return await getLogsWithRetry(provider, { ...params, fromBlock, toBlock });
  } catch (err: any) {
    if (isResponseTooLargeError(err) && toBlock > fromBlock) {
      const mid = fromBlock + Math.floor((toBlock - fromBlock) / 2);
      const [left, right] = await Promise.all([
        getLogsAdaptive(provider, params, fromBlock, mid),
        getLogsAdaptive(provider, params, mid + 1, toBlock),
      ]);
      return [...left, ...right];
    }
    throw err;
  }
}


// Mirrors MIN_CONFIRMATIONS in depositWorker.ts — this poller only needs to
// be "safe enough", not identical, since creditDeposit() dedupes on txHash
// regardless of which path (webhook or poller) gets there first.
const CONFIRMATION_LAG: Partial<Record<SupportedNetwork, number>> = {
  eth_mainnet: 12,
  polygon_mainnet: 64,
  arbitrum_mainnet: 1,
};

// How many blocks per getLogs batch. With getLogsAdaptive each batch costs
// ~1 RPC call per contract regardless of width (automatic binary-split on
// "response too large"), so wider ranges are safe and dramatically improve
// throughput on fast chains like Arbitrum (~4 blocks/sec).
const BATCH_SIZE: Partial<Record<SupportedNetwork, number>> = {
  eth_mainnet: 100,   // ~12 sec/block → 100 blocks ≈ 20 min
  polygon_mainnet: 200,   //  ~2 sec/block → 200 blocks ≈  7 min
  arbitrum_mainnet: 500,   // ~0.25s/block  → 500 blocks ≈  2 min
};

// Safety cap: don't let a single pollEVMOnce() call loop forever if the chain
// is massively behind (e.g. after a long downtime). 20 batches × 500 blocks =
// 10 000 Arbitrum blocks ≈ 42 min of chain time caught up in one cycle.
// Since Arbitrum produces ~760 blocks during the 190s interval, the poller
// gains ~9 240 blocks per cycle — any realistic lag cleared in one pass.
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
    // Alchemy's Free Tier strictly limits eth_getLogs to a 10-block range if the
    // query contains an OR condition (an array of addresses) in the topics filter.
    // By omitting `addressTopics` and just querying for ALL transfers on the
    // stablecoin contract, we bypass the 10-block limit (allowing 500+ blocks).
    // The logs are then filtered locally in memory instantly via watchMap.
    const logs = await getLogsAdaptive(
      provider,
      { address: contractAddr, topics: [TRANSFER_TOPIC] },
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
 *
 * Retry note: transient 5xx/429 RPC errors are retried with backoff inside
 * getLogsAdaptive (see getLogsWithRetry above) so a single flaky range no
 * longer stalls the cursor on the same range for multiple whole cycles —
 * it resolves within one invocation the vast majority of the time. If a
 * range still fails after all retries, the error propagates up and the
 * cycle fails cleanly (same as before): the cursor does NOT advance past
 * unprocessed blocks, so nothing gets silently skipped, and the next
 * scheduled cycle picks up from the same spot.
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

    // Catch-up loop — runs multiple batches in one invocation so fast chains
    // (Arbitrum/Polygon) don't accumulate an unbounded lag between cycles.
    for (let i = 0; i < MAX_BATCHES_PER_CYCLE; i++) {
      const caughtUp = await pollOneBatch(
        network,
        provider,
        watchMap,
        lastBlockKey,
        batchSize,
        confirmationLag,
      );
      if (caughtUp) break;

      // Surface visibility if the poller still can't keep up after exhausting
      // all batches — indicates the chain is producing blocks faster than the
      // poller can process them (throughput problem, not a bug).
      if (i === MAX_BATCHES_PER_CYCLE - 1) {
        console.warn(
          `[EVM Poller/${network}] Still behind after ${MAX_BATCHES_PER_CYCLE} batches this cycle` +
          ` — chain producing blocks faster than poller throughput`
        );
      }
    }
  } catch (err: any) {
    console.error(`[EVM Poller/${network}] Cycle failed:`, err.message);
  } finally {
    runningFlags[network] = false;
  }
}

/**
 * Starts a fallback poller for one network. With getLogsAdaptive, each
 * steady-state cycle costs ~2 RPC calls (one per stablecoin contract) so
 * short intervals are cheap. For Arbitrum — where Alchemy webhooks
 * consistently miss AA-bundled transactions — this is effectively the
 * primary deposit detection path, so it runs every 15s for near-instant
 * crediting. ETH/Polygon keep longer intervals since their webhooks are
 * more reliable and these just serve as a safety net.
 */
export function startEVMPoller(network: SupportedNetwork, intervalMs = 60_000) {
  console.log(
    `[EVM Poller/${network}] Started (every ${intervalMs / 1000}s)`
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
  startEVMPoller('eth_mainnet', 60_000);   // 60s — webhook is reliable, this is backup
  startEVMPoller('polygon_mainnet', 45_000);   // 45s — webhook mostly reliable
  startEVMPoller('arbitrum_mainnet', 15_000);   // 15s — effectively primary path (webhook misses AA txs)
}
import { ethers } from 'ethers';
import { prisma } from '../prisma.js';
import { getConfig, setConfig } from '../utils/configLoader.js';
import {
  getStablecoinContracts,
  NETWORK_RPC_CONFIG_KEY,
  NATIVE_COIN,
  SupportedNetwork,
} from '../config/networks.js';
import { creditDeposit } from '../services/depositService.js';
import { getUsdRate } from '../services/priceService.js';
import { Coin } from '@prisma/client';

const TRANSFER_TOPIC = ethers.utils.id('Transfer(address,address,uint256)');

// Mirrors MIN_CONFIRMATIONS in depositWorker.ts — this poller only needs to
// be "safe enough", not identical, since creditDeposit() dedupes on txHash
// regardless of which path (webhook or poller) gets there first.
const CONFIRMATION_LAG: Partial<Record<SupportedNetwork, number>> = {
  eth_mainnet:      12,
  polygon_mainnet:  64,
  arbitrum_mainnet: 1,
};

// Wider batches for fast/cheap chains, narrower for slow/expensive RPC calls.
const BATCH_SIZE: Partial<Record<SupportedNetwork, number>> = {
  eth_mainnet:      20,
  polygon_mainnet:  50,
  arbitrum_mainnet: 50,
};

// Track "running" per network independently so one slow chain doesn't block another.
const runningFlags: Record<string, boolean> = {};

/**
 * Redundant safety-net poller for any Alchemy-managed EVM network. Alchemy
 * webhooks (src/webhooks/alchemyWebhook.ts) are the primary path; this exists
 * purely to catch deposits dropped by webhook payload edge cases — e.g.
 * AA-bundled txs with multiple Transfer logs missing logIndex (see the
 * jobId dedupe fallback in enqueueDepositActivity).
 *
 * Safe to run alongside the webhook path: creditDeposit() is idempotent on
 * txHash, so a deposit already credited via webhook is a silent no-op here.
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

    const watched = await prisma.depositAddress.findMany({
      where: { network },
      select: { id: true, userId: true, address: true },
    });
    if (watched.length === 0) return;

    const watchMap = new Map(watched.map(w => [w.address.toLowerCase(), w]));
    const addressTopics = watched.map(w =>
      ethers.utils.hexZeroPad(w.address, 32).toLowerCase()
    );

    const latest = await provider.getBlockNumber();
    const safeHead = latest - confirmationLag;

    const storedLast = await getConfig(lastBlockKey);
    // First run: start at current safe head — don't retroactively backfill history
    const fromBlock = storedLast ? Number(storedLast) + 1 : safeHead;
    const toBlock = Math.min(safeHead, fromBlock + batchSize - 1);
    if (toBlock < fromBlock) return;

    console.log(`[EVM Poller/${network}] Scanning blocks ${fromBlock}–${toBlock}`);

    // --- ERC-20 (USDT/USDC) transfers ---
    const contracts = await getStablecoinContracts(network);
    const contractAddrs = Object.keys(contracts);

    for (const contractAddr of contractAddrs) {
      const logs = await provider.getLogs({
        fromBlock,
        toBlock,
        address: contractAddr,
        topics: [TRANSFER_TOPIC, null, addressTopics],
      });

      for (const log of logs) {
        const to = ethers.utils.getAddress('0x' + log.topics[2].slice(26)).toLowerCase();
        const match = watchMap.get(to);
        if (!match) continue;

        const token = contracts[log.address.toLowerCase()];
        const rawValue = BigInt(log.data);
        const amount = Number(ethers.utils.formatUnits(rawValue, token.decimals));
        if (amount <= 0) continue;

        // logIndex comes straight from the chain via getLogs — always reliable,
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
              `[EVM Poller/${network}] ✅ Credited ${amount} ${token.symbol} ($${usdValue.toFixed(2)}) → user ${match.userId} | tx: ${log.transactionHash} (backfilled — webhook likely missed it)`
            );
          }
          // null = creditDeposit's txHash dedupe already caught it — expected
          // steady-state case whenever the webhook path worked fine.
        } catch (err: any) {
          console.error(
            `[EVM Poller/${network}] Credit error for ${log.transactionHash}:`,
            err.message
          );
        }
      }
    }

    // --- Native coin transfers (ETH on mainnet/Arbitrum, MATIC on Polygon) ---
    const nativeCoin = NATIVE_COIN[network];
    for (let bn = fromBlock; bn <= toBlock; bn++) {
      const block = await provider.getBlockWithTransactions(bn);
      for (const tx of block?.transactions ?? []) {
        const toAddr = tx.to?.toLowerCase();
        if (!toAddr) continue;
        const match = watchMap.get(toAddr);
        if (!match || tx.value.isZero()) continue;

        const amount = Number(ethers.utils.formatEther(tx.value));
        try {
          const usdRate = await getUsdRate(nativeCoin);
          const usdValue = amount * usdRate;

          const deposit = await creditDeposit(
            tx.hash,
            match.userId,
            nativeCoin as Coin,
            network,
            amount,
            usdValue,
            match.id,
          );

          if (deposit) {
            console.log(
              `[EVM Poller/${network}] ✅ Credited ${amount} ${nativeCoin} ($${usdValue.toFixed(2)}) → user ${match.userId} | tx: ${tx.hash} (backfilled)`
            );
          }
        } catch (err: any) {
          console.error(
            `[EVM Poller/${network}] Credit error for ${tx.hash}:`,
            err.message
          );
        }
      }
    }

    await setConfig(lastBlockKey, String(toBlock));
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

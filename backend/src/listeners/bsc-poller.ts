import { ethers } from 'ethers';
import { prisma } from '../prisma.js';
import { getConfig, setConfig } from '../utils/configLoader.js';
import { getStablecoinContracts, NETWORK_RPC_CONFIG_KEY } from '../config/networks.js';
import { enqueueDepositActivity } from '../queues/depositQueue.js';

const NETWORK = 'bsc_mainnet';
const LAST_BLOCK_KEY = 'BSC_POLLER_LAST_BLOCK';
const CONFIRMATION_LAG = 3;     // blocks to hold back, avoids acting on soon-to-reorg blocks
const BATCH_SIZE = 200;         // max blocks per cycle
const TRANSFER_TOPIC = ethers.utils.id('Transfer(address,address,uint256)');

let running = false; // prevents overlapping cycles if RPC is slow

export async function pollBscOnce() {
  if (running) return;
  running = true;
  try {
    const rpcUrl = await getConfig(NETWORK_RPC_CONFIG_KEY[NETWORK]!);
    if (!rpcUrl) { console.warn('[BSC Poller] No RPC configured — skipping'); return; }
    const provider = new ethers.providers.JsonRpcProvider(rpcUrl);

    const watched = await prisma.depositAddress.findMany({
      where: { network: NETWORK },
      select: { address: true },
    });
    if (watched.length === 0) return;
    const watchedSet = new Set(watched.map(w => w.address.toLowerCase()));
    const addressTopics = watched.map(w => ethers.utils.hexZeroPad(w.address, 32).toLowerCase());

    const latest = await provider.getBlockNumber();
    const safeHead = latest - CONFIRMATION_LAG;

    const storedLast = await getConfig(LAST_BLOCK_KEY);
    const fromBlock = storedLast ? Number(storedLast) + 1 : safeHead; // first run: start at head, don't backfill history
    const toBlock = Math.min(safeHead, fromBlock + BATCH_SIZE - 1);
    if (toBlock < fromBlock) return;

    // --- USDT / USDC transfers ---
    const contracts = await getStablecoinContracts(NETWORK);
    const contractAddrs = Object.keys(contracts);
    if (contractAddrs.length) {
      const logs = await provider.getLogs({
        fromBlock, toBlock,
        address: contractAddrs,
        topics: [TRANSFER_TOPIC, null, addressTopics], // OR-match on "to"
      } as unknown as ethers.providers.Filter);
      for (const log of logs) {
        const to = ethers.utils.getAddress('0x' + log.topics[2].slice(26)).toLowerCase();
        if (!watchedSet.has(to)) continue;
        const token = contracts[log.address.toLowerCase()];
        const rawValue = BigInt(log.data).toString();

        await enqueueDepositActivity(NETWORK, {
          category: 'token',
          fromAddress: ethers.utils.getAddress('0x' + log.topics[1].slice(26)),
          toAddress: ethers.utils.getAddress(to),
          hash: log.transactionHash,
          value: Number(ethers.utils.formatUnits(rawValue, token.decimals)),
          asset: token.symbol,
          rawContract: {
            address: log.address,
            decimals: token.decimals,
            rawValue,
          },
        });
      }
    }

    // --- Native BNB transfers ---
    for (let bn = fromBlock; bn <= toBlock; bn++) {
      const block = await provider.getBlockWithTransactions(bn);
      for (const tx of (block?.transactions ?? [])) {
        if (tx.to && watchedSet.has(tx.to.toLowerCase()) && tx.value.gt(0)) {
          await enqueueDepositActivity(NETWORK, {
            category: 'external',
            fromAddress: tx.from,
            toAddress: tx.to,
            hash: tx.hash,
            value: Number(ethers.utils.formatEther(tx.value)),
            asset: 'BNB',
          });
        }
      }
    }

    await setConfig(LAST_BLOCK_KEY, String(toBlock));
  } catch (err: any) {
    console.error('[BSC Poller] Cycle failed:', err.message);
  } finally {
    running = false;
  }
}

export function startBSCPoller(intervalMs = 15_000) {
  console.log(`[BSC Poller] Started (every ${intervalMs / 1000}s)`);
  setInterval(pollBscOnce, intervalMs);
}

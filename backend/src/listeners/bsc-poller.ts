import { ethers } from 'ethers';
import { prisma } from '../prisma.js';
import { getConfig, setConfig } from '../utils/configLoader.js';
import { getStablecoinContracts, NETWORK_RPC_CONFIG_KEY } from '../config/networks.js';
import { enqueueDepositActivity } from '../queues/depositQueue.js';

const NETWORK = 'bsc_mainnet';
const LAST_BLOCK_KEY = 'BSC_POLLER_LAST_BLOCK';
const CONFIRMATION_LAG = 3;
const BATCH_SIZE = 10;
const TRANSFER_TOPIC = ethers.utils.id('Transfer(address,address,uint256)');

let running = false;

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

    // Build a Set for fast local filtering — avoids passing address list to BSC node
    // BSC nodes reject eth_getLogs with more than ~5 addresses in topics filter (-32005)
    const watchedSet = new Set(watched.map(w => w.address.toLowerCase()));

    const latest = await provider.getBlockNumber();
    const safeHead = latest - CONFIRMATION_LAG;

    const storedLast = await getConfig(LAST_BLOCK_KEY);
    const fromBlock = storedLast ? Number(storedLast) + 1 : safeHead;
    const toBlock = Math.min(safeHead, fromBlock + BATCH_SIZE - 1);
    if (toBlock < fromBlock) return;

    // --- USDT / USDC transfers ---
    // Query ALL transfers on the contract with NO address filter in topics.
    // Filter locally in memory — BSC nodes enforce a strict topic array size limit.
    const contracts = await getStablecoinContracts(NETWORK);
    const contractAddrs = Object.keys(contracts);

    if (contractAddrs.length) {
      for (const contractAddr of contractAddrs) {
        const logs = await provider.getLogs({
          fromBlock,
          toBlock,
          address: contractAddr,
          topics: [TRANSFER_TOPIC], // NO address filter — filter locally below
        });

        for (const log of logs) {
          if (!log.topics[2]) continue;
          const to = ethers.utils.getAddress('0x' + log.topics[2].slice(26)).toLowerCase();
          if (!watchedSet.has(to)) continue; // local filter

          const token = contracts[log.address.toLowerCase()];
          if (!token) continue;
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
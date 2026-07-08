/**
 * One-off manual backfill for a specific deposit tx that's too old for the
 * fallback poller to ever reach (poller only scans forward from wherever its
 * cursor currently sits — it doesn't retroactively backfill history).
 *
 * Usage:
 *   npx tsx src/scripts/backfill-deposit.ts arbitrum_mainnet 0xfa49208ad9b81358127a7c5c577c1286380d83fd0899c9202a0014f068f8a120
 *
 * Safe to run even if the deposit was already credited — creditDeposit()
 * dedupes on txHash and will just report "already exists" and exit cleanly.
 */
import { ethers } from 'ethers';
import { prisma } from '../prisma.js';
import { getConfig } from '../utils/configLoader.js';
import { getStablecoinContracts, NETWORK_RPC_CONFIG_KEY, SupportedNetwork } from '../config/networks.js';
import { creditDeposit } from '../services/depositService.js';
import { getUsdRate } from '../services/priceService.js';
import { Coin } from '@prisma/client';

const TRANSFER_TOPIC = ethers.utils.id('Transfer(address,address,uint256)');

async function main() {
  const [, , networkArg, txHashArg] = process.argv;
  if (!networkArg || !txHashArg) {
    console.error('Usage: npx tsx src/scripts/backfill-deposit.ts <network> <txHash>');
    process.exit(1);
  }

  const network = networkArg as SupportedNetwork;
  const txHash = txHashArg.startsWith('0x') ? txHashArg : `0x${txHashArg}`;

  const rpcConfigKey = NETWORK_RPC_CONFIG_KEY[network];
  if (!rpcConfigKey) throw new Error(`No RPC config key for network: ${network}`);
  const rpcUrl = await getConfig(rpcConfigKey);
  if (!rpcUrl) throw new Error(`No RPC URL configured for ${network}`);

  const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
  console.log(`[Backfill] Fetching receipt for ${txHash} on ${network}...`);

  const receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt) {
    console.error(`[Backfill] No receipt found — tx may not exist or hasn't mined yet.`);
    process.exit(1);
  }

  const currentBlock = await provider.getBlockNumber();
  const confirmations = currentBlock - receipt.blockNumber + 1;
  console.log(`[Backfill] Found in block ${receipt.blockNumber} (${confirmations} confirmations)`);

  const contracts = await getStablecoinContracts(network);

  // Every DepositAddress this deposit could plausibly belong to, keyed by
  // lowercased address, so we can match log recipients to a user + address ID.
  const watched = await prisma.depositAddress.findMany({
    where: { network, user: { role: 'USER' } },
    select: { id: true, userId: true, address: true },
  });
  const watchMap = new Map(watched.map(w => [w.address.toLowerCase(), w]));

  let creditedAny = false;

  for (const log of receipt.logs) {
    if (log.topics[0] !== TRANSFER_TOPIC) continue; // not an ERC-20 Transfer event
    if (log.topics.length < 3) continue;

    const contractAddr = log.address.toLowerCase();
    const token = contracts[contractAddr];
    if (!token) {
      console.log(`[Backfill] Skipping log from unrecognized contract ${contractAddr}`);
      continue;
    }

    const to = ethers.utils.getAddress('0x' + log.topics[2].slice(26)).toLowerCase();
    const match = watchMap.get(to);
    if (!match) {
      console.log(`[Backfill] Transfer to ${to} — not one of our watched addresses, skipping`);
      continue;
    }

    const rawValue = BigInt(log.data);
    const amount = Number(ethers.utils.formatUnits(rawValue, token.decimals));
    if (amount <= 0) continue;

    console.log(`[Backfill] Found matching transfer: ${amount} ${token.symbol} → user ${match.userId}`);

    const usdRate = await getUsdRate(token.symbol);
    const usdValue = amount * usdRate;

    const deposit = await creditDeposit(
      txHash,
      match.userId,
      token.symbol as Coin,
      network,
      amount,
      usdValue,
      match.id,
    );

    if (deposit) {
      console.log(`[Backfill] ✅ Credited $${usdValue.toFixed(2)} (${amount} ${token.symbol}) to user ${match.userId}`);
      creditedAny = true;
    } else {
      console.log(`[Backfill] Already credited previously — no action taken (this is safe/expected if it was already processed).`);
    }
  }

  if (!creditedAny) {
    console.log(`[Backfill] No new credits applied. Either the tx doesn't touch a watched address, or it was already credited.`);
  }

  process.exit(0);
}

main().catch(err => {
  console.error('[Backfill] Fatal error:', err);
  process.exit(1);
});
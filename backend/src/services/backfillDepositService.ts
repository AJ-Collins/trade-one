/**
 * Reusable backfill service — core logic for replaying a specific deposit tx
 * that the webhook / poller missed. Both the CLI script (backfill-deposit.ts)
 * and the admin API route call this, so there's exactly one code path that
 * handles receipt parsing, watched-address matching, and crediting.
 *
 * Idempotent: creditDeposit() dedupes on txHash, so re-running on an already-
 * credited tx is a safe no-op (reflected as 'already_credited' status).
 */
import { ethers } from 'ethers';
import { prisma } from '../prisma.js';
import { getConfig } from '../utils/configLoader.js';
import { getStablecoinContracts, NETWORK_RPC_CONFIG_KEY, SupportedNetwork } from '../config/networks.js';
import { creditDeposit } from './depositService.js';
import { getUsdRate } from './priceService.js';
import { Coin } from '@prisma/client';

const TRANSFER_TOPIC = ethers.utils.id('Transfer(address,address,uint256)');

export interface BackfillCredit {
  userId: string;
  symbol: string;
  amount: number;
  usdValue: number;
}

export interface BackfillResult {
  txHash: string;
  network: SupportedNetwork;
  status: 'credited' | 'already_credited' | 'no_match' | 'not_found' | 'error';
  credits: BackfillCredit[];
  error?: string;
}

/**
 * Looks up a single tx hash on the given network, parses its Transfer logs,
 * and credits any that land on a watched deposit address.
 */
export async function backfillDepositTx(
  network: SupportedNetwork,
  txHashArg: string,
): Promise<BackfillResult> {
  const txHash = txHashArg.startsWith('0x') ? txHashArg : `0x${txHashArg}`;

  const rpcConfigKey = NETWORK_RPC_CONFIG_KEY[network];
  if (!rpcConfigKey) throw new Error(`No RPC config key for network: ${network}`);
  const rpcUrl = await getConfig(rpcConfigKey);
  if (!rpcUrl) throw new Error(`No RPC URL configured for ${network}`);

  const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
  const receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt) {
    return { txHash, network, status: 'not_found', credits: [] };
  }

  const contracts = await getStablecoinContracts(network);
  const watched = await prisma.depositAddress.findMany({
    where: { network, user: { role: 'USER' } },
    select: { id: true, userId: true, address: true },
  });
  const watchMap = new Map(watched.map(w => [w.address.toLowerCase(), w]));

  const credits: BackfillCredit[] = [];
  let anyMatch = false;
  let anyNewCredit = false;

  for (const log of receipt.logs) {
    if (log.topics[0] !== TRANSFER_TOPIC || log.topics.length < 3) continue;

    const token = contracts[log.address.toLowerCase()];
    if (!token) continue;

    const to = ethers.utils.getAddress('0x' + log.topics[2].slice(26)).toLowerCase();
    const match = watchMap.get(to);
    if (!match) continue;

    anyMatch = true;
    const rawValue = BigInt(log.data);
    const amount = Number(ethers.utils.formatUnits(rawValue, token.decimals));
    if (amount <= 0) continue;

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
      anyNewCredit = true;
      credits.push({ userId: match.userId, symbol: token.symbol, amount, usdValue });
    }
  }

  if (!anyMatch) return { txHash, network, status: 'no_match', credits: [] };
  return {
    txHash,
    network,
    status: anyNewCredit ? 'credited' : 'already_credited',
    credits,
  };
}

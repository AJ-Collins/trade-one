import { Prisma } from '@prisma/client';
import { prisma } from '../prisma.js';
import { Coin } from '@prisma/client';
import { generateEVMAddress } from '../wallets/evm.js';
import { generateBTCAddress } from '../wallets/bitcoin.js';
import { generateSolanaAddress } from '../wallets/solana.js';
import { generateTONAddress } from '../wallets/ton.js';
import { generateTronAddress } from '../wallets/tron.js';
import { registerAddressWithAlchemy, isEVMNetwork } from '../webhooks/alchemyWebhook.js';
import { SupportedNetwork, SUPPORTED_NETWORKS } from '../config/networks.js';
import { generateXRPAddress } from '../wallets/xrp.js';
import { generateLitecoinAddress } from '../wallets/litecoin.js';
import { generateDogecoinAddress } from '../wallets/dogecoin.js';

type GeneratorType = 'evm' | 'btc' | 'solana' | 'ton' | 'tron';

const NETWORK_TYPE: Record<SupportedNetwork, GeneratorType> = {
  eth_mainnet:      'evm',
  bsc_mainnet:      'evm',
  polygon_mainnet:  'evm',
  arbitrum_mainnet: 'evm',
  btc_mainnet:      'btc',
  solana_mainnet:   'solana',
  ton_mainnet:      'ton',
  tron_mainnet:     'tron',
};

const VALID_NETWORKS: Record<string, SupportedNetwork[]> = {
  ETH:   ['eth_mainnet', 'arbitrum_mainnet'],
  USDT:  ['eth_mainnet', 'bsc_mainnet', 'polygon_mainnet', 'arbitrum_mainnet', 'tron_mainnet'], // Added TRC20 support for frontend
  USDC:  ['eth_mainnet', 'bsc_mainnet', 'polygon_mainnet', 'arbitrum_mainnet'],
  BNB:   ['bsc_mainnet'],
  MATIC: ['polygon_mainnet'],
  BTC:   ['btc_mainnet'],
  SOL:   ['solana_mainnet'],
  TON:   ['ton_mainnet'],
  TRX:   ['tron_mainnet'],
};

async function runGenerator(
  generatorType: GeneratorType,
  index: number,
  network: SupportedNetwork,
): Promise<{ address: string; path: string }> {
  switch (generatorType) {
    case 'evm':    return generateEVMAddress(index);
    case 'btc':    return generateBTCAddress(index, network as 'btc_mainnet');
    case 'solana': return generateSolanaAddress(index);
    case 'ton':    return generateTONAddress(index);
    case 'tron':   return generateTronAddress(index);
  }
}

export async function getOrCreateDepositAddress(
  userId: string,
  coin: string,
  network: string,
) {
  const coinUpper = coin.toUpperCase() as Coin;

  if (!SUPPORTED_NETWORKS.includes(network as SupportedNetwork)) {
    throw new Error(`Unsupported network: ${network}`);
  }
  const supportedNetwork = network as SupportedNetwork;

  if (!VALID_NETWORKS[coinUpper]) {
    throw new Error(`Unsupported coin: ${coin}`);
  }
  if (!VALID_NETWORKS[coinUpper].includes(supportedNetwork)) {
    throw new Error(`${coin} not supported on ${network}`);
  }

  const existing = await prisma.depositAddress.findUnique({
    where: { userId_coin_network: { userId, coin: coinUpper, network } },
  });
  if (existing) {
    return { address: existing.address, coin: coinUpper, network, reused: true, depositAddressId: existing.id,  };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { hdAccountIndex: true },
  });
  if (!user) throw new Error('User not found');

  const generatorType = NETWORK_TYPE[supportedNetwork];
  const result = await runGenerator(generatorType, user.hdAccountIndex, supportedNetwork);

  const created = await prisma.depositAddress.create({
    data: {
      userId,
      coin: coinUpper,
      network,
      address: result.address,
      derivationPath: result.path,
    },
  });

  // Only EVM addresses go to Alchemy — non-EVM chains use their own listeners
  if (isEVMNetwork(network)) {
    registerAddressWithAlchemy(result.address, network).catch(err =>
      console.error(`[Alchemy] Background registration failed for ${result.address}:`, err.message)
    );
  }

  return { address: result.address, coin: coinUpper, network, reused: false, depositAddressId: created.id,  };
}

export async function creditDeposit(
  txHash: string,
  userId: string,
  coin: Coin,
  network: string,
  amountCrypto: number,
  usdValue: number,
  depositAddressId?: string,
) {
  // Cheap indexed pre-check — avoids hitting the DB constraint (and logging
  // a Postgres ERROR) every poll cycle for transactions we've already credited.
  const alreadyExists = await prisma.deposit.findUnique({
    where: { txHash },
    select: { id: true },
  });
  if (alreadyExists) {
    return null; // silent skip — this is the expected, common case on every poll
  }
  
  // If a depositAddressId was passed (e.g. from the deposit worker which already
  // resolved it), use it directly. Otherwise fall back to a flexible lookup that
  // finds ANY matching address for this user on this network — this handles the
  // case where the same derived address serves multiple coins (USDT/USDC/ETH on
  // the same EVM chain all share one address).
  let resolvedAddressId = depositAddressId;

  if (!resolvedAddressId) {
    // Try exact coin+network match first (most specific)
    const exact = await prisma.depositAddress.findUnique({
      where: { userId_coin_network: { userId, coin, network } },
    });
    if (exact) {
      resolvedAddressId = exact.id;
    } else {
      // Fallback: find any deposit address for this user on this network.
      // This handles edge cases where the worker resolved a different coin
      // than what's stored in the DepositAddress row.
      const fallback = await prisma.depositAddress.findFirst({
        where: { userId, network },
      });
      if (fallback) {
        resolvedAddressId = fallback.id;
      }
    }
  }

  if (!resolvedAddressId) throw new Error(`Deposit address not found for user ${userId} on ${network}`);

  try {
    const [deposit] = await prisma.$transaction([
      prisma.deposit.create({
        data: {
          userId,
          depositAddressId: resolvedAddressId,
          coin,
          network,
          txHash,
          amount: amountCrypto,
          usdValueAtCredit: usdValue,
          status: 'CREDITED',
          creditedAt: new Date(),
        },
      }),
      prisma.account.update({
        where: { userId_type: { userId, type: 'REAL' } },
        data: { balance: { increment: usdValue } },
      }),
    ]);
    return deposit;
  } catch (err: any) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      console.log(`[creditDeposit] Duplicate txHash ${txHash} — skipping`);
      return null;
    }
    throw err;
  }
}

export async function markDepositSwept(depositId: string, sweptTx: string) {
  return prisma.deposit.update({
    where: { id: depositId },
    data: { status: 'SWEPT', sweptTx, sweptAt: new Date() },
  });
}

export async function fetchDepositHistory(userId: string) {
  return prisma.deposit.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      id: true, coin: true, network: true, amount: true,
      usdValueAtCredit: true, status: true, txHash: true, createdAt: true,
    },
  });
}

export async function syncExistingAddressesWithAlchemy() {
  const evmNetworks = [
    'sepolia', 'eth_mainnet', 'bsc_testnet', 'polygon_mainnet', 'arbitrum_mainnet',
  ];

  const addresses = await prisma.depositAddress.findMany({
    where: { network: { in: evmNetworks } },
    select: { address: true, network: true },
  });

  if (addresses.length === 0) {
    console.log('[Alchemy] No existing EVM addresses to sync');
    return;
  }

  const byNetwork: Record<string, string[]> = {};
  for (const a of addresses) {
    (byNetwork[a.network] ??= []).push(a.address);
  }

  for (const [network, addrs] of Object.entries(byNetwork)) {
    try {
      await registerAddressWithAlchemy(addrs, network);
      console.log(`[Alchemy] Synced ${addrs.length} addresses on ${network}`);
    } catch (err: any) {
      console.error(`[Alchemy] Sync failed for ${network}:`, err.message);
    }
  }
}
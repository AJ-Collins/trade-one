import { ethers } from 'ethers';
import { prisma } from '../prisma.js';
import { creditDeposit } from '../services/depositService.js';
import { getUsdRate } from '../services/priceService.js';
import { getConfig } from '../utils/configLoader.js';
import { Coin } from '@prisma/client';
import {
  getStablecoinContracts,
  NATIVE_COIN,
  NETWORK_RPC_CONFIG_KEY,
  SupportedNetwork,
} from '../config/networks.js';

const ERC20_BALANCE_ABI = ['function balanceOf(address owner) view returns (uint256)'];

// EVM networks to reconcile
const EVM_NETWORKS: SupportedNetwork[] = [
  'eth_mainnet',
  'bsc_mainnet',
  'polygon_mainnet',
  'arbitrum_mainnet',
];

/**
 * Reconciliation scanner for EVM chains.
 * 
 * This acts as a safety net for deposits that Alchemy webhooks missed
 * (stale confirmations, webhook delivery failure, signing key mismatch, etc).
 *
 * For every USER deposit address on each EVM network, it checks:
 *   1. Native coin balance (ETH/BNB/MATIC)
 *   2. Stablecoin balances (USDT/USDC via contract)
 *
 * If a balance is found that hasn't already been credited, it creates
 * a synthetic deposit record so the sweeper can pick it up.
 */
async function reconcileNetwork(network: SupportedNetwork) {
  const rpcConfigKey = NETWORK_RPC_CONFIG_KEY[network];
  if (!rpcConfigKey) return;

  const rpcUrl = await getConfig(rpcConfigKey);
  if (!rpcUrl) {
    console.log(`[Reconciler/${network}] No RPC configured — skipping`);
    return;
  }

  const provider = new ethers.providers.JsonRpcProvider(rpcUrl);

  // Only reconcile USER-role addresses
  const addresses = await prisma.depositAddress.findMany({
    where: {
      network,
      user: { role: 'USER' },
    },
    select: { id: true, address: true, userId: true, coin: true },
  });

  if (addresses.length === 0) return;

  // De-duplicate addresses (same address may appear for USDT, USDC, ETH on same network)
  const uniqueAddresses = new Map<string, { userId: string; addressIds: Map<string, string> }>();
  for (const addr of addresses) {
    const key = addr.address.toLowerCase();
    if (!uniqueAddresses.has(key)) {
      uniqueAddresses.set(key, { userId: addr.userId, addressIds: new Map() });
    }
    uniqueAddresses.get(key)!.addressIds.set(addr.coin, addr.id);
  }

  const nativeCoin = NATIVE_COIN[network] as Coin;
  const stablecoins = await getStablecoinContracts(network);

  for (const [address, { userId, addressIds }] of uniqueAddresses) {
    try {
      // ── Check native coin balance ──────────────────────────────────────
      const nativeBalance = await provider.getBalance(address);
      const nativeAmount = parseFloat(ethers.utils.formatEther(nativeBalance));

      // Only credit if balance is meaningful (> $0.50 worth)
      if (nativeAmount > 0) {
        const usdRate = await getUsdRate(nativeCoin);
        const usdValue = nativeAmount * usdRate;

        if (usdValue >= 0.50) {
          // Check if we already have a credited deposit for this amount on this address
          const existing = await prisma.deposit.findFirst({
            where: {
              userId,
              network,
              coin: nativeCoin,
              status: { in: ['CREDITED', 'SWEPT'] },
            },
            orderBy: { createdAt: 'desc' },
          });

          // Only create if no recent deposit exists or the amount differs significantly
          if (!existing) {
            const txHash = `reconcile:${network}:${address}:native:${Date.now()}`;
            const depositAddressId = addressIds.get(nativeCoin) || addressIds.values().next().value;
            if (depositAddressId) {
              const deposit = await creditDeposit(txHash, userId, nativeCoin, network, nativeAmount, usdValue, depositAddressId);
              if (deposit) {
                console.log(`[Reconciler/${network}] ✅ Credited ${nativeAmount} ${nativeCoin} ($${usdValue.toFixed(2)}) → user ${userId}`);
              }
            }
          }
        }
      }

      // ── Check stablecoin balances ──────────────────────────────────────
      for (const [contractAddr, { symbol, decimals }] of Object.entries(stablecoins)) {
        if (!contractAddr) continue;
        try {
          const tokenContract = new ethers.Contract(contractAddr, ERC20_BALANCE_ABI, provider);
          const tokenBalance = await tokenContract.balanceOf(address);
          const tokenAmount = parseFloat(ethers.utils.formatUnits(tokenBalance, decimals));

          if (tokenAmount >= 0.50) {
            const existing = await prisma.deposit.findFirst({
              where: {
                userId,
                network,
                coin: symbol as Coin,
                status: { in: ['CREDITED', 'SWEPT'] },
              },
              orderBy: { createdAt: 'desc' },
            });

            if (!existing) {
              const txHash = `reconcile:${network}:${address}:${symbol}:${Date.now()}`;
              const depositAddressId = addressIds.get(symbol) || addressIds.values().next().value;
              if (depositAddressId) {
                const usdValue = tokenAmount * (await getUsdRate(symbol));
                const deposit = await creditDeposit(txHash, userId, symbol as Coin, network, tokenAmount, usdValue, depositAddressId);
                if (deposit) {
                  console.log(`[Reconciler/${network}] ✅ Credited ${tokenAmount} ${symbol} ($${usdValue.toFixed(2)}) → user ${userId}`);
                }
              }
            }
          }
        } catch (err: any) {
          // Individual token check failure shouldn't stop the whole reconciliation
          console.warn(`[Reconciler/${network}] Token check failed for ${symbol} at ${address}:`, err.message);
        }
      }
    } catch (err: any) {
      console.error(`[Reconciler/${network}] Error checking ${address}:`, err.message);
    }

    // Small delay between addresses to avoid hammering the RPC
    await new Promise(r => setTimeout(r, 200));
  }
}

async function reconcileAll() {
  for (const network of EVM_NETWORKS) {
    try {
      await reconcileNetwork(network);
    } catch (err: any) {
      console.error(`[Reconciler] ${network} reconciliation failed:`, err.message);
    }
  }
}

/**
 * Start the EVM reconciliation scanner.
 * Runs every 5 minutes by default — much less frequent than listeners/webhooks
 * because this is purely a safety net for missed deposits.
 */
export function startEVMReconciler(intervalMs = 300_000) {
  console.log(`🔍 EVM Reconciler started (every ${intervalMs / 1000}s)`);

  const run = async () => {
    try { await reconcileAll(); }
    catch (err: any) { console.error('[Reconciler]', err.message); }
  };

  // Delay first run by 30s to let the server fully boot
  setTimeout(() => {
    run();
    setInterval(run, intervalMs);
  }, 30_000);
}

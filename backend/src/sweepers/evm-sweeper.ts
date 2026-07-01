import { ethers } from 'ethers';
import * as bip39 from 'bip39';
import { prisma } from '../prisma.js';
import { getConfig } from '../utils/configLoader.js';
import { markDepositSwept } from '../services/depositService.js';

const MIN_SWEEP = parseFloat(process.env.MIN_SWEEP_ETH || '0.001');

function getPrivateKeyForPath(derivationPath: string, mnemonic: string): string {
  const seed = bip39.mnemonicToSeedSync(mnemonic);
  return ethers.utils.HDNode.fromSeed(seed).derivePath(derivationPath).privateKey;
}

function scheduleConfirmationCheck(
  txHash: string,
  depositId: string,
  provider: ethers.providers.JsonRpcProvider
) {
  const interval = setInterval(async () => {
    try {
      const receipt = await provider.getTransactionReceipt(txHash);
      if (!receipt) return;
      clearInterval(interval);
      if (receipt.status === 1) {
        await markDepositSwept(depositId, txHash);
        console.log(`Delayed confirmation: deposit ${depositId} swept | tx: ${txHash}`);
      } else {
        console.log(`Sweep tx failed on-chain: ${txHash}`);
      }
    } catch (e: any) {
      console.error('Confirmation check error:', e.message);
    }
  }, 15_000);
}

async function sweepSingleDeposit(
  deposit: { id: string; address: string; derivationPath: string },
  provider: ethers.providers.JsonRpcProvider,
  HOT_WALLET: string,
  mnemonic: string
) {
  const privateKey = getPrivateKeyForPath(deposit.derivationPath, mnemonic);
  const wallet     = new ethers.Wallet(privateKey, provider);
  const balanceWei = await provider.getBalance(deposit.address);
  const balanceETH = parseFloat(ethers.utils.formatEther(balanceWei));

  if (balanceETH < MIN_SWEEP) {
    console.log(`  ↳ ${deposit.address} balance ${balanceETH} below threshold — skip`);
    return;
  }

  const feeData = await provider.getFeeData();
  let maxFeePerGas = feeData.maxFeePerGas || feeData.gasPrice || await provider.getGasPrice();
  let maxPriorityFeePerGas = feeData.maxPriorityFeePerGas || ethers.utils.parseUnits('1.5', 'gwei');

  const { chainId } = await provider.getNetwork();
  // 137 is Polygon Mainnet
  if (chainId === 137) {
    const minPolygonTip = ethers.utils.parseUnits('30', 'gwei');
    if (maxPriorityFeePerGas.lt(minPolygonTip)) maxPriorityFeePerGas = minPolygonTip;
    if (maxFeePerGas.lt(minPolygonTip)) maxFeePerGas = minPolygonTip.mul(2);
  }

  const gasLimit  = ethers.BigNumber.from(21_000);
  const gasCost   = maxFeePerGas.mul(gasLimit);
  const sendAmount = balanceWei.sub(gasCost);

  if (sendAmount.lte(0)) {
    console.log(`  ↳ ${deposit.address} — balance doesn't cover gas`);
    return;
  }

  console.log(`  ↳ Sweeping ${ethers.utils.formatEther(sendAmount)} ETH → ${HOT_WALLET}`);

  const tx = await wallet.sendTransaction({
    to: HOT_WALLET,
    value: sendAmount,
    gasLimit,
    maxFeePerGas,
    maxPriorityFeePerGas,
  });

  console.log(`  ↳ Tx broadcast: ${tx.hash}`);

  try {
    const receipt = await Promise.race([
      tx.wait(1),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('wait timeout')), 60_000)
      ),
    ]);

    if (receipt && (receipt as ethers.providers.TransactionReceipt).status === 1) {
      await markDepositSwept(deposit.id, tx.hash);
      console.log(`  ✅ Swept deposit ${deposit.id} | tx: ${tx.hash}`);
    } else {
      console.log(`  ⚠ Tx may have failed — check: ${tx.hash}`);
    }
  } catch {
    console.log(`  ⏳ Confirmation timeout for ${tx.hash} — polling until confirmed`);
    scheduleConfirmationCheck(tx.hash, deposit.id, provider);
  }
}

async function sweepEVM(network: string) {
  const hotWalletRaw = await getConfig('HOT_WALLET_ADDRESS');
  if (!hotWalletRaw) {
    console.log(`[sweeper/${network}] HOT_WALLET_ADDRESS not configured — skipping`);
    return;
  }

  const mnemonic = await getConfig('MASTER_MNEMONIC');
  if (!mnemonic) {
    console.log(`[sweeper/${network}] MASTER_MNEMONIC not configured — skipping`);
    return;
  }

  const rpcMap: Record<string, string | null> = {
    eth_mainnet:      await getConfig('ETH_MAINNET_RPC'),
    bsc_mainnet:      await getConfig('BSC_MAINNET_RPC'),
    polygon_mainnet:  await getConfig('POLYGON_MAINNET_RPC'),
    arbitrum_mainnet: await getConfig('ARBITRUM_MAINNET_RPC'),
  };

  const rpcUrl = rpcMap[network];
  if (!rpcUrl) {
    console.log(`[sweeper/${network}] No RPC configured — skipping`);
    return;
  }

  const HOT_WALLET = ethers.utils.getAddress(hotWalletRaw);
  const provider   = new ethers.providers.JsonRpcProvider(rpcUrl);

  const pending = await prisma.deposit.findMany({
    where: {
      network,
      status:  'CREDITED',
      sweptTx: null,
      coin:    { in: ['ETH', 'BNB', 'MATIC'] },
    },
    include: { depositAddress: { select: { address: true, derivationPath: true } } },
  });

  if (pending.length === 0) {
    console.log(`[sweeper/${network}] Nothing to sweep.`);
    return;
  }

  console.log(`[sweeper/${network}] ${pending.length} deposit(s) to sweep`);

  for (const deposit of pending) {
    try {
      await sweepSingleDeposit(
        {
          id:             deposit.id,
          address:        deposit.depositAddress.address,
          derivationPath: deposit.depositAddress.derivationPath,
        },
        provider,
        HOT_WALLET,
        mnemonic
      );
    } catch (err: any) {
      console.error(`  ✗ Sweep failed for deposit ${deposit.id}:`, err.message);
    }
  }
}

export async function startEVMSweeper(network: string, intervalMs = 120_000) {
  console.log(`🧹 EVM Sweeper started: ${network} (every ${intervalMs / 1000}s)`);
  const run = async () => {
    try { await sweepEVM(network); }
    catch (err: any) { console.error(`[sweeper/${network}] Error:`, err.message); }
  };
  await run();
  setInterval(run, intervalMs);
}
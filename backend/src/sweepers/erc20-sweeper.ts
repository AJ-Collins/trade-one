import { ethers } from 'ethers';
import * as bip39 from 'bip39';
import { prisma } from '../prisma.js';
import { getConfig } from '../utils/configLoader.js';
import { markDepositSwept } from '../services/depositService.js';

const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
];

function getPrivateKeyForPath(derivationPath: string, mnemonic: string): string {
  const seed = bip39.mnemonicToSeedSync(mnemonic);
  return ethers.utils.HDNode.fromSeed(seed).derivePath(derivationPath).privateKey;
}

async function sweepERC20(network: string, coin: string) {
  // ── Fetch all required config from DB (with .env fallback) ──────────────
  const hotWalletRaw = await getConfig('HOT_WALLET_ADDRESS');
  const hotWalletPK  = await getConfig('HOT_WALLET_PRIVATE_KEY');
  const mnemonic     = await getConfig('MASTER_MNEMONIC');

  if (!hotWalletRaw || !hotWalletPK || !mnemonic) {
    console.log(`[sweeper/${network}/${coin}] Missing wallet config — skipping`);
    return;
  }

  const rpcMap: Record<string, string | null> = {
    eth_mainnet:      await getConfig('ETH_MAINNET_RPC'),
    bsc_mainnet:      await getConfig('BSC_MAINNET_RPC'),
    polygon_mainnet:  await getConfig('POLYGON_MAINNET_RPC'),
    arbitrum_mainnet: await getConfig('ARBITRUM_MAINNET_RPC'),
  };

  const contractMap: Record<string, Record<string, string | null>> = {
    eth_mainnet: {
      USDT: await getConfig('ETH_MAINNET_USDT_CONTRACT'),
      USDC: await getConfig('ETH_MAINNET_USDC_CONTRACT'),
    },
    bsc_mainnet: {
      USDT: await getConfig('BSC_MAINNET_USDT_CONTRACT'),
      USDC: await getConfig('BSC_MAINNET_USDC_CONTRACT'),
    },
    polygon_mainnet: {
      USDT: await getConfig('POLYGON_USDT_CONTRACT'),
      USDC: await getConfig('POLYGON_USDC_CONTRACT'),
    },
    arbitrum_mainnet: {
      USDT: await getConfig('ARBITRUM_USDT_CONTRACT'),
      USDC: await getConfig('ARBITRUM_USDC_CONTRACT'),
    },
  };

  // ── Validate network + coin are configured ───────────────────────────────
  const rpcUrl = rpcMap[network];
  if (!rpcUrl) {
    console.log(`[sweeper/${network}/${coin}] No RPC configured — skipping`);
    return;
  }

  const contractAddress = contractMap[network]?.[coin];
  if (!contractAddress) {
    console.log(`[sweeper/${network}/${coin}] No contract address configured — skipping`);
    return;
  }

  // ── Setup provider + contracts ────────────────────────────────────────────
  const HOT_WALLET    = ethers.utils.getAddress(hotWalletRaw);
  const provider      = new ethers.providers.JsonRpcProvider(rpcUrl);
  const tokenContract = new ethers.Contract(contractAddress, ERC20_ABI, provider);
  const decimals: number = await tokenContract.decimals();

  // ── Find pending deposits to sweep ───────────────────────────────────────
  const pending = await prisma.deposit.findMany({
    where: { network, coin: coin as any, status: 'CREDITED', sweptTx: null },
    include: { depositAddress: { select: { address: true, derivationPath: true } } },
  });

  if (pending.length === 0) return;
  console.log(`[sweeper/${network}/${coin}] ${pending.length} token sweep(s) pending`);

  // gasWallet funds each deposit address with ETH to cover the transfer gas
  const gasWallet = new ethers.Wallet(hotWalletPK, provider);

  for (const deposit of pending) {
    try {
      const { address, derivationPath } = deposit.depositAddress;

      const tokenBalance = await tokenContract.balanceOf(address);
      if (tokenBalance.eq(0)) {
        console.log(`  ↳ ${address} — zero token balance, skipping`);
        continue;
      }

      const humanAmount = parseFloat(ethers.utils.formatUnits(tokenBalance, decimals));
      console.log(`  ↳ Sweeping ${humanAmount} ${coin} from ${address}`);

      // Fetch dynamic fee data (EIP-1559)
      const feeData = await provider.getFeeData();
      let maxFeePerGas = feeData.maxFeePerGas || feeData.gasPrice || await provider.getGasPrice();
      let maxPriorityFeePerGas = feeData.maxPriorityFeePerGas || ethers.utils.parseUnits('1.5', 'gwei');

      // Polygon heavily enforces a 30 gwei minimum tip cap
      if (network === 'polygon_mainnet') {
        const minPolygonTip = ethers.utils.parseUnits('30', 'gwei');
        if (maxPriorityFeePerGas.lt(minPolygonTip)) maxPriorityFeePerGas = minPolygonTip;
        if (maxFeePerGas.lt(minPolygonTip)) maxFeePerGas = minPolygonTip.mul(2);
      }

      const gasLimit = ethers.BigNumber.from(65_000);
      const gasNeeded = maxFeePerGas.mul(gasLimit);

      const fundTx = await gasWallet.sendTransaction({
        to: address,
        value: gasNeeded,
        maxFeePerGas,
        maxPriorityFeePerGas,
      });
      await fundTx.wait(1);

      // Now send the tokens from the deposit address to the hot wallet
      const depositPrivateKey = getPrivateKeyForPath(derivationPath, mnemonic);
      const depositWallet     = new ethers.Wallet(depositPrivateKey, provider);
      const tokenWithSigner   = tokenContract.connect(depositWallet);

      const transferTx = await tokenWithSigner.transfer(HOT_WALLET, tokenBalance, {
        gasLimit,
        maxFeePerGas,
        maxPriorityFeePerGas,
      });
      await transferTx.wait(1);

      await markDepositSwept(deposit.id, transferTx.hash);
      console.log(`  ✅ Token sweep complete: ${transferTx.hash}`);
    } catch (err: any) {
      console.error(`  ✗ Token sweep failed for deposit ${deposit.id}:`, err.message);
    }
  }
}

export async function startERC20Sweeper(network: string, coin: string, intervalMs = 120_000) {
  console.log(`🧹 ERC20 Sweeper started: ${coin} on ${network}`);
  const run = async () => {
    try { await sweepERC20(network, coin); }
    catch (err: any) { console.error(`[sweeper/${network}/${coin}]`, err.message); }
  };
  await run();
  setInterval(run, intervalMs);
}
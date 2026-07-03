import { TronWeb } from 'tronweb';
import * as bip39 from 'bip39';
import { ethers } from 'ethers';
import { prisma } from '../prisma.js';
import { getConfig } from '../utils/configLoader.js';
import { markDepositSwept } from '../services/depositService.js';

// TRX transfers cost bandwidth. If the account has free bandwidth this is 0 TRX;
// worst case it's ~0.3–1 TRX. Reserve 2 TRX to be safe.
const TX_FEE_SUN = 2_000_000; // 2 TRX in sun
const USDT_TRC20_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'; // must match tron-listener.ts
const TRC20_FUNDING_TRX = 15; // covers a transfer() call even with zero energy/bandwidth

function getPrivateKey(derivationPath: string, mnemonic: string): string {
  const seed = bip39.mnemonicToSeedSync(mnemonic);
  const node = ethers.utils.HDNode.fromSeed(seed).derivePath(derivationPath);
  return node.privateKey.slice(2); // TronWeb wants raw hex without 0x prefix
}

async function sweepTRX() {
  const HOT_WALLET_TRX = await getConfig('HOT_WALLET_TRX_ADDRESS');
  const MIN_SWEEP_TRX  = parseFloat(await getConfig('MIN_SWEEP_TRX') ?? '10');
  const tronRpc        = await getConfig('TRON_RPC') ?? 'https://api.trongrid.io';
  const trongridKey    = await getConfig('TRONGRID_API_KEY');
  const mnemonic       = await getConfig('MASTER_MNEMONIC');

  if (!HOT_WALLET_TRX || !mnemonic) {
    console.log('[trx-sweeper] Missing TRX wallet config — skipping');
    return;
  }

  const pending = await prisma.deposit.findMany({
    where: { network: 'tron_mainnet', coin: 'TRX', status: 'CREDITED', sweptTx: null },
    include: { depositAddress: { select: { address: true, derivationPath: true } } },
  });

  if (pending.length === 0) return;
  console.log(`[trx-sweeper] ${pending.length} deposit(s) to sweep`);

  // Build header once per sweep run — avoids re-reading config on every iteration
  const headers = trongridKey ? { 'TRON-PRO-API-KEY': trongridKey } : {};

  for (const deposit of pending) {
    try {
      const { address, derivationPath } = deposit.depositAddress;

      // mnemonic now passed in — no longer reads process.env
      const privateKey = getPrivateKey(derivationPath, mnemonic);

      const tronWeb = new TronWeb({
        fullHost:   tronRpc,
        privateKey,
        headers,
      });

      const balanceSun: number = await tronWeb.trx.getBalance(address);
      const sendSun = balanceSun - TX_FEE_SUN;
      const sendTRX = sendSun / 1e6;

      if (sendTRX < MIN_SWEEP_TRX) {
        console.log(`  ↳ ${address} balance ${(balanceSun / 1e6).toFixed(2)} TRX too low — skip`);
        continue;
      }

      const tx     = await tronWeb.transactionBuilder.sendTrx(HOT_WALLET_TRX, sendSun, address);
      const signed = await tronWeb.trx.sign(tx, privateKey);
      const result = await tronWeb.trx.sendRawTransaction(signed);

      if (!result.result) {
        throw new Error(`Broadcast failed: ${JSON.stringify(result)}`);
      }

      await markDepositSwept(deposit.id, result.txid);
      console.log(`  ✅ TRX swept: ${sendTRX.toFixed(2)} TRX → ${HOT_WALLET_TRX} | txid: ${result.txid}`);
    } catch (err: any) {
      console.error(`  ✗ TRX sweep failed for deposit ${deposit.id}:`, err.message);
    }
  }
}

async function sweepTRC20(coin: 'USDT') {
  const HOT_WALLET_TRX = await getConfig('HOT_WALLET_TRX_ADDRESS');
  const HOT_WALLET_TRX_PRIVATE_KEY = await getConfig('HOT_WALLET_TRX_PRIVATE_KEY');
  const tronRpc     = await getConfig('TRON_RPC') ?? 'https://api.trongrid.io';
  const trongridKey = await getConfig('TRONGRID_API_KEY');
  const mnemonic     = await getConfig('MASTER_MNEMONIC');

  if (!HOT_WALLET_TRX || !HOT_WALLET_TRX_PRIVATE_KEY || !mnemonic) {
    console.log(`[trc20-sweeper/${coin}] Missing wallet config — skipping`);
    return;
  }

  const contractAddress = coin === 'USDT' ? USDT_TRC20_CONTRACT : null;
  if (!contractAddress) {
    console.log(`[trc20-sweeper/${coin}] No contract configured — skipping`);
    return;
  }

  const pending = await prisma.deposit.findMany({
    where: { network: 'tron_mainnet', coin: coin as any, status: 'CREDITED', sweptTx: null },
    include: { depositAddress: { select: { address: true, derivationPath: true } } },
  });

  if (pending.length === 0) return;
  console.log(`[trc20-sweeper/${coin}] ${pending.length} token sweep(s) pending`);

  const headers = trongridKey ? { 'TRON-PRO-API-KEY': trongridKey } : {};

  const hotWalletClient = new TronWeb({
    fullHost: tronRpc,
    privateKey: HOT_WALLET_TRX_PRIVATE_KEY,
    headers,
  });

  for (const deposit of pending) {
    try {
      const { address, derivationPath } = deposit.depositAddress;
      const privateKey = getPrivateKey(derivationPath, mnemonic);

      const depositClient = new TronWeb({ fullHost: tronRpc, privateKey, headers });
      const contract = await depositClient.contract().at(contractAddress);
      const rawBalance = await contract.balanceOf(address).call();
      const tokenBalance = BigInt(rawBalance.toString());

      if (tokenBalance === 0n) {
        console.log(`  ↳ ${address} — zero ${coin} balance, skipping`);
        continue;
      }

      const decimals = 6;
      const humanAmount = Number(tokenBalance) / 10 ** decimals;
      console.log(`  ↳ Sweeping ${humanAmount} ${coin} from ${address}`);

      const depositTrxBalance = await depositClient.trx.getBalance(address);
      if (depositTrxBalance / 1e6 < TRC20_FUNDING_TRX) {
        const fundTx = await hotWalletClient.transactionBuilder.sendTrx(
          address, TRC20_FUNDING_TRX * 1e6, HOT_WALLET_TRX
        );
        const fundSigned = await hotWalletClient.trx.sign(fundTx);
        const fundResult = await hotWalletClient.trx.sendRawTransaction(fundSigned);
        if (!fundResult.result) throw new Error(`Gas funding broadcast failed: ${JSON.stringify(fundResult)}`);
        await new Promise(r => setTimeout(r, 6_000));
      }

      const transferTx = await contract.transfer(HOT_WALLET_TRX, tokenBalance.toString()).send({
        feeLimit: 50_000_000,
      });

      await markDepositSwept(deposit.id, transferTx);
      console.log(`  ✅ TRC20 sweep complete: ${humanAmount} ${coin} → ${HOT_WALLET_TRX} | tx: ${transferTx}`);
    } catch (err: any) {
      console.error(`  ✗ TRC20 sweep failed for deposit ${deposit.id}:`, err.message);
    }
  }
}

export function startTronSweeper(intervalMs = 120_000) {
  console.log('🧹 TRX Sweeper started');

  const run = async () => {
    try {
      await sweepTRX();
    } catch (err: any) {
      console.error('[trx-sweeper]', err.message);
    }
  };

  run();
  setInterval(run, intervalMs);
}

export function startTRC20Sweeper(coin: 'USDT', intervalMs = 120_000) {
  console.log(`🧹 TRC20 Sweeper started: ${coin}`);
  const run = async () => {
    try { await sweepTRC20(coin); }
    catch (err: any) { console.error(`[trc20-sweeper/${coin}]`, err.message); }
  };
  run();
  setInterval(run, intervalMs);
}
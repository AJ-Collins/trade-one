import * as bitcoin from 'bitcoinjs-lib';
import * as bip39 from 'bip39';
import { BIP32Factory } from 'bip32';
import * as ecc from 'tiny-secp256k1';
import axios from 'axios';
import { ECPairFactory } from 'ecpair';
import { prisma } from '../prisma.js';
import { markDepositSwept } from '../services/depositService.js';
import { getConfig } from '../utils/configLoader.js';

const bip32 = BIP32Factory(ecc);
const ECPair = ECPairFactory(ecc);

const NETWORK_CONFIG: Record<string, { btcNetwork: bitcoin.Network }> = {
  btc_mainnet: { btcNetwork: bitcoin.networks.bitcoin },
  btc_testnet: { btcNetwork: bitcoin.networks.testnet },
};

// Same robust multi-provider fallback logic as the listener to avoid IP bans
const BTC_APIS: Record<string, string[]> = {
  btc_mainnet: [
    'https://blockstream.info/api',
    'https://mempool.space/api',
    'https://mempool.emzy.de/api', // Public mirror
  ],
  btc_testnet: ['https://mempool.space/testnet/api'],
};

const activeApiIndex: Record<string, number> = {
  btc_mainnet: 0,
  btc_testnet: 0,
};

async function btcApiRequestWithBase<T>(network: string, requestFn: (base: string) => Promise<T>): Promise<T> {
  const apis = BTC_APIS[network];
  if (!apis) throw new Error(`No APIs defined for ${network}`);

  let currentApi = activeApiIndex[network] ?? 0;

  for (let attempt = 0; attempt < apis.length; attempt++) {
    const base = apis[currentApi];

    // Try the current API up to 2 times
    for (let retry = 0; retry < 2; retry++) {
      try {
        return await requestFn(base);
      } catch (err: any) {
        const status = err.response?.status;
        if (status === 429 || (status >= 500 && status < 600) || !status) {
          const delay = 2000 * (retry + 1);
          console.warn(`[BTC Sweeper] Rate limited/transient error for ${base}. Retrying in ${delay}ms...`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        throw err; // Non-retryable error (e.g., 400 Bad Request)
      }
    }

    console.warn(`[BTC Sweeper] API ${base} exhausted retries. Rotating to fallback provider.`);
    currentApi = (currentApi + 1) % apis.length;
    activeApiIndex[network] = currentApi;
  }

  throw new Error(`All BTC API providers failed for ${network}`);
}

// Below this in satoshis after fees, the output is uneconomical to sweep
const DUST_LIMIT_SATS = 546n;

interface UTXO {
  txid: string;
  vout: number;
  value: bigint;       // satoshis
  confirmed: boolean;
}

function deriveKeyPair(derivationPath: string, btcNetwork: bitcoin.Network, mnemonic: string) {
  const seed = bip39.mnemonicToSeedSync(mnemonic);
  const root = bip32.fromSeed(seed, btcNetwork);
  const child = root.derivePath(derivationPath);

  // ECPair is what PSBT.signInput() needs for P2WPKH
  return ECPair.fromWIF(child.toWIF(), btcNetwork);
}

async function getFeeRateSatVbyte(network: string): Promise<number> {
  try {
    const data = await btcApiRequestWithBase(network, base =>
      axios.get(`${base}/v1/fees/recommended`, { timeout: 8_000 }).then(r => r.data)
    );
    return Math.max(data.fastestFee ?? 10, 2);
  } catch {
    return 10;
  }
}

async function getUTXOs(address: string, network: string): Promise<UTXO[]> {
  const data = await btcApiRequestWithBase(network, base =>
    axios.get(`${base}/address/${address}/utxo`, { timeout: 10_000 }).then(r => r.data)
  );
  return (data as any[]).map(u => ({ txid: u.txid, vout: u.vout, value: BigInt(u.value), confirmed: !!u.status?.confirmed }));
}

async function broadcastTx(txHex: string, network: string): Promise<string> {
  return btcApiRequestWithBase(network, base =>
    axios.post(`${base}/tx`, txHex, { headers: { 'Content-Type': 'text/plain' }, timeout: 15_000 }).then(r => r.data)
  );
}

// Estimate vbytes for a P2WPKH-to-P2WPKH transaction:
//   overhead: 10 vbytes
//   per input (P2WPKH): 41 non-witness + (1+1+73+1+33)/4 witness ≈ 68 vbytes
//   per output (P2WPKH): 31 vbytes
function estimateVbytes(inputCount: number, outputCount = 1): number {
  return 10 + inputCount * 68 + outputCount * 31;
}

async function sweepBTC(network: string) {
  const HOT_WALLET_BTC = await getConfig('HOT_WALLET_BTC_ADDRESS');
  if (!HOT_WALLET_BTC) {
    console.log(`[btc-sweeper/${network}] HOT_WALLET_BTC_ADDRESS not configured — skipping`);
    return;
  }

  const { btcNetwork } = NETWORK_CONFIG[network];

  const pending = await prisma.deposit.findMany({
    where: { network, coin: 'BTC', status: 'CREDITED', sweptTx: null },
    include: { depositAddress: { select: { address: true, derivationPath: true } } },
  });

  if (pending.length === 0) return;
  console.log(`[btc-sweeper/${network}] ${pending.length} deposit(s) to sweep`);

  const feeRate = await getFeeRateSatVbyte(network);

  for (const deposit of pending) {
    try {
      const { address, derivationPath } = deposit.depositAddress;
      const allUTXOs = await getUTXOs(address, network);
      const utxos = allUTXOs.filter(u => u.confirmed);

      if (utxos.length === 0) {
        console.log(`  ↳ ${address} — no confirmed UTXOs`);
        continue;
      }

      const totalSats = utxos.reduce((sum, u) => sum + u.value, 0n);
      const vbytes = estimateVbytes(utxos.length, 1);
      const feeSats = BigInt(vbytes) * BigInt(feeRate);
      const sendSats = totalSats - feeSats;

      if (sendSats < DUST_LIMIT_SATS) {
        console.log(
          `  ↳ ${address} — ${totalSats} sat total, ${feeSats} sat fee → ${sendSats} sat remaining is dust, skipping`,
        );
        continue;
      }

      const mnemonic = await getConfig('MASTER_MNEMONIC');
      if (!mnemonic) throw new Error('MASTER_MNEMONIC not configured');
      const keyPair = deriveKeyPair(derivationPath, btcNetwork, mnemonic);
      const psbt = new bitcoin.Psbt({ network: btcNetwork });

      // ── CRITICAL: P2WPKH inputs MUST use witnessUtxo, not nonWitnessUtxo ──
      // nonWitnessUtxo (raw previous tx) is for legacy P2PKH. Using it for
      // SegWit will cause most nodes to reject the transaction. witnessUtxo
      // provides just the output being spent (value + scriptPubKey), which
      // is all that's needed to sign a P2WPKH input.
      const p2wpkh = bitcoin.payments.p2wpkh({
        pubkey: keyPair.publicKey,
        network: btcNetwork,
      });

      for (const utxo of utxos) {
        psbt.addInput({
          hash: utxo.txid,
          index: utxo.vout,
          witnessUtxo: {
            script: p2wpkh.output!,
            value: utxo.value,
          },
        });
      }

      psbt.addOutput({ address: HOT_WALLET_BTC, value: sendSats });

      // Sign all inputs with the same key (all UTXOs belong to this one address)
      for (let i = 0; i < utxos.length; i++) {
        psbt.signInput(i, keyPair);

        const isValid = psbt.validateSignaturesOfInput(i, (pubkey, msghash, signature) => {
          return keyPair.verify(msghash, signature);
        });

        if (!isValid) {
          throw new Error(`Signature validation failed for input ${i}`);
        }
      }

      psbt.finalizeAllInputs();
      const txHex = psbt.extractTransaction().toHex();
      const txid = await broadcastTx(txHex, network);

      await markDepositSwept(deposit.id, txid);
      console.log(
        `  ✅ BTC swept: ${sendSats} sat (${(Number(sendSats) / 1e8).toFixed(8)} BTC) → ${HOT_WALLET_BTC} | txid: ${txid}`,
      );
    } catch (err: any) {
      const detail = err?.response?.data
        ? JSON.stringify(err.response.data)
        : err?.message || err?.code || String(err);
      console.error(`  ✗ BTC sweep failed for deposit ${deposit.id}:`, detail);
    }
  }
}

export function startBTCSweeper(network: string, intervalMs = 120_000) {
  if (!NETWORK_CONFIG[network]) throw new Error(`Unknown BTC network: ${network}`);
  console.log(`🧹 BTC Sweeper started: ${network}`);

  const run = async () => {
    try { await sweepBTC(network); }
    catch (err: any) { console.error(`[btc-sweeper/${network}]`, err.message); }
  };

  run();
  setInterval(run, intervalMs);
}
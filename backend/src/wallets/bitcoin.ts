import * as bitcoin from 'bitcoinjs-lib';
import * as bip39 from 'bip39';
import { BIP32Factory } from 'bip32';
import * as ecc from 'tiny-secp256k1';
import { getConfig } from '../utils/configLoader.js';

const bip32 = BIP32Factory(ecc);

// BIP84: m/84'/coin_type'/account'/change/index
// coin_type 0 = mainnet, 1 = testnet
// This produces native SegWit P2WPKH (bc1q...) addresses — the standard
// since 2018. Lower fees than legacy P2PKH and required for PSBT signing.
export async function generateBTCAddress(
  hdAccountIndex: number,
  network: 'btc_mainnet' | 'btc_testnet' = 'btc_mainnet',
  index = 0,
) {
  const btcNetwork = network === 'btc_mainnet'
    ? bitcoin.networks.bitcoin
    : bitcoin.networks.testnet;

  const coinType = network === 'btc_mainnet' ? 0 : 1;

  const mnemonic = await getConfig('MASTER_MNEMONIC');
  if (!mnemonic) throw new Error('MASTER_MNEMONIC not set in config');
  const seed = bip39.mnemonicToSeedSync(mnemonic);
  const root = bip32.fromSeed(seed, btcNetwork);

  // BIP84 path — purpose=84 for P2WPKH
  const path = `m/84'/${coinType}'/${hdAccountIndex}'/0/${index}`;
  const child = root.derivePath(path);

  const { address } = bitcoin.payments.p2wpkh({
    pubkey: child.publicKey,
    network: btcNetwork,
  });

  if (!address) throw new Error(`Failed to derive BTC address at ${path}`);

  return {
    address,
    path,
    // WIF only used internally by sweeper — never returned to the client
    privateKeyWIF: child.toWIF(),
  };
}
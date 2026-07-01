import * as bip39 from 'bip39';
import { derivePath } from 'ed25519-hd-key';
import { Keypair } from '@solana/web3.js';
import { getConfig } from '../utils/configLoader.js';

export async function generateSolanaAddress(hdAccountIndex: number, index = 0) {
  const mnemonic = await getConfig('MASTER_MNEMONIC');
  if (!mnemonic) throw new Error('MASTER_MNEMONIC not set in config');
  const seed = bip39.mnemonicToSeedSync(mnemonic);
  const path = `m/44'/501'/${hdAccountIndex}'/0'`;
  const { key } = derivePath(path, seed.toString('hex'));
  const keypair = Keypair.fromSeed(key);
  return {
    address: keypair.publicKey.toBase58(),
    path,
    privateKey: Buffer.from(keypair.secretKey).toString('hex'),
  };
}
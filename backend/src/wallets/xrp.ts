import * as bip39 from 'bip39';
import { ethers } from 'ethers';
import { Wallet } from 'xrpl';
import { getConfig } from '../utils/configLoader.js';

export async function generateXRPAddress(hdAccountIndex: number, index = 0) {
  const mnemonic = await getConfig('MASTER_MNEMONIC');
  if (!mnemonic) throw new Error('MASTER_MNEMONIC not set in config');
  const seed = bip39.mnemonicToSeedSync(mnemonic);
  const masterNode = ethers.utils.HDNode.fromSeed(seed);
  const path = `m/44'/144'/${hdAccountIndex}'/0/${index}`;
  const node = masterNode.derivePath(path);
  const xrpWallet = Wallet.fromEntropy(
    Buffer.from(node.privateKey.slice(2), 'hex')
  );
  return {
    address: xrpWallet.classicAddress,
    path,
    secret: xrpWallet.seed,
  };
}
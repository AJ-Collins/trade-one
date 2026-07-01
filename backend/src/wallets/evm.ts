import * as bip39 from 'bip39';
import { ethers } from 'ethers';
import { getConfig } from '../utils/configLoader.js';

export async function generateEVMAddress(hdAccountIndex: number, index = 0) {
  const mnemonic = await getConfig('MASTER_MNEMONIC');
  if (!mnemonic) throw new Error('MASTER_MNEMONIC not set in config');
  const seed = bip39.mnemonicToSeedSync(mnemonic);
  const masterNode = ethers.utils.HDNode.fromSeed(seed);
  const path = `m/44'/60'/${hdAccountIndex}'/0/${index}`;
  const node = masterNode.derivePath(path);
  return {
    address: node.address,
    path,
    privateKey: node.privateKey, // never expose, server-side sweep only
  };
}
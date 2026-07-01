import * as bip39 from 'bip39';
import { ethers } from 'ethers';
import { TronWeb } from 'tronweb';
import { getConfig } from '../utils/configLoader.js';

export async function generateTronAddress(hdAccountIndex: number, index = 0) {
  const mnemonic = await getConfig('MASTER_MNEMONIC');
  if (!mnemonic) throw new Error('MASTER_MNEMONIC not set in config');
  const seed = bip39.mnemonicToSeedSync(mnemonic);
  const masterNode = ethers.utils.HDNode.fromSeed(seed);
  const path = `m/44'/195'/${hdAccountIndex}'/0/${index}`;
  const node = masterNode.derivePath(path);

  const address = TronWeb.address.fromPrivateKey(node.privateKey.slice(2));
  if (!address) throw new Error(`Failed to generate Tron address for index ${hdAccountIndex}`);

  return {
    address,
    path,
    privateKey: node.privateKey,
  };
}
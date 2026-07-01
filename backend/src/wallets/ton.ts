import * as bip39 from 'bip39';
import { ethers } from 'ethers';
import { mnemonicToPrivateKey } from '@ton/crypto';
import { WalletContractV4 } from '@ton/ton';
import { getConfig } from '../utils/configLoader.js';

export async function generateTONAddress(hdAccountIndex: number) {
  const mnemonic = await getConfig('MASTER_MNEMONIC');
  if (!mnemonic) throw new Error('MASTER_MNEMONIC not set in config');
  const seed = bip39.mnemonicToSeedSync(mnemonic);
  const masterNode = ethers.utils.HDNode.fromSeed(seed);
  const path = `m/44'/607'/${hdAccountIndex}'/0/0`;
  const node = masterNode.derivePath(path);

  // Convert derived private key bytes into a TON keypair
  const privateKeyBytes = Buffer.from(node.privateKey.slice(2), 'hex');
  const keyPair = await mnemonicToPrivateKey(
    bip39.entropyToMnemonic(privateKeyBytes.slice(0, 16)).split(' ')
  );

  const wallet = WalletContractV4.create({
    workchain: 0,
    publicKey: keyPair.publicKey,
  });

  return {
    address: wallet.address.toString({ bounceable: false }),
    path,
    privateKey: Buffer.from(keyPair.secretKey).toString('hex'),
  };
}
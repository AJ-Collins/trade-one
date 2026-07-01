export const SUPPORTED_NETWORKS = [
  'eth_mainnet',
  'bsc_mainnet',
  'polygon_mainnet',
  'arbitrum_mainnet',
  'btc_mainnet',
  'solana_mainnet',
  'ton_mainnet',
  'tron_mainnet',
] as const;

export type SupportedNetwork = typeof SUPPORTED_NETWORKS[number];

export function isSupportedNetwork(n: string): n is SupportedNetwork {
  return (SUPPORTED_NETWORKS as readonly string[]).includes(n);
}

export const NATIVE_COIN: Record<SupportedNetwork, string> = {
  eth_mainnet:      'ETH',
  bsc_mainnet:      'BNB',
  polygon_mainnet:  'MATIC',
  arbitrum_mainnet: 'ETH',
  btc_mainnet:      'BTC',
  solana_mainnet:   'SOL',
  ton_mainnet:      'TON',
  tron_mainnet:     'TRX',
};

// Alchemy covers EVM chains only
export const ALCHEMY_NETWORK_MAP: Record<string, SupportedNetwork> = {
  'ETH_MAINNET':   'eth_mainnet',
  'BSC_MAINNET':   'bsc_mainnet',
  'MATIC_MAINNET': 'polygon_mainnet',
  'ARB_MAINNET':   'arbitrum_mainnet',
};

export const NETWORK_WEBHOOK_MAP: Partial<Record<SupportedNetwork, string>> = {
  eth_mainnet:      process.env.ALCHEMY_WEBHOOK_ETH_MAINNET,
  bsc_mainnet:      process.env.ALCHEMY_WEBHOOK_BSC_MAINNET,
  polygon_mainnet:  process.env.ALCHEMY_WEBHOOK_POLYGON,
  arbitrum_mainnet: process.env.ALCHEMY_WEBHOOK_ARBITRUM,
};

import { getConfig } from '../utils/configLoader.js';

export async function getStablecoinContracts(network: SupportedNetwork) {
  const contracts: Record<string, { symbol: string; decimals: number }> = {};
  
  if (network === 'eth_mainnet') {
    const usdt = await getConfig('ETH_USDT_CONTRACT');
    const usdc = await getConfig('ETH_USDC_CONTRACT');
    if (usdt) contracts[usdt.toLowerCase()] = { symbol: 'USDT', decimals: 6 };
    if (usdc) contracts[usdc.toLowerCase()] = { symbol: 'USDC', decimals: 6 };
  } else if (network === 'bsc_mainnet') {
    const usdt = await getConfig('BSC_USDT_CONTRACT');
    const usdc = await getConfig('BSC_USDC_CONTRACT');
    if (usdt) contracts[usdt.toLowerCase()] = { symbol: 'USDT', decimals: 18 };
    if (usdc) contracts[usdc.toLowerCase()] = { symbol: 'USDC', decimals: 18 };
  } else if (network === 'polygon_mainnet') {
    const usdt = await getConfig('POLYGON_USDT_CONTRACT');
    const usdc = await getConfig('POLYGON_USDC_CONTRACT');
    if (usdt) contracts[usdt.toLowerCase()] = { symbol: 'USDT', decimals: 6 };
    if (usdc) contracts[usdc.toLowerCase()] = { symbol: 'USDC', decimals: 6 };
  } else if (network === 'arbitrum_mainnet') {
    const usdt = await getConfig('ARBITRUM_USDT_CONTRACT');
    const usdc = await getConfig('ARBITRUM_USDC_CONTRACT');
    if (usdt) contracts[usdt.toLowerCase()] = { symbol: 'USDT', decimals: 6 };
    if (usdc) contracts[usdc.toLowerCase()] = { symbol: 'USDC', decimals: 6 };
  }
  
  return contracts;
}

// Maps internal network keys to their RPC config key (used by deposit worker
// to re-fetch live confirmation counts on retry instead of trusting stale
// webhook payload data).
export const NETWORK_RPC_CONFIG_KEY: Partial<Record<SupportedNetwork, string>> = {
  eth_mainnet:      'ETH_MAINNET_RPC',
  bsc_mainnet:      'BSC_MAINNET_RPC',
  polygon_mainnet:  'POLYGON_MAINNET_RPC',
  arbitrum_mainnet: 'ARBITRUM_MAINNET_RPC',
};
import { startEVMSweeper }  from '../sweepers/evm-sweeper.js';
import { startERC20Sweeper } from '../sweepers/erc20-sweeper.js';
import { startBTCSweeper }  from '../sweepers/btc-sweeper.js';
import { startSOLSweeper }  from '../sweepers/solana-sweeper.js';
import { startTONSweeper }  from '../sweepers/ton-sweeper.js';
import { startTronSweeper,startTRC20Sweeper } from '../sweepers/tron-sweeper.js';

// Define which production EVM networks have active stablecoin sweepers
const ERC20_NETWORKS: Record<string, string[]> = {
  eth_mainnet:      ['USDT', 'USDC'],
  bsc_mainnet:      ['USDT', 'USDC'],
  polygon_mainnet:  ['USDT', 'USDC'],
  arbitrum_mainnet: ['USDT', 'USDC'],
};

const EVM_NETWORKS = [
  'eth_mainnet', 
  'bsc_mainnet', 
  'polygon_mainnet', 
  'arbitrum_mainnet',
];

const INTERVAL = Number(process.env.SWEEP_INTERVAL_MS || 120_000);

// Initialize EVM native (ETH/BNB/MATIC) + ERC20/BEP20 (USDT/USDC) sweepers
for (const network of EVM_NETWORKS) {
  startEVMSweeper(network, INTERVAL);
  for (const coin of ERC20_NETWORKS[network] ?? []) {
    startERC20Sweeper(network, coin, INTERVAL);
  }
}

// BTC — Production Mainnet only
startBTCSweeper('btc_mainnet', INTERVAL);

// Non-EVM single-network mainnet chains
startSOLSweeper(INTERVAL);
startTONSweeper(INTERVAL);
startTronSweeper(INTERVAL);
startTRC20Sweeper('USDT', INTERVAL);

console.log('[SweeperWorker] All sweepers started.');

process.on('SIGTERM', () => {
  console.log('[SweeperWorker] Shutting down gracefully...');
  process.exit(0);
});
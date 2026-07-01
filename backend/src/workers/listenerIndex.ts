import { startBTCListener }    from '../listeners/btc-listener.js';
import { startSolanaListener } from '../listeners/solana-listener.js';
import { startTONListener }    from '../listeners/ton-listener.js';
import { startTronListener }   from '../listeners/tron-listener.js';

import { startEVMReconciler }  from '../services/reconciliationService.js';

// EVM chains are NOT listed here — they're detected by Alchemy webhooks
// (push-based), which is more reliable and faster than polling for EVM.
// These listeners cover only the chains Alchemy doesn't support.

// Bitcoin Mainnet Polling
startBTCListener('btc_mainnet', 60_000);

// Non-EVM Production Listeners
startSolanaListener(15_000);  // Helius free tier handles this rate fine
startTONListener(30_000);     // Toncenter free tier: ~1 req/s, so 3 addresses/poll
startTronListener(15_000);    // TronGrid free tier handles this rate fine

// EVM Safety Net Reconciler
startEVMReconciler(300_000);  // Every 5 minutes

console.log('[ListenerWorker] All block listeners started.');

process.on('SIGTERM', () => {
  process.exit(0);
});
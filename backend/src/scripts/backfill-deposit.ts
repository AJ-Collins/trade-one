/**
 * One-off manual backfill for a specific deposit tx that's too old for the
 * fallback poller to ever reach (poller only scans forward from wherever its
 * cursor currently sits — it doesn't retroactively backfill history).
 *
 * Usage:
 *   npx tsx src/scripts/backfill-deposit.ts arbitrum_mainnet 0xfa49208ad9b81358127a7c5c577c1286380d83fd0899c9202a0014f068f8a120
 *
 * Safe to run even if the deposit was already credited — creditDeposit()
 * dedupes on txHash and will just report "already exists" and exit cleanly.
 *
 * This is now a thin wrapper around backfillDepositService — the same logic
 * is exposed via the admin API route (POST /admin/deposits/backfill) so you
 * don't need SSH/docker exec to trigger it.
 */
import { backfillDepositTx } from '../services/backfillDepositService.js';
import { SupportedNetwork } from '../config/networks.js';

async function main() {
  const [, , networkArg, txHashArg] = process.argv;
  if (!networkArg || !txHashArg) {
    console.error('Usage: npx tsx src/scripts/backfill-deposit.ts <network> <txHash>');
    process.exit(1);
  }

  const network = networkArg as SupportedNetwork;
  console.log(`[Backfill] Processing ${txHashArg} on ${network}...`);

  const result = await backfillDepositTx(network, txHashArg);

  switch (result.status) {
    case 'not_found':
      console.error(`[Backfill] No receipt found — tx may not exist or hasn't mined yet.`);
      process.exit(1);
      break;

    case 'no_match':
      console.log(`[Backfill] No matching watched addresses found in this transaction's logs.`);
      break;

    case 'already_credited':
      console.log(`[Backfill] Already credited previously — no action taken (this is safe/expected).`);
      break;

    case 'credited':
      for (const c of result.credits) {
        console.log(
          `[Backfill] ✅ Credited $${c.usdValue.toFixed(2)} (${c.amount} ${c.symbol}) to user ${c.userId}`
        );
      }
      break;
  }

  process.exit(0);
}

main().catch(err => {
  console.error('[Backfill] Fatal error:', err);
  process.exit(1);
});
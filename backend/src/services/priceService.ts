import axios from 'axios';
import { redis } from '../lib/redis.js';

type PricedCoin = 'ETH' | 'BNB' | 'BTC' | 'SOL' | 'TRX' | 'TON' | 'MATIC' | 'LTC' | 'DOGE' | 'XRP';

const COINGECKO_IDS: Record<PricedCoin, string> = {
  ETH:   'ethereum',
  BNB:   'binancecoin',
  BTC:   'bitcoin',
  SOL:   'solana',
  TRX:   'tron',
  TON:   'the-open-network',
  MATIC: 'matic-network',
  LTC:   'litecoin',
  DOGE:  'dogecoin',
  XRP:   'ripple',
};

const SUPPORTED_PRICED_COINS = new Set<string>(Object.keys(COINGECKO_IDS));

const CACHE_TTL_SECONDS = 30; // matches old in-memory TTL
const STALE_FALLBACK_TTL_SECONDS = 60 * 10; // keep a stale value around for 10 min as last-resort fallback
const CACHE_KEY_PREFIX = 'price:';
const STALE_KEY_PREFIX = 'price:stale:';

async function fetchFromCoinGecko(coin: PricedCoin): Promise<number> {
  const id = COINGECKO_IDS[coin];
  const { data } = await axios.get(
    `https://api.coingecko.com/api/v3/simple/price`,
    { params: { ids: id, vs_currencies: 'usd' }, timeout: 5000 }
  );
  const price = data?.[id]?.usd;
  if (typeof price !== 'number' || price <= 0) {
    throw new Error(`CoinGecko returned invalid price for ${coin}`);
  }
  return price;
}

/**
 * Get a live USD price for a native coin, cached in Redis (shared across
 * all app instances, survives restarts) with a longer-lived stale fallback
 * if CoinGecko is briefly unreachable.
 * Stablecoins (USDT/USDC) are always treated as $1 — no network call needed.
 */
export async function getUsdRate(coin: string): Promise<number> {
  const upper = coin.toUpperCase();
  if (upper === 'USDT' || upper === 'USDC') return 1;

  if (!SUPPORTED_PRICED_COINS.has(upper)) {
    throw new Error(`No price feed configured for coin: ${coin}`);
  }
  const pricedCoin = upper as PricedCoin;
  const cacheKey = `${CACHE_KEY_PREFIX}${pricedCoin}`;
  const staleKey = `${STALE_KEY_PREFIX}${pricedCoin}`;

  // Fast path: fresh cache hit.
  const cached = await redis.get(cacheKey);
  if (cached) return parseFloat(cached);

  try {
    const price = await fetchFromCoinGecko(pricedCoin);
    // Fresh cache (short TTL) + stale fallback (longer TTL).
    await redis
      .multi()
      .set(cacheKey, price.toString(), 'EX', CACHE_TTL_SECONDS)
      .set(staleKey, price.toString(), 'EX', STALE_FALLBACK_TTL_SECONDS)
      .exec();
    return price;
  } catch (err: any) {
    console.error(`[PriceService] Live fetch failed for ${pricedCoin}:`, err.message);

    const stale = await redis.get(staleKey);
    if (stale) {
      console.warn(`[PriceService] Using stale Redis-cached price for ${pricedCoin}`);
      return parseFloat(stale);
    }
    throw new Error(`Unable to determine USD price for ${pricedCoin} and no cached fallback available`);
  }
}
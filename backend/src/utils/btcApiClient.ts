import axios from 'axios';

const BTC_APIS: Record<string, string[]> = {
  btc_mainnet: [
    'https://blockstream.info/api',
    'https://mempool.space/api',
    'https://mempool.emzy.de/api',
  ],
  btc_testnet: ['https://mempool.space/testnet/api'],
};

const activeApiIndex: Record<string, number> = { btc_mainnet: 0, btc_testnet: 0 };

// ... same rotate/retry pattern as fetchWithFallback in btc-listener.ts,
// but generalized to accept a request function so it works for GET and POST alike.
export async function btcApiRequestWithBase(
  network: string,
  buildRequest: (base: string) => Promise<any>,
): Promise<any> {
  const apis = BTC_APIS[network];
  if (!apis) throw new Error(`No APIs defined for ${network}`);
  let currentApi = activeApiIndex[network] ?? 0;

  for (let attempt = 0; attempt < apis.length; attempt++) {
    const base = apis[currentApi];
    for (let retry = 0; retry < 2; retry++) {
      try {
        return await buildRequest(base);
      } catch (err: any) {
        const status = err.response?.status;
        if (status === 429 || (status >= 500 && status < 600) || !status) {
          const delay = 2000 * (retry + 1);
          console.warn(`[BTC] Rate limited/transient error for ${base}. Retrying in ${delay}ms...`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        throw err;
      }
    }
    console.warn(`[BTC] API ${base} exhausted retries. Rotating to fallback provider.`);
    currentApi = (currentApi + 1) % apis.length;
    activeApiIndex[network] = currentApi;
  }
  throw new Error(`All BTC API providers failed for ${network}`);
}
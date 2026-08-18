// rpc-proxy/server.ts
import express from 'express';
import axios from 'axios';

const app = express();
app.use(express.json());

const PROVIDERS: Record<string, string[]> = {
  eth: [
    'https://eth.drpc.org',
    'https://eth.llamarpc.com',
    'https://cloudflare-eth.com',
    'https://ethereum.publicnode.com',
  ],
  polygon: [
    'https://polygon.drpc.org',
    'https://polygon.llamarpc.com',
    'https://polygon-bor-rpc.publicnode.com',
  ],
  arbitrum: [
    'https://arbitrum.drpc.org',
    'https://arbitrum.llamarpc.com',
    'https://arbitrum-one-rpc.publicnode.com',
  ],
  bsc: [
    'https://bsc-dataseed.binance.org',   // Binance's own — no limits
    'https://bsc-dataseed1.defibit.io',   // Community — no limits
    'https://bsc-dataseed1.ninicoin.io',  // Community — no limits
    'https://bsc.drpc.org',
  ],
};

// Health state per provider
const health: Record<string, { failures: number; lastFail: number }> = {};
const FAILURE_THRESHOLD = 3;
const COOLDOWN_MS = 60_000; // 1 minute cooldown after threshold hit

function isHealthy(url: string): boolean {
  const h = health[url];
  if (!h) return true;
  if (h.failures >= FAILURE_THRESHOLD) {
    // Check if cooldown has passed — give it another chance
    if (Date.now() - h.lastFail > COOLDOWN_MS) {
      h.failures = 0;
      return true;
    }
    return false;
  }
  return true;
}

function markFailure(url: string) {
  if (!health[url]) health[url] = { failures: 0, lastFail: 0 };
  health[url].failures++;
  health[url].lastFail = Date.now();
  console.warn(`[RPC Proxy] ${url} failure #${health[url].failures}`);
}

function markSuccess(url: string) {
  if (health[url]) health[url].failures = 0;
}

async function forwardRequest(chain: string, body: any): Promise<any> {
  const providers = PROVIDERS[chain];
  if (!providers) throw new Error(`Unknown chain: ${chain}`);

  // Try each healthy provider in order
  for (const url of providers) {
    if (!isHealthy(url)) {
      console.log(`[RPC Proxy] Skipping unhealthy provider: ${url}`);
      continue;
    }

    try {
      const response = await axios.post(url, body, {
        timeout: 8_000,
        headers: { 'Content-Type': 'application/json' },
      });

      // Check for rate limit errors in the response body
      const data = response.data;
      if (data?.error?.code === -32000 || data?.error?.message?.includes('rate')) {
        markFailure(url);
        console.warn(`[RPC Proxy] Rate limited by ${url}, trying next...`);
        continue;
      }

      markSuccess(url);
      return data;
    } catch (err: any) {
      markFailure(url);
      console.warn(`[RPC Proxy] ${url} error: ${err.message}, trying next...`);
    }
  }

  throw new Error(`All providers failed for chain: ${chain}`);
}

// Routes: one per chain
app.post('/eth',      async (req, res) => { try { res.json(await forwardRequest('eth', req.body));      } catch (e: any) { res.status(502).json({ error: e.message }); } });
app.post('/polygon',  async (req, res) => { try { res.json(await forwardRequest('polygon', req.body));  } catch (e: any) { res.status(502).json({ error: e.message }); } });
app.post('/arbitrum', async (req, res) => { try { res.json(await forwardRequest('arbitrum', req.body)); } catch (e: any) { res.status(502).json({ error: e.message }); } });
app.post('/bsc',      async (req, res) => { try { res.json(await forwardRequest('bsc', req.body));      } catch (e: any) { res.status(502).json({ error: e.message }); } });

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    providers: Object.fromEntries(
      Object.entries(PROVIDERS).map(([chain, urls]) => [
        chain,
        urls.map(url => ({ url, healthy: isHealthy(url), failures: health[url]?.failures ?? 0 }))
      ])
    )
  });
});

const PORT = 3099;
app.listen(PORT, '127.0.0.1', () => {
  console.log(`[RPC Proxy] Running on http://127.0.0.1:${PORT}`);
});
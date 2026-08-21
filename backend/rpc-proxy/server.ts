import express from 'express';
import axios from 'axios';

const app = express();
app.use(express.json({ limit: '10mb' }));

const PROVIDERS: Record<string, string[]> = {
  eth: [
    'https://ethereum.publicnode.com',
    'https://rpc.payload.de',
    'https://eth.drpc.org',
    `https://rpc.ankr.com/eth/${process.env.ANKR_KEY}`,
  ],
  polygon: [
    'https://polygon-bor-rpc.publicnode.com',
    'https://polygon.drpc.org',
    `https://rpc.ankr.com/polygon/${process.env.ANKR_KEY}`,
  ],
  arbitrum: [
    'https://arbitrum-one-rpc.publicnode.com',
    'https://arb1.arbitrum.io/rpc',
    'https://arbitrum.drpc.org',
    `https://rpc.ankr.com/arbitrum/${process.env.ANKR_KEY}`,
  ],
  bsc: [
    'https://bsc-dataseed.binance.org',
    'https://bsc-dataseed1.defibit.io',
    `https://rpc.ankr.com/bsc/${process.env.ANKR_KEY}`,
    'https://bsc-rpc.publicnode.com',
  ],
};

const health: Record<string, { failures: number; lastFail: number }> = {};
const FAILURE_THRESHOLD = 3;
const COOLDOWN_MS = 120_000;

function isHealthy(url: string): boolean {
  const h = health[url];
  if (!h) return true;
  if (h.failures >= FAILURE_THRESHOLD) {
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

  for (const url of providers) {
    if (!isHealthy(url)) continue;

    try {
      const response = await axios.post(url, body, {
        timeout: 10_000,
        headers: { 'Content-Type': 'application/json' },
      });

      const data = response.data;
      // Check for rate limit / limit exceeded errors in body
      const errMsg = data?.error?.message ?? '';
      const errCode = data?.error?.code;
      if (
        errCode === -32005 ||
        errMsg.toLowerCase().includes('rate') ||
        errMsg.toLowerCase().includes('limit exceeded') ||
        errMsg.toLowerCase().includes('too many')
      ) {
        markFailure(url);
        console.warn(`[RPC Proxy] ${url} rate/limit error, trying next...`);
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

app.post('/eth',      async (req, res) => { try { res.json(await forwardRequest('eth', req.body));      } catch (e: any) { res.status(502).json({ error: e.message }); } });
app.post('/polygon',  async (req, res) => { try { res.json(await forwardRequest('polygon', req.body));  } catch (e: any) { res.status(502).json({ error: e.message }); } });
app.post('/arbitrum', async (req, res) => { try { res.json(await forwardRequest('arbitrum', req.body)); } catch (e: any) { res.status(502).json({ error: e.message }); } });
app.post('/bsc',      async (req, res) => { try { res.json(await forwardRequest('bsc', req.body));      } catch (e: any) { res.status(502).json({ error: e.message }); } });

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
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[RPC Proxy] Running on port ${PORT}`);
});
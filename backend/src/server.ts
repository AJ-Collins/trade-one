import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import http from 'http';
import path from 'path';
import helmet from 'helmet';
import authRoutes from './routes/authRoutes.js';
import marketerRoutes from './routes/marketerRoutes.js';
import userRoutes from './routes/userRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import { botRoutes } from './routes/botRoutes.js';
import depositRoutes from './routes/depositRoutes.js';
import withdrawalRoutes from './routes/withdrawalRoutes.js';
import kycRoutes from './routes/kycRoutes.js';
import webhookRoutes from './routes/webhookRoutes.js';
import { setupWebSocket } from "./ws.js";
import { resumeRunningProBots } from "./services/botEngineService.js";
import { syncExistingAddressesWithAlchemy } from './services/depositService.js';

dotenv.config();
const app = express();
app.use(helmet());
app.set('trust proxy', 1);
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.path === '/health') {
      return next();
    }

    if (req.method === 'OPTIONS') {
      return next();
    }

    if (req.header('x-forwarded-proto') !== 'https') {
      return res.redirect(`https://${req.header('host')}${req.url}`);
    }

    next();
  });
}
const port = Number(process.env.PORT) || 5000;

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173')
  .split(',')
  .map(o => o.trim());

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    callback(new Error(`CORS blocked: ${origin}`));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cache-Control', 'Pragma', 'Expires'],
  credentials: true,
}));

// Webhook routes MUST be mounted before the global JSON parser, because
// they need the raw request body for Alchemy's HMAC signature verification.
// express.json() inside webhookRoutes (via express.raw()) only works if
// nothing upstream has already consumed the request stream.
app.use('/api/webhooks', webhookRoutes);

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

app.use('/uploads', express.static(path.join(import.meta.dirname, '../uploads')));

app.get('/', (req, res) => {
  res.json({ message: 'API is running' });
});

// Routes
app.get('/health', (_req, res) => res.json({ ok: true }));
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/bot', botRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/marketer', marketerRoutes);
app.use('/api/deposit', depositRoutes);
app.use('/api/withdraw', withdrawalRoutes);
app.use('/api/kyc', kycRoutes);

const server = http.createServer(app);
setupWebSocket(server);

import { getConfig } from './utils/configLoader.js';

server.listen(port, '0.0.0.0', async () => {
  console.log(`Server running on port: http://localhost:${port}`);
  try {
    await resumeRunningProBots();
    console.log("Operational background bot instances restored successfully.");
  } catch (err) {
    console.error("Critical runtime error while restoring engine background bots:", err);
  }

  const alchemyAuthToken = await getConfig('ALCHEMY_AUTH_TOKEN');
  if (alchemyAuthToken) {
    syncExistingAddressesWithAlchemy().catch(err =>
      console.error('Alchemy sync failed:', err.message)
    );
  } else {
    console.warn('⚠ ALCHEMY_AUTH_TOKEN not set — webhook registration disabled');
  }
});
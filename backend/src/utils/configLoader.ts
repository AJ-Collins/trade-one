import { prisma } from '../prisma.js';
import { decrypt } from './crypto.js';

// In-memory cache so workers don't hit the DB on every sweep tick
const cache = new Map<string, { value: string; expiresAt: number }>();
const CACHE_TTL_MS = 60_000; // 1 minute

export async function getConfig(key: string): Promise<string | null> {
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) return cached.value;

  const row = await prisma.systemConfig.findUnique({ where: { key } });
  if (!row) {
    // Fall back to process.env for keys not yet migrated to DB
    return process.env[key] ?? null;
  }

  const value = row.isSensitive ? decrypt(row.value) : row.value;
  cache.set(key, { value, expiresAt: now + CACHE_TTL_MS });
  return value;
}

export async function setConfig(key: string, value: string) {
  await prisma.systemConfig.upsert({
    where: { key },
    create: { key, value, isSensitive: false },
    update: { value },
  });
  clearConfigCache(key);
}

export function clearConfigCache(key?: string) {
  if (key) cache.delete(key);
  else cache.clear();
}
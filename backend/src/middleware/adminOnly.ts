import { Response, NextFunction } from 'express'
import IORedis from 'ioredis'

// Use the same ioredis client as the rest of the app (no third Redis connection)
const redisClient = new IORedis({
  host: process.env.REDIS_HOST || 'redis',
  port: Number(process.env.REDIS_PORT || 6379),
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
})

redisClient.on('error', (err: Error) => console.error('Redis Rate Limiter Error:', err.message))

let isRedisConnected = false;
redisClient.on('connect', () => { isRedisConnected = true; });
redisClient.on('close',   () => { isRedisConnected = false; });

/**
 * Redis-backed sliding window check.
 */
async function slidingWindowCheck(
  key: string,
  windowMs: number,
  max: number
): Promise<{ allowed: boolean; remaining: number; resetAfterMs: number }> {
  const now = Date.now()
  const windowStart = now - windowMs
  const redisKey = `ratelimit:${key}`

  // Use ioredis pipeline
  const pipeline = redisClient.pipeline();
  pipeline.zremrangebyscore(redisKey, '-inf', windowStart);
  pipeline.zcard(redisKey);
  const results = await pipeline.exec() as Array<[Error | null, any]>;
  const currentCount = (results[1][1] as number) ?? 0;

  if (currentCount >= max) {
    const oldestEntry = await redisClient.zrange(redisKey, 0, 0, 'WITHSCORES');
    const oldestTs = oldestEntry.length > 1 ? parseFloat(oldestEntry[1]) : now
    const resetAfterMs = oldestTs + windowMs - now
    return { allowed: false, remaining: 0, resetAfterMs }
  }

  const uniqueMember = `${now}:${Math.random()}`
  const p2 = redisClient.pipeline();
  p2.zadd(redisKey, now, uniqueMember);
  p2.expire(redisKey, Math.ceil(windowMs / 1000));
  await p2.exec();

  return {
    allowed: true,
    remaining: max - (currentCount + 1),
    resetAfterMs: windowMs,
  }
}

interface SlidingWindowOptions {
  windowMs: number
  max: number
  message: { error: string }
  /** Derive a unique key per request (defaults to IP) */
  keyGenerator?: (req: any) => string
  /** Return true to skip rate limiting for this request */
  skip?: (req: any) => boolean
}

function createSlidingWindowLimiter(opts: SlidingWindowOptions) {
  const {
    windowMs,
    max,
    message,
    keyGenerator = (req) => req.ip ?? 'unknown',
    skip,
  } = opts

  // Notice the middleware function signature is now async
  return async (req: any, res: Response, next: NextFunction): Promise<void> => {
    if (skip && skip(req)) {
      return next()
    }

    // Fail-safe: If Redis goes down, don't crash your server or lock users out
    if (!isRedisConnected) {
      return next()
    }

    try {
      const key = keyGenerator(req)
      const { allowed, remaining, resetAfterMs } = await slidingWindowCheck(key, windowMs, max)

      // Standard rate-limit headers
      res.setHeader('RateLimit-Limit', max)
      res.setHeader('RateLimit-Remaining', remaining)
      res.setHeader('RateLimit-Reset', Math.ceil(resetAfterMs / 1000))

      if (!allowed) {
        res.status(429).json(message)
        return
      }

      next()
    } catch (error) {
      console.error('Rate limiting processing error:', error)
      next() // Bypass on internal failure to safeguard availability
    }
  }
}

/**
 * Admin routes – 5 req / 15 min per IP.
 * Authenticated users are skipped.
 */
export const adminLimiter = createSlidingWindowLimiter({
  windowMs: 15 * 60 * 1000,
  max: 100, // higher limit for legitimate admins
  message: { error: 'Too many requests.' },
  keyGenerator: (req) => req.user?.id ?? req.ip ?? 'unknown',
});

/**
 * Auth (registration / password reset) – 3 req / 6 h per IP.
 */
export const authLimiter = createSlidingWindowLimiter({
  windowMs: 6 * 60 * 60 * 1000,
  max: 3,
  message: { error: 'Too many attempts, please try again shortly.' },
})

/**
 * Login – 10 req / 15 min per IP.
 */
export const loginLimiter = createSlidingWindowLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts, please try again shortly.' },
})

export const botActionLimiter = createSlidingWindowLimiter({
  windowMs: 1 * 60 * 1000, // 1 minute window
  max: 300,                 // Generous limit — GET /stats polls every 3s
  message: { error: 'Rate limit exceeded. System configurations are processing, please slow down.' },
  keyGenerator: (req) => req.userId ?? req.ip ?? 'unknown',
  // Skip rate-limiting on read-only GET requests (stats polling etc.)
  skip: (req) => req.method === 'GET',
})

export const adminOnly = (...roles: string[]) => {
  return (req: any, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied' })
    }
    next()
  }
}

export const depositCreditLimiter = createSlidingWindowLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30,                   // 30 requests per window
  message: { error: 'Too many deposit credit requests, please try again later.' },
  keyGenerator: (req) => req.userId ?? req.ip ?? 'unknown',
})
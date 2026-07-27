import IORedis from "ioredis";
import { endpointRateLimitPerMinute, endpointRateLimitWindowSeconds } from "./config.js";

function resetAtForWindow(nowMs, windowSeconds) {
  const windowMs = windowSeconds * 1000;
  return new Date((Math.floor(nowMs / windowMs) + 1) * windowMs).toISOString();
}

function normalizePolicy({ limit, windowSeconds }) {
  return {
    limit: Math.max(1, Number(limit ?? endpointRateLimitPerMinute)),
    window_seconds: Math.max(1, Number(windowSeconds ?? endpointRateLimitWindowSeconds))
  };
}

export class MemoryEndpointRateLimiter {
  constructor() {
    this.mode = "in_memory_fixed_window";
    this.windows = new Map();
  }

  async check({ endpointId, limit, windowSeconds, nowMs = Date.now() }) {
    const policy = normalizePolicy({ limit, windowSeconds });
    const windowId = Math.floor(nowMs / (policy.window_seconds * 1000));
    const key = `${endpointId}:${windowId}`;
    const current = this.windows.get(key) ?? 0;
    const next = current + 1;
    this.windows.set(key, next);

    for (const storedKey of this.windows.keys()) {
      if (!storedKey.endsWith(`:${windowId}`)) {
        this.windows.delete(storedKey);
      }
    }

    const resetAt = resetAtForWindow(nowMs, policy.window_seconds);
    return {
      allowed: next <= policy.limit,
      mode: this.mode,
      limit: policy.limit,
      remaining: Math.max(0, policy.limit - next),
      window_seconds: policy.window_seconds,
      reset_at: resetAt,
      retry_after_seconds: Math.max(1, Math.ceil((new Date(resetAt).getTime() - nowMs) / 1000))
    };
  }

  async close() {}
}

export class RedisEndpointRateLimiter {
  constructor(redisUrl) {
    this.mode = "redis_fixed_window";
    this.redis = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  }

  async check({ endpointId, limit, windowSeconds, nowMs = Date.now() }) {
    const policy = normalizePolicy({ limit, windowSeconds });
    const windowId = Math.floor(nowMs / (policy.window_seconds * 1000));
    const key = `hookrelay:rate-limit:${endpointId}:${windowId}`;
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, policy.window_seconds + 5);
    }

    const resetAt = resetAtForWindow(nowMs, policy.window_seconds);
    return {
      allowed: count <= policy.limit,
      mode: this.mode,
      limit: policy.limit,
      remaining: Math.max(0, policy.limit - count),
      window_seconds: policy.window_seconds,
      reset_at: resetAt,
      retry_after_seconds: Math.max(1, Math.ceil((new Date(resetAt).getTime() - nowMs) / 1000))
    };
  }

  async close() {
    await this.redis.quit();
  }
}

export function createEndpointRateLimiter() {
  return process.env.REDIS_URL ? new RedisEndpointRateLimiter(process.env.REDIS_URL) : new MemoryEndpointRateLimiter();
}

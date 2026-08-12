export const port = Number(process.env.HOOKRELAY_API_PORT ?? 8400);
export const retryDelaysSeconds = [10, 30, 120, 300, 900];
export const alertNotificationRetryDelaysSeconds = [60, 300, 900];
export const retryJitterRatio = Number(process.env.DELIVERY_RETRY_JITTER_RATIO ?? 0.2);
export const queueName = process.env.DELIVERY_QUEUE_NAME ?? "hookrelay-deliveries";
export const deliveryHttpTimeoutMs = Number(process.env.DELIVERY_HTTP_TIMEOUT_MS ?? 5000);
export const alertNotificationSigningSecret = process.env.HOOKRELAY_ALERT_NOTIFICATION_SIGNING_SECRET ?? "whsec_hookrelay_alert_local";
export const endpointRateLimitPerMinute = Number(process.env.ENDPOINT_RATE_LIMIT_PER_MINUTE ?? 60);
export const endpointRateLimitWindowSeconds = Number(process.env.ENDPOINT_RATE_LIMIT_WINDOW_SECONDS ?? 60);
export const demoOwnerId = process.env.HOOKRELAY_DEMO_OWNER_ID ?? "owner_demo";
export const demoProducerApiKey = process.env.HOOKRELAY_DEMO_PRODUCER_API_KEY ?? "hrp_demo_local_key";

export const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS ?? "http://localhost:3400")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

export function getRuntimeConfig() {
  return {
    databaseUrl: process.env.DATABASE_URL,
    redisUrl: process.env.REDIS_URL,
    endpointRateLimitPerMinute,
    endpointRateLimitWindowSeconds,
    demoOwnerId,
    workerMode: process.env.DELIVERY_WORKER_MODE ?? "api-enqueue-only"
  };
}

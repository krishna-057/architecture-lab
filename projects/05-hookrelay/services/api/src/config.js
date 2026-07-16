export const port = Number(process.env.HOOKRELAY_API_PORT ?? 8400);
export const retryDelaysSeconds = [10, 30, 120, 300, 900];
export const queueName = process.env.DELIVERY_QUEUE_NAME ?? "hookrelay-deliveries";
export const deliveryHttpTimeoutMs = Number(process.env.DELIVERY_HTTP_TIMEOUT_MS ?? 5000);

export const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS ?? "http://localhost:3400")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

export function getRuntimeConfig() {
  return {
    databaseUrl: process.env.DATABASE_URL,
    redisUrl: process.env.REDIS_URL,
    workerMode: process.env.DELIVERY_WORKER_MODE ?? "api-enqueue-only"
  };
}

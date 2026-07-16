import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { queueName } from "./config.js";

function createRedisConnection(redisUrl) {
  if (!redisUrl) {
    return null;
  }

  return new IORedis(redisUrl, { maxRetriesPerRequest: null });
}

export class DeliveryQueue {
  constructor(redisUrl) {
    this.mode = redisUrl ? "bullmq" : "disabled";
    this.connection = createRedisConnection(redisUrl);
    this.queue = this.connection ? new Queue(queueName, { connection: this.connection }) : null;
  }

  async enqueue(delivery) {
    if (!this.queue) {
      return { enqueued: false, queue_mode: this.mode };
    }

    const delay = Math.max(0, new Date(delivery.next_attempt_at).getTime() - Date.now());
    await this.queue.add(
      "deliver-webhook",
      { delivery_id: delivery.delivery_id },
      {
        jobId: delivery.delivery_id,
        delay,
        attempts: 1,
        removeOnComplete: 100,
        removeOnFail: 100
      }
    );

    return { enqueued: true, queue_mode: this.mode };
  }

  createWorker(processDelivery) {
    if (!this.connection) {
      return null;
    }

    return new Worker(
      queueName,
      async (job) => {
        await processDelivery(job.data.delivery_id);
      },
      { connection: this.connection, concurrency: Number(process.env.DELIVERY_WORKER_CONCURRENCY ?? 3) }
    );
  }

  async close() {
    await this.queue?.close();
    await this.connection?.quit();
  }
}

export function createDeliveryQueue() {
  return new DeliveryQueue(process.env.REDIS_URL);
}

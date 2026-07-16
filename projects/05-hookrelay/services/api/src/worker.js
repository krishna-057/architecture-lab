import { createDeliveryQueue } from "./delivery-queue.js";
import { processDelivery } from "./delivery-runner.js";
import { createStore } from "./storage.js";

const store = await createStore();
const queue = createDeliveryQueue();

if (queue.mode !== "bullmq") {
  console.error("REDIS_URL is required to run the HookRelay BullMQ delivery worker.");
  await store.close();
  process.exit(1);
}

const worker = queue.createWorker((deliveryId) => processDelivery({ store, queue, deliveryId }));

worker.on("completed", (job) => {
  console.log(`Processed HookRelay delivery job ${job.id}.`);
});

worker.on("failed", (job, error) => {
  console.error(`HookRelay delivery job ${job?.id ?? "unknown"} failed: ${error.message}`);
});

async function shutdown() {
  await worker.close();
  await queue.close();
  await store.close();
}

process.on("SIGINT", () => {
  void shutdown().then(() => process.exit(0));
});

process.on("SIGTERM", () => {
  void shutdown().then(() => process.exit(0));
});

console.log("HookRelay BullMQ delivery worker is running.");

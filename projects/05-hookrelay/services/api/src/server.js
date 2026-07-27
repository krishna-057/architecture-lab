import { createHookRelayApp } from "./app.js";
import { port } from "./config.js";
import { createDeliveryQueue } from "./delivery-queue.js";
import { createObservability } from "./observability.js";
import { createEndpointRateLimiter } from "./rate-limiter.js";
import { createStore } from "./storage.js";

const store = await createStore();
const queue = createDeliveryQueue();
const observability = await createObservability();
const rateLimiter = createEndpointRateLimiter();
const app = createHookRelayApp({ store, queue, observability, rateLimiter });

app.listen({ host: "0.0.0.0", port }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});

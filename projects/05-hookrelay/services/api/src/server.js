import { createHookRelayApp } from "./app.js";
import { port } from "./config.js";
import { createDeliveryQueue } from "./delivery-queue.js";
import { createStore } from "./storage.js";

const store = await createStore();
const queue = createDeliveryQueue();
const app = createHookRelayApp({ store, queue });

app.listen({ host: "0.0.0.0", port }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});

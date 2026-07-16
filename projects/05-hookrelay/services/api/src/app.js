import Fastify from "fastify";
import { allowedOrigins, getRuntimeConfig, retryDelaysSeconds } from "./config.js";

function validateAbsoluteUrl(value) {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

export function createHookRelayApp({ store, queue }) {
  const app = Fastify({ logger: true });

  app.addHook("onRequest", async (request, reply) => {
    const origin = request.headers.origin;
    if (origin && allowedOrigins.includes(origin)) {
      reply.header("Access-Control-Allow-Origin", origin);
    }
    reply.header("Vary", "Origin");
    reply.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    reply.header("Access-Control-Allow-Headers", "Content-Type");

    if (request.method === "OPTIONS") {
      return reply.status(204).send();
    }
  });

  app.get("/health", async () => ({
    service: "hookrelay-api",
    status: "ok",
    worker_mode: getRuntimeConfig().workerMode,
    queue_mode: queue.mode,
    ...(await store.health())
  }));

  app.get("/api/delivery-contract", async () => ({
    transport: "http_webhook",
    storage_mode: store.mode,
    queue_boundary: queue.mode === "bullmq" ? "bullmq_delivery_job" : "delivery_attempt_record",
    idempotency_key: "endpoint_id + producer supplied idempotency_key",
    signature_algorithm: "hmac_sha256",
    signature_headers: [
      "HookRelay-Timestamp",
      "HookRelay-Signature",
      "HookRelay-Event-Id",
      "HookRelay-Delivery-Id"
    ],
    retry_policy: {
      mode: queue.mode === "bullmq" ? "bullmq_delayed_jobs" : "fixed_ladder_before_bullmq_worker",
      delays_seconds: retryDelaysSeconds,
      dead_letter_after_attempts: retryDelaysSeconds.length
    },
    replay_rule: "Manual replay creates a new queued delivery attempt for the same event payload."
  }));

  app.get("/api/endpoints", async () => store.listEndpoints());

  app.post("/api/endpoints", async (request, reply) => {
    const body = request.body ?? {};
    const name = String(body.name ?? "").trim();
    const targetUrl = String(body.target_url ?? "").trim();

    if (!name || !targetUrl) {
      return reply.status(400).send({ error: "name and target_url are required" });
    }

    if (!validateAbsoluteUrl(targetUrl)) {
      return reply.status(400).send({ error: "target_url must be an absolute URL" });
    }

    const endpoint = await store.createEndpoint({
      name,
      targetUrl,
      signingSecret: body.signing_secret ? String(body.signing_secret) : null
    });
    return reply.status(201).send(endpoint);
  });

  app.get("/api/events", async () => store.listEvents());

  app.post("/api/events", async (request, reply) => {
    const body = request.body ?? {};
    const endpointId = String(body.endpoint_id ?? "").trim();
    const eventType = String(body.event_type ?? "").trim();
    const idempotencyKey = String(body.idempotency_key ?? "").trim();
    const endpoint = await store.getEndpoint(endpointId);

    if (!endpoint) {
      return reply.status(404).send({ error: "endpoint_id was not found" });
    }

    if (!eventType || !idempotencyKey || typeof body.payload !== "object" || body.payload === null) {
      return reply.status(400).send({ error: "event_type, idempotency_key, and object payload are required" });
    }

    const result = await store.ingestEvent({
      endpoint,
      eventType,
      idempotencyKey,
      payload: body.payload
    });

    if (!result.duplicate) {
      await Promise.all(result.deliveries.map((delivery) => queue.enqueue(delivery)));
    }

    return reply.status(result.duplicate ? 200 : 202).send(result);
  });

  app.get("/api/deliveries", async () => store.listDeliveries());

  app.post("/api/deliveries/:delivery_id/replay", async (request, reply) => {
    const existingDelivery = await store.getDelivery(request.params.delivery_id);
    if (!existingDelivery) {
      return reply.status(404).send({ error: "delivery_id was not found" });
    }

    const event = await store.getEvent(existingDelivery.event_id);
    const endpoint = event ? await store.getEndpoint(event.endpoint_id) : null;
    if (!event || !endpoint) {
      return reply.status(409).send({ error: "delivery event or endpoint is missing" });
    }

    const replay = await store.createReplayDelivery({
      endpoint,
      event,
      attemptNumber: existingDelivery.attempt_number + 1,
      replayedFrom: existingDelivery.delivery_id
    });
    await queue.enqueue(replay);
    return reply.status(202).send(replay);
  });

  app.addHook("onClose", async () => {
    await queue.close();
    await store.close();
  });

  return app;
}

import crypto from "node:crypto";
import Fastify from "fastify";

const port = Number(process.env.HOOKRELAY_API_PORT ?? 8400);
const retryDelaysSeconds = [10, 30, 120, 300, 900];
const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS ?? "http://localhost:3400")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const endpoints = new Map();
const events = new Map();
const deliveries = new Map();
const idempotencyIndex = new Map();

function nowIso() {
  return new Date().toISOString();
}

function publicEndpoint(endpoint) {
  return {
    endpoint_id: endpoint.endpoint_id,
    name: endpoint.name,
    target_url: endpoint.target_url,
    status: endpoint.status,
    created_at: endpoint.created_at,
    signing_secret_preview: `${endpoint.signing_secret.slice(0, 7)}...`
  };
}

function signDelivery({ endpoint, event, deliveryId, timestamp }) {
  const rawPayload = JSON.stringify(event.payload);
  const signedPayload = `${timestamp}.${rawPayload}`;
  const digest = crypto.createHmac("sha256", endpoint.signing_secret).update(signedPayload).digest("hex");

  return {
    "HookRelay-Timestamp": String(timestamp),
    "HookRelay-Signature": `v1=${digest}`,
    "HookRelay-Event-Id": event.event_id,
    "HookRelay-Delivery-Id": deliveryId
  };
}

function enqueueDelivery(event, attemptNumber = 1, replayedFrom = null) {
  const endpoint = endpoints.get(event.endpoint_id);
  const deliveryId = `delivery_${crypto.randomUUID()}`;
  const timestamp = Math.floor(Date.now() / 1000);
  const nextAttemptAt = new Date(Date.now() + retryDelaysSeconds[Math.min(attemptNumber - 1, retryDelaysSeconds.length - 1)] * 1000);
  const signatureHeaders = signDelivery({ endpoint, event, deliveryId, timestamp });

  const delivery = {
    delivery_id: deliveryId,
    event_id: event.event_id,
    endpoint_id: endpoint.endpoint_id,
    target_url: endpoint.target_url,
    status: "queued",
    attempt_number: attemptNumber,
    next_attempt_at: nextAttemptAt.toISOString(),
    response_status: null,
    error: null,
    replayed_from_delivery_id: replayedFrom,
    signature_headers: signatureHeaders,
    created_at: nowIso()
  };

  deliveries.set(delivery.delivery_id, delivery);
  return delivery;
}

function seedDemoState() {
  const endpoint = {
    endpoint_id: "endpoint_demo",
    name: "Local billing listener",
    target_url: "https://example.test/webhooks/billing",
    status: "active",
    signing_secret: "whsec_demo_local_secret",
    created_at: nowIso()
  };
  endpoints.set(endpoint.endpoint_id, endpoint);
}

seedDemoState();

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
  worker_mode: process.env.DELIVERY_WORKER_MODE ?? "in-memory-contract"
}));

app.get("/api/delivery-contract", async () => ({
  transport: "http_webhook",
  storage_mode: "in_memory_scaffold",
  queue_boundary: "delivery_attempt_record",
  idempotency_key: "endpoint_id + producer supplied idempotency_key",
  signature_algorithm: "hmac_sha256",
  signature_headers: [
    "HookRelay-Timestamp",
    "HookRelay-Signature",
    "HookRelay-Event-Id",
    "HookRelay-Delivery-Id"
  ],
  retry_policy: {
    mode: "fixed_ladder_before_bullmq_worker",
    delays_seconds: retryDelaysSeconds,
    dead_letter_after_attempts: retryDelaysSeconds.length
  },
  replay_rule: "Manual replay creates a new queued delivery attempt for the same event payload."
}));

app.get("/api/endpoints", async () => Array.from(endpoints.values()).map(publicEndpoint));

app.post("/api/endpoints", async (request, reply) => {
  const body = request.body ?? {};
  const name = String(body.name ?? "").trim();
  const targetUrl = String(body.target_url ?? "").trim();

  if (!name || !targetUrl) {
    return reply.status(400).send({ error: "name and target_url are required" });
  }

  try {
    new URL(targetUrl);
  } catch {
    return reply.status(400).send({ error: "target_url must be an absolute URL" });
  }

  const endpoint = {
    endpoint_id: `endpoint_${crypto.randomUUID()}`,
    name,
    target_url: targetUrl,
    status: "active",
    signing_secret: body.signing_secret ? String(body.signing_secret) : `whsec_${crypto.randomBytes(18).toString("hex")}`,
    created_at: nowIso()
  };

  endpoints.set(endpoint.endpoint_id, endpoint);
  return reply.status(201).send(publicEndpoint(endpoint));
});

app.get("/api/events", async () =>
  Array.from(events.values()).sort((left, right) => right.created_at.localeCompare(left.created_at))
);

app.post("/api/events", async (request, reply) => {
  const body = request.body ?? {};
  const endpointId = String(body.endpoint_id ?? "").trim();
  const eventType = String(body.event_type ?? "").trim();
  const idempotencyKey = String(body.idempotency_key ?? "").trim();

  if (!endpoints.has(endpointId)) {
    return reply.status(404).send({ error: "endpoint_id was not found" });
  }

  if (!eventType || !idempotencyKey || typeof body.payload !== "object" || body.payload === null) {
    return reply.status(400).send({ error: "event_type, idempotency_key, and object payload are required" });
  }

  const indexKey = `${endpointId}:${idempotencyKey}`;
  const existingEventId = idempotencyIndex.get(indexKey);
  if (existingEventId) {
    const existingEvent = events.get(existingEventId);
    return reply.send({
      duplicate: true,
      event: existingEvent,
      deliveries: Array.from(deliveries.values()).filter((delivery) => delivery.event_id === existingEvent.event_id)
    });
  }

  const event = {
    event_id: `event_${crypto.randomUUID()}`,
    endpoint_id: endpointId,
    event_type: eventType,
    idempotency_key: idempotencyKey,
    payload: body.payload,
    status: "accepted",
    created_at: nowIso()
  };
  events.set(event.event_id, event);
  idempotencyIndex.set(indexKey, event.event_id);

  const delivery = enqueueDelivery(event);
  return reply.status(202).send({ duplicate: false, event, deliveries: [delivery] });
});

app.get("/api/deliveries", async () =>
  Array.from(deliveries.values()).sort((left, right) => right.created_at.localeCompare(left.created_at))
);

app.post("/api/deliveries/:delivery_id/replay", async (request, reply) => {
  const existingDelivery = deliveries.get(request.params.delivery_id);
  if (!existingDelivery) {
    return reply.status(404).send({ error: "delivery_id was not found" });
  }

  const event = events.get(existingDelivery.event_id);
  if (!event) {
    return reply.status(409).send({ error: "delivery event is missing" });
  }

  const replay = enqueueDelivery(event, existingDelivery.attempt_number + 1, existingDelivery.delivery_id);
  return reply.status(202).send(replay);
});

app.listen({ host: "0.0.0.0", port }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});

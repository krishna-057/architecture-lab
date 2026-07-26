import Fastify from "fastify";
import { allowedOrigins, getRuntimeConfig, retryDelaysSeconds, retryJitterRatio } from "./config.js";
import { createTraceId, NoopObservability } from "./observability.js";
import { buildReceiverVerificationExample } from "./signing.js";

function validateAbsoluteUrl(value) {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

export function createHookRelayApp({ store, queue, observability = new NoopObservability() }) {
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
    observability: {
      mode: observability.mode,
      span_endpoint: "/api/observability/spans",
      traced_operations: [
        "hookrelay.event.ingest",
        "hookrelay.delivery.enqueue",
        "hookrelay.delivery.replay",
        "hookrelay.delivery.process",
        "hookrelay.delivery.http_request"
      ]
    },
    idempotency_key: "endpoint_id + producer supplied idempotency_key",
    signature_algorithm: "hmac_sha256",
    signature_headers: [
      "HookRelay-Timestamp",
      "HookRelay-Signature",
      "HookRelay-Event-Id",
      "HookRelay-Delivery-Id"
    ],
    retry_policy: {
      mode: queue.mode === "bullmq" ? "bullmq_delayed_jobs_with_jitter" : "jittered_ladder_before_bullmq_worker",
      delays_seconds: retryDelaysSeconds,
      jitter_ratio: retryJitterRatio,
      jitter_mode: "bounded_symmetric_per_attempt",
      dead_letter_after_attempts: retryDelaysSeconds.length
    },
    replay_rule: "Manual replay creates a new queued delivery attempt for the same event payload.",
    replay_authorization: {
      mode: "operator_intent",
      required_body_fields: ["reason"],
      optional_body_fields: ["requested_by"],
      audit_rule: "Replay requests must include a human-readable reason before a new delivery attempt is queued."
    },
    receiver_verification: {
      timestamp_tolerance_seconds: 300,
      signed_payload: "<HookRelay-Timestamp>.<raw JSON request body>",
      example_endpoint: "/api/receiver-verification-example"
    }
  }));

  app.get("/api/receiver-verification-example", async () => buildReceiverVerificationExample());

  app.get("/api/observability/spans", async (request) => {
    const limit = Math.min(Math.max(Number(request.query?.limit ?? 50), 1), 100);
    return {
      mode: observability.mode,
      spans: await observability.listSpans({ limit })
    };
  });

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

    const traceId = createTraceId();
    const result = await observability.traceSpan(
      {
        name: "hookrelay.event.ingest",
        traceId,
        endpointId,
        attributes: {
          event_type: eventType,
          idempotency_key: idempotencyKey,
          queue_mode: queue.mode,
          storage_mode: store.mode
        }
      },
      async (span) => {
        const ingestResult = await store.ingestEvent({
          endpoint,
          eventType,
          idempotencyKey,
          payload: body.payload
        });
        span.attributes.duplicate = ingestResult.duplicate;
        span.attributes.event_id = ingestResult.event.event_id;
        span.attributes.delivery_count = ingestResult.deliveries.length;
        return ingestResult;
      }
    );

    if (!result.duplicate) {
      await Promise.all(result.deliveries.map((delivery) => observability.traceSpan(
        {
          name: "hookrelay.delivery.enqueue",
          traceId,
          eventId: result.event.event_id,
          deliveryId: delivery.delivery_id,
          endpointId: delivery.endpoint_id,
          attributes: {
            attempt_number: delivery.attempt_number,
            queue_mode: queue.mode,
            scheduled_delay_seconds: delivery.scheduled_delay_seconds
          }
        },
        async (span) => {
          const enqueueResult = await queue.enqueue(delivery);
          span.attributes.enqueued = enqueueResult.enqueued;
          return enqueueResult;
        }
      )));
    }

    return reply.status(result.duplicate ? 200 : 202).send(result);
  });

  app.get("/api/deliveries", async () => store.listDeliveries());

  app.post("/api/deliveries/:delivery_id/replay", async (request, reply) => {
    const body = request.body ?? {};
    const reason = String(body.reason ?? "").trim();
    const requestedBy = String(body.requested_by ?? "local-operator").trim() || "local-operator";

    if (reason.length < 8) {
      return reply.status(400).send({ error: "Replay reason must be at least 8 characters." });
    }

    const existingDelivery = await store.getDelivery(request.params.delivery_id);
    if (!existingDelivery) {
      return reply.status(404).send({ error: "delivery_id was not found" });
    }

    const event = await store.getEvent(existingDelivery.event_id);
    const endpoint = event ? await store.getEndpoint(event.endpoint_id) : null;
    if (!event || !endpoint) {
      return reply.status(409).send({ error: "delivery event or endpoint is missing" });
    }

    const traceId = createTraceId();
    const replay = await observability.traceSpan(
      {
        name: "hookrelay.delivery.replay",
        traceId,
        eventId: event.event_id,
        deliveryId: existingDelivery.delivery_id,
        endpointId: endpoint.endpoint_id,
        attributes: {
          replayed_from_delivery_id: existingDelivery.delivery_id,
          replay_requested_by: requestedBy,
          replay_reason: reason
        }
      },
      async (span) => {
        const replayDelivery = await store.createReplayDelivery({
          endpoint,
          event,
          attemptNumber: existingDelivery.attempt_number + 1,
          replayedFrom: existingDelivery.delivery_id,
          replayReason: reason,
          replayRequestedBy: requestedBy
        });
        span.attributes.replay_delivery_id = replayDelivery.delivery_id;
        return replayDelivery;
      }
    );
    await observability.traceSpan(
      {
        name: "hookrelay.delivery.enqueue",
        traceId,
        eventId: event.event_id,
        deliveryId: replay.delivery_id,
        endpointId: endpoint.endpoint_id,
        attributes: {
          attempt_number: replay.attempt_number,
          queue_mode: queue.mode,
          scheduled_delay_seconds: replay.scheduled_delay_seconds
        }
      },
      async (span) => {
        const enqueueResult = await queue.enqueue(replay);
        span.attributes.enqueued = enqueueResult.enqueued;
        return enqueueResult;
      }
    );
    return reply.status(202).send(replay);
  });

  app.addHook("onClose", async () => {
    await queue.close();
    await store.close();
    await observability.close();
  });

  return app;
}

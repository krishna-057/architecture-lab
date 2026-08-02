import Fastify from "fastify";
import {
  allowedOrigins,
  endpointRateLimitPerMinute,
  endpointRateLimitWindowSeconds,
  getRuntimeConfig,
  retryDelaysSeconds,
  retryJitterRatio
} from "./config.js";
import { createTraceId, NoopObservability } from "./observability.js";
import { extractProducerApiKey } from "./producer-auth.js";
import { MemoryEndpointRateLimiter } from "./rate-limiter.js";
import { receiverFailureClasses } from "./receiver-failure.js";
import { buildReceiverVerificationExample } from "./signing.js";

function validateAbsoluteUrl(value) {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const validApiKeyRoles = ["producer", "operator", "admin"];
const producerRoles = ["producer", "admin"];
const replayRoles = ["operator", "admin"];
const deliveryViewRoles = ["operator", "admin"];
const deliveryExportRoles = ["operator", "admin"];
const deliveryExportMaxRows = 1000;
const deliveryStatuses = ["queued", "delivering", "succeeded", "failed", "dead_letter"];
const deliveryExportColumns = [
  "delivery_id",
  "event_id",
  "endpoint_id",
  "target_url",
  "status",
  "attempt_number",
  "response_status",
  "failure_class",
  "error",
  "replay_reason",
  "replay_requested_by",
  "replayed_from_delivery_id",
  "next_attempt_at",
  "created_at"
];

function parseApiKeyRole(value) {
  const role = String(value ?? "producer").trim();
  return validApiKeyRoles.includes(role) ? role : null;
}

function parseOptionalQueryValue(value) {
  if (Array.isArray(value)) {
    return parseOptionalQueryValue(value[0]);
  }

  const text = String(value ?? "").trim();
  return text.length > 0 && text !== "all" ? text : null;
}

function parseDeliveryCursor(value) {
  const cursor = parseOptionalQueryValue(value);
  if (!cursor) {
    return { cursor: null };
  }

  try {
    const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (typeof decoded.created_at !== "string" || typeof decoded.delivery_id !== "string") {
      return { error: "cursor is invalid" };
    }

    return { cursor: decoded };
  } catch {
    return { error: "cursor is invalid" };
  }
}

function parseDeliverySearch(query = {}, { maxLimit = 200, includeCursor = true } = {}) {
  const status = parseOptionalQueryValue(query.status);
  if (status && !deliveryStatuses.includes(status)) {
    return { error: "status must be queued, delivering, succeeded, failed, dead_letter, or all" };
  }

  const cursor = includeCursor ? parseDeliveryCursor(query.cursor) : { cursor: null };
  if (cursor.error) {
    return cursor;
  }

  const limit = Math.min(Math.max(parsePositiveInteger(query.limit, 100), 1), maxLimit);
  return {
    filters: {
      status,
      failureClass: parseOptionalQueryValue(query.failure_class),
      endpointId: parseOptionalQueryValue(query.endpoint_id),
      eventId: parseOptionalQueryValue(query.event_id),
      text: parseOptionalQueryValue(query.q),
      cursor: cursor.cursor,
      limit
    }
  };
}

function parseDeliveryViewFilters(filters = {}) {
  const search = parseDeliverySearch({
    status: filters.status,
    failure_class: filters.failure_class,
    endpoint_id: filters.endpoint_id,
    event_id: filters.event_id,
    q: filters.q,
    limit: filters.limit
  }, { includeCursor: false });
  if (search.error) {
    return search;
  }

  return {
    filters: {
      status: search.filters.status,
      failure_class: search.filters.failureClass,
      endpoint_id: search.filters.endpointId,
      event_id: search.filters.eventId,
      q: search.filters.text,
      limit: search.filters.limit
    }
  };
}

function parseDeliveryExportSearch(query = {}) {
  return parseDeliverySearch(query, { maxLimit: deliveryExportMaxRows, includeCursor: false });
}

function csvCell(value) {
  if (value === null || value === undefined) {
    return "";
  }

  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll("\"", "\"\"")}"` : text;
}

function formatDeliveryExportCsv(deliveries) {
  const rows = deliveries.map((delivery) => deliveryExportColumns
    .map((column) => csvCell(delivery[column]))
    .join(","));
  return `${deliveryExportColumns.join(",")}\n${rows.join("\n")}${rows.length ? "\n" : ""}`;
}

async function authenticateProducer({ request, reply, store, requiredRoles = producerRoles, action = "Producer" }) {
  const apiKey = extractProducerApiKey(request);
  if (!apiKey) {
    reply.header("WWW-Authenticate", "Bearer");
    reply.status(401).send({
      error: "Producer API key is required.",
      accepted_headers: ["Authorization: Bearer <api_key>", "X-HookRelay-API-Key"]
    });
    return null;
  }

  const producer = await store.authenticateProducerApiKey(apiKey);
  if (!producer) {
    reply.status(403).send({ error: "Producer API key is invalid or disabled." });
    return null;
  }

  if (!requiredRoles.includes(producer.role)) {
    reply.status(403).send({
      error: `${action} API key role is not authorized.`,
      required_roles: requiredRoles,
      actual_role: producer.role
    });
    return null;
  }

  return producer;
}

export function createHookRelayApp({
  store,
  queue,
  observability = new NoopObservability(),
  rateLimiter = new MemoryEndpointRateLimiter()
}) {
  const app = Fastify({ logger: true });

  app.addHook("onRequest", async (request, reply) => {
    const origin = request.headers.origin;
    if (origin && allowedOrigins.includes(origin)) {
      reply.header("Access-Control-Allow-Origin", origin);
    }
    reply.header("Vary", "Origin");
    reply.header("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
    reply.header("Access-Control-Allow-Headers", "Authorization, Content-Type, X-HookRelay-API-Key");

    if (request.method === "OPTIONS") {
      return reply.status(204).send();
    }
  });

  app.get("/health", async () => ({
    service: "hookrelay-api",
    status: "ok",
    worker_mode: getRuntimeConfig().workerMode,
    queue_mode: queue.mode,
    rate_limit_mode: rateLimiter.mode,
    ...(await store.health())
  }));

  app.get("/api/delivery-contract", async () => ({
    transport: "http_webhook",
    storage_mode: store.mode,
    queue_boundary: queue.mode === "bullmq" ? "bullmq_delivery_job" : "delivery_attempt_record",
    producer_authentication: {
      mode: "owner_scoped_api_key",
      accepted_headers: ["Authorization: Bearer <api_key>", "X-HookRelay-API-Key"],
      owner_rule: "Producer API key owner_id must match the endpoint owner_id before events are accepted.",
      roles: validApiKeyRoles,
      producer_roles: producerRoles,
      rotation_endpoint: "POST /api/producer-api-keys/:key_id/rotate",
      revocation_endpoint: "POST /api/producer-api-keys/:key_id/revoke",
      inactive_statuses: ["disabled", "rotated", "revoked"],
      demo_owner_id: getRuntimeConfig().demoOwnerId
    },
    endpoint_rate_limit: {
      mode: rateLimiter.mode,
      scope: "endpoint_id",
      algorithm: "fixed_window",
      default_limit: endpointRateLimitPerMinute,
      default_window_seconds: endpointRateLimitWindowSeconds,
      enforced_on: "POST /api/events",
      exceeded_status: 429,
      retry_after_header: "Retry-After"
    },
    observability: {
      mode: observability.mode,
      span_endpoint: "/api/observability/spans",
      traced_operations: [
        "hookrelay.event.ingest",
        "hookrelay.endpoint.rate_limit",
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
    receiver_failure_classification: {
      field: "failure_class",
      classes: receiverFailureClasses,
      stored_on: "delivery_attempts",
      classified_on: "worker receiver response or fetch error",
      retry_rule: "Failure classification is recorded before retry scheduling or dead-letter promotion."
    },
    delivery_search: {
      endpoint: "GET /api/deliveries",
      sort: "created_at_desc_delivery_id_desc",
      default_limit: 100,
      max_limit: 200,
      filters: ["status", "failure_class", "endpoint_id", "event_id", "q", "cursor", "limit"],
      failure_class_none: "none",
      cursor: {
        mode: "opaque_base64url_json",
        fields: ["created_at", "delivery_id"]
      }
    },
    delivery_saved_views: {
      endpoint: "/api/delivery-views",
      owner_rule: "Saved delivery views are scoped to the active API key owner_id.",
      required_roles: deliveryViewRoles,
      stored_filters: ["status", "failure_class", "endpoint_id", "event_id", "q", "limit"],
      cursor_rule: "Saved views store filters only; cursors are request-specific and are not saved."
    },
    delivery_export: {
      endpoint: "GET /api/deliveries/export",
      format: "text/csv",
      max_rows: deliveryExportMaxRows,
      required_roles: deliveryExportRoles,
      owner_rule: "Export API key owner_id must match the exported delivery endpoints owner_id.",
      filters: ["status", "failure_class", "endpoint_id", "event_id", "q", "limit"],
      cursor_rule: "Exports are bounded snapshots from the newest matching delivery attempts and do not accept pagination cursors."
    },
    replay_rule: "Manual replay creates a new queued delivery attempt for the same event payload.",
    replay_authorization: {
      mode: "owner_scoped_operator_api_key",
      accepted_headers: ["Authorization: Bearer <api_key>", "X-HookRelay-API-Key"],
      required_roles: replayRoles,
      owner_rule: "Replay API key owner_id must match the delivery endpoint owner_id.",
      required_body_fields: ["reason"],
      optional_body_fields: ["requested_by"],
      audit_rule: "Replay requests require an operator/admin API key plus a human-readable reason before a new delivery attempt is queued."
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

  app.get("/api/producer-api-keys", async () => store.listProducerApiKeys());

  app.post("/api/producer-api-keys", async (request, reply) => {
    const body = request.body ?? {};
    const ownerId = String(body.owner_id ?? getRuntimeConfig().demoOwnerId).trim();
    const name = String(body.name ?? "Local producer").trim();
    const role = parseApiKeyRole(body.role);

    if (!ownerId || !name) {
      return reply.status(400).send({ error: "owner_id and name are required" });
    }

    if (!role) {
      return reply.status(400).send({ error: "role must be producer, operator, or admin" });
    }

    const key = await store.createProducerApiKey({ ownerId, name, role });
    return reply.status(201).send(key);
  });

  app.post("/api/producer-api-keys/:key_id/rotate", async (request, reply) => {
    const keyId = String(request.params?.key_id ?? "").trim();
    if (!keyId) {
      return reply.status(400).send({ error: "key_id is required" });
    }

    const result = await store.rotateProducerApiKey(keyId);
    if (!result) {
      return reply.status(404).send({ error: "producer API key was not found" });
    }

    if (result.error === "not_active") {
      return reply.status(409).send({ error: "producer API key is not active", key: result.key });
    }

    return reply.status(201).send(result);
  });

  app.post("/api/producer-api-keys/:key_id/revoke", async (request, reply) => {
    const keyId = String(request.params?.key_id ?? "").trim();
    if (!keyId) {
      return reply.status(400).send({ error: "key_id is required" });
    }

    const result = await store.revokeProducerApiKey(keyId);
    if (!result) {
      return reply.status(404).send({ error: "producer API key was not found" });
    }

    if (result.error === "not_active") {
      return reply.status(409).send({ error: "producer API key is not active", key: result.key });
    }

    return result.key;
  });

  app.get("/api/endpoints", async () => store.listEndpoints());

  app.post("/api/endpoints", async (request, reply) => {
    const producer = await authenticateProducer({ request, reply, store });
    if (!producer) {
      return reply;
    }

    const body = request.body ?? {};
    const name = String(body.name ?? "").trim();
    const targetUrl = String(body.target_url ?? "").trim();
    const rateLimitPerMinute = parsePositiveInteger(body.rate_limit_per_minute, endpointRateLimitPerMinute);
    const rateLimitWindowSeconds = parsePositiveInteger(body.rate_limit_window_seconds, endpointRateLimitWindowSeconds);

    if (!name || !targetUrl) {
      return reply.status(400).send({ error: "name and target_url are required" });
    }

    if (!validateAbsoluteUrl(targetUrl)) {
      return reply.status(400).send({ error: "target_url must be an absolute URL" });
    }

    const endpoint = await store.createEndpoint({
      ownerId: producer.owner_id,
      name,
      targetUrl,
      signingSecret: body.signing_secret ? String(body.signing_secret) : null,
      rateLimitPerMinute,
      rateLimitWindowSeconds
    });
    return reply.status(201).send(endpoint);
  });

  app.get("/api/events", async () => store.listEvents());

  app.get("/api/delivery-views", async (request, reply) => {
    const operator = await authenticateProducer({
      request,
      reply,
      store,
      requiredRoles: deliveryViewRoles,
      action: "Delivery view"
    });
    if (!operator) {
      return reply;
    }

    return store.listDeliveryViews(operator.owner_id);
  });

  app.post("/api/delivery-views", async (request, reply) => {
    const operator = await authenticateProducer({
      request,
      reply,
      store,
      requiredRoles: deliveryViewRoles,
      action: "Delivery view"
    });
    if (!operator) {
      return reply;
    }

    const body = request.body ?? {};
    const name = String(body.name ?? "").trim();
    if (name.length < 3) {
      return reply.status(400).send({ error: "delivery view name must be at least 3 characters" });
    }

    const parsed = parseDeliveryViewFilters(body.filters ?? {});
    if (parsed.error) {
      return reply.status(400).send({ error: parsed.error });
    }

    const view = await store.createDeliveryView({
      ownerId: operator.owner_id,
      name,
      filters: parsed.filters
    });
    return reply.status(201).send(view);
  });

  app.delete("/api/delivery-views/:view_id", async (request, reply) => {
    const operator = await authenticateProducer({
      request,
      reply,
      store,
      requiredRoles: deliveryViewRoles,
      action: "Delivery view"
    });
    if (!operator) {
      return reply;
    }

    const deleted = await store.deleteDeliveryView({
      ownerId: operator.owner_id,
      viewId: String(request.params?.view_id ?? "").trim()
    });
    if (!deleted) {
      return reply.status(404).send({ error: "delivery view was not found" });
    }

    return deleted;
  });

  app.post("/api/events", async (request, reply) => {
    const body = request.body ?? {};
    const endpointId = String(body.endpoint_id ?? "").trim();
    const eventType = String(body.event_type ?? "").trim();
    const idempotencyKey = String(body.idempotency_key ?? "").trim();
    const endpoint = await store.getEndpoint(endpointId);

    if (!endpoint) {
      return reply.status(404).send({ error: "endpoint_id was not found" });
    }

    const producer = await authenticateProducer({ request, reply, store });
    if (!producer) {
      return reply;
    }

    if (producer.owner_id !== endpoint.owner_id) {
      return reply.status(403).send({
        error: "Producer API key does not own this endpoint.",
        endpoint_id: endpoint.endpoint_id,
        endpoint_owner_id: endpoint.owner_id,
        producer_owner_id: producer.owner_id
      });
    }

    if (!eventType || !idempotencyKey || typeof body.payload !== "object" || body.payload === null) {
      return reply.status(400).send({ error: "event_type, idempotency_key, and object payload are required" });
    }

    const traceId = createTraceId();
    const rateLimit = await observability.traceSpan(
      {
        name: "hookrelay.endpoint.rate_limit",
        traceId,
        endpointId,
        attributes: {
          rate_limit_mode: rateLimiter.mode,
          limit: endpoint.rate_limit_per_minute,
          window_seconds: endpoint.rate_limit_window_seconds
        }
      },
      async (span) => {
        const check = await rateLimiter.check({
          endpointId,
          limit: endpoint.rate_limit_per_minute,
          windowSeconds: endpoint.rate_limit_window_seconds
        });
        span.attributes.allowed = check.allowed;
        span.attributes.remaining = check.remaining;
        span.attributes.reset_at = check.reset_at;
        return check;
      }
    );

    reply.header("X-RateLimit-Limit", String(rateLimit.limit));
    reply.header("X-RateLimit-Remaining", String(rateLimit.remaining));
    reply.header("X-RateLimit-Reset", rateLimit.reset_at);

    if (!rateLimit.allowed) {
      reply.header("Retry-After", String(rateLimit.retry_after_seconds));
      return reply.status(429).send({
        error: "Endpoint rate limit exceeded.",
        endpoint_id: endpointId,
        limit: rateLimit.limit,
        window_seconds: rateLimit.window_seconds,
        retry_after_seconds: rateLimit.retry_after_seconds,
        reset_at: rateLimit.reset_at
      });
    }

    const result = await observability.traceSpan(
      {
        name: "hookrelay.event.ingest",
        traceId,
        endpointId,
        attributes: {
          event_type: eventType,
          idempotency_key: idempotencyKey,
          owner_id: producer.owner_id,
          queue_mode: queue.mode,
          rate_limit_remaining: rateLimit.remaining,
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

  app.get("/api/deliveries", async (request, reply) => {
    const search = parseDeliverySearch(request.query);
    if (search.error) {
      return reply.status(400).send({ error: search.error });
    }

    return store.listDeliveries(search.filters);
  });

  app.get("/api/deliveries/export", async (request, reply) => {
    const operator = await authenticateProducer({
      request,
      reply,
      store,
      requiredRoles: deliveryExportRoles,
      action: "Delivery export"
    });
    if (!operator) {
      return reply;
    }

    const search = parseDeliveryExportSearch(request.query);
    if (search.error) {
      return reply.status(400).send({ error: search.error });
    }

    const deliveries = await store.listDeliveryExport({
      ...search.filters,
      ownerId: operator.owner_id
    });
    const exportedAt = new Date().toISOString().replaceAll(":", "-");
    reply
      .header("Content-Type", "text/csv; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="hookrelay-deliveries-${exportedAt}.csv"`)
      .header("X-HookRelay-Export-Row-Count", String(deliveries.length));
    return reply.send(formatDeliveryExportCsv(deliveries));
  });

  app.post("/api/deliveries/:delivery_id/replay", async (request, reply) => {
    const body = request.body ?? {};
    const reason = String(body.reason ?? "").trim();
    const requestedBy = String(body.requested_by ?? "local-operator").trim() || "local-operator";

    const operator = await authenticateProducer({
      request,
      reply,
      store,
      requiredRoles: replayRoles,
      action: "Replay"
    });
    if (!operator) {
      return reply;
    }

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

    if (operator.owner_id !== endpoint.owner_id) {
      return reply.status(403).send({
        error: "Replay API key does not own this endpoint.",
        endpoint_id: endpoint.endpoint_id,
        endpoint_owner_id: endpoint.owner_id,
        operator_owner_id: operator.owner_id
      });
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
          replay_reason: reason,
          replay_operator_key_id: operator.key_id,
          replay_operator_role: operator.role
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
    await rateLimiter.close();
  });

  return app;
}

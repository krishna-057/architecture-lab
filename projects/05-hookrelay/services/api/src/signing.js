import crypto from "node:crypto";
import { calculateRetrySchedule } from "./retry-policy.js";

export function nowIso() {
  return new Date().toISOString();
}

export function publicEndpoint(endpoint) {
  return {
    endpoint_id: endpoint.endpoint_id,
    name: endpoint.name,
    target_url: endpoint.target_url,
    status: endpoint.status,
    created_at: endpoint.created_at,
    signing_secret_preview: `${endpoint.signing_secret.slice(0, 7)}...`
  };
}

export function signDelivery({ endpoint, event, deliveryId, timestamp }) {
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

export function buildReceiverVerificationExample() {
  const sampleSecret = "whsec_receiver_example";
  const samplePayload = { event_type: "invoice.paid", invoice_id: "inv_1001", amount: 4900 };
  const sampleEvent = { event_id: "event_example", payload: samplePayload };
  const sampleEndpoint = { signing_secret: sampleSecret };
  const sampleDeliveryId = "delivery_example";
  const sampleTimestamp = 1_735_689_600;
  const sampleHeaders = signDelivery({
    endpoint: sampleEndpoint,
    event: sampleEvent,
    deliveryId: sampleDeliveryId,
    timestamp: sampleTimestamp
  });

  return {
    timestamp_tolerance_seconds: 300,
    signed_payload: "<HookRelay-Timestamp>.<raw JSON request body>",
    required_headers: [
      "HookRelay-Timestamp",
      "HookRelay-Signature",
      "HookRelay-Event-Id",
      "HookRelay-Delivery-Id"
    ],
    sample_secret: sampleSecret,
    sample_payload: samplePayload,
    sample_headers: sampleHeaders,
    node_example:
      "const expected = 'v1=' + crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');"
  };
}

export function buildDelivery({
  endpoint,
  event,
  attemptNumber,
  retryDelaysSeconds,
  retryJitterRatio,
  replayedFrom = null,
  replayReason = null,
  replayRequestedBy = null
}) {
  const deliveryId = `delivery_${crypto.randomUUID()}`;
  const timestamp = Math.floor(Date.now() / 1000);
  const schedule = calculateRetrySchedule({ attemptNumber, retryDelaysSeconds, retryJitterRatio });

  return {
    delivery_id: deliveryId,
    event_id: event.event_id,
    endpoint_id: endpoint.endpoint_id,
    target_url: endpoint.target_url,
    status: "queued",
    attempt_number: attemptNumber,
    next_attempt_at: schedule.next_attempt_at,
    base_delay_seconds: schedule.base_delay_seconds,
    jitter_seconds: schedule.jitter_seconds,
    scheduled_delay_seconds: schedule.scheduled_delay_seconds,
    response_status: null,
    error: null,
    replayed_from_delivery_id: replayedFrom,
    replay_reason: replayReason,
    replay_requested_by: replayRequestedBy,
    signature_headers: signDelivery({ endpoint, event, deliveryId, timestamp }),
    created_at: nowIso(),
    updated_at: nowIso()
  };
}

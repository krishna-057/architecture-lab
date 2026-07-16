import crypto from "node:crypto";

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

export function buildDelivery({ endpoint, event, attemptNumber, retryDelaysSeconds, replayedFrom = null }) {
  const deliveryId = `delivery_${crypto.randomUUID()}`;
  const timestamp = Math.floor(Date.now() / 1000);
  const retryDelay = retryDelaysSeconds[Math.min(attemptNumber - 1, retryDelaysSeconds.length - 1)];
  const nextAttemptAt = new Date(Date.now() + retryDelay * 1000);

  return {
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
    signature_headers: signDelivery({ endpoint, event, deliveryId, timestamp }),
    created_at: nowIso(),
    updated_at: nowIso()
  };
}

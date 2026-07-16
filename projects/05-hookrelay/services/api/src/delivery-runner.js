import { deliveryHttpTimeoutMs, retryDelaysSeconds } from "./config.js";

function eventPayload(event) {
  return {
    event_id: event.event_id,
    event_type: event.event_type,
    idempotency_key: event.idempotency_key,
    payload: event.payload,
    created_at: event.created_at
  };
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export async function processDelivery({ store, queue, deliveryId }) {
  const delivery = await store.getDelivery(deliveryId);
  if (!delivery || delivery.status !== "queued") {
    return;
  }

  const event = await store.getEvent(delivery.event_id);
  const endpoint = await store.getEndpoint(delivery.endpoint_id);
  if (!event || !endpoint) {
    await store.updateDelivery(delivery.delivery_id, {
      status: "dead_letter",
      error: "Delivery cannot run because its event or endpoint is missing."
    });
    return;
  }

  await store.updateDelivery(delivery.delivery_id, { status: "delivering", error: null });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), deliveryHttpTimeoutMs);

  try {
    const response = await fetch(delivery.target_url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...delivery.signature_headers
      },
      body: JSON.stringify(eventPayload(event)),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Receiver returned HTTP ${response.status}`);
    }

    await store.updateDelivery(delivery.delivery_id, {
      status: "succeeded",
      response_status: response.status,
      error: null
    });
  } catch (error) {
    const shouldDeadLetter = delivery.attempt_number >= retryDelaysSeconds.length;
    await store.updateDelivery(delivery.delivery_id, {
      status: shouldDeadLetter ? "dead_letter" : "failed",
      error: errorMessage(error)
    });

    if (!shouldDeadLetter) {
      const retry = await store.createReplayDelivery({
        endpoint,
        event,
        attemptNumber: delivery.attempt_number + 1,
        replayedFrom: delivery.delivery_id
      });
      await queue.enqueue(retry);
    }
  } finally {
    clearTimeout(timeout);
  }
}

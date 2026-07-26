import { deliveryHttpTimeoutMs, retryDelaysSeconds } from "./config.js";
import { createTraceId, NoopObservability } from "./observability.js";

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

export async function processDelivery({ store, queue, deliveryId, observability = new NoopObservability() }) {
  const traceId = createTraceId();

  return observability.traceSpan(
    {
      name: "hookrelay.delivery.process",
      traceId,
      deliveryId,
      attributes: {
        queue_mode: queue.mode,
        worker_timeout_ms: deliveryHttpTimeoutMs
      }
    },
    async (processSpan) => {
      const delivery = await store.getDelivery(deliveryId);
      if (!delivery || delivery.status !== "queued") {
        processSpan.attributes.skipped = true;
        processSpan.attributes.skip_reason = delivery ? `status_${delivery.status}` : "missing_delivery";
        return;
      }

      processSpan.attributes.event_id = delivery.event_id;
      processSpan.attributes.endpoint_id = delivery.endpoint_id;
      processSpan.attributes.attempt_number = delivery.attempt_number;

      const event = await store.getEvent(delivery.event_id);
      const endpoint = await store.getEndpoint(delivery.endpoint_id);
      if (!event || !endpoint) {
        await store.updateDelivery(delivery.delivery_id, {
          status: "dead_letter",
          error: "Delivery cannot run because its event or endpoint is missing."
        });
        processSpan.attributes.final_status = "dead_letter";
        processSpan.attributes.error = "missing_event_or_endpoint";
        return;
      }

      await store.updateDelivery(delivery.delivery_id, { status: "delivering", error: null });

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), deliveryHttpTimeoutMs);

      try {
        const response = await observability.traceSpan(
          {
            name: "hookrelay.delivery.http_request",
            traceId,
            parentSpanId: processSpan.span_id,
            deliveryId: delivery.delivery_id,
            eventId: event.event_id,
            endpointId: endpoint.endpoint_id,
            attributes: {
              target_url: delivery.target_url,
              attempt_number: delivery.attempt_number
            }
          },
          async (httpSpan) => {
            const receiverResponse = await fetch(delivery.target_url, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...delivery.signature_headers
              },
              body: JSON.stringify(eventPayload(event)),
              signal: controller.signal
            });
            httpSpan.attributes.response_status = receiverResponse.status;
            if (!receiverResponse.ok) {
              throw new Error(`Receiver returned HTTP ${receiverResponse.status}`);
            }
            return receiverResponse;
          }
        );

        await store.updateDelivery(delivery.delivery_id, {
          status: "succeeded",
          response_status: response.status,
          error: null
        });
        processSpan.attributes.final_status = "succeeded";
        processSpan.attributes.response_status = response.status;
      } catch (error) {
        const shouldDeadLetter = delivery.attempt_number >= retryDelaysSeconds.length;
        const finalStatus = shouldDeadLetter ? "dead_letter" : "failed";
        await store.updateDelivery(delivery.delivery_id, {
          status: finalStatus,
          error: errorMessage(error)
        });
        processSpan.attributes.final_status = finalStatus;
        processSpan.attributes.error = errorMessage(error);

        if (!shouldDeadLetter) {
          const retry = await store.createReplayDelivery({
            endpoint,
            event,
            attemptNumber: delivery.attempt_number + 1,
            replayedFrom: delivery.delivery_id
          });
          processSpan.attributes.retry_delivery_id = retry.delivery_id;
          await observability.traceSpan(
            {
              name: "hookrelay.delivery.enqueue",
              traceId,
              parentSpanId: processSpan.span_id,
              deliveryId: retry.delivery_id,
              eventId: event.event_id,
              endpointId: endpoint.endpoint_id,
              attributes: {
                attempt_number: retry.attempt_number,
                queue_mode: queue.mode,
                scheduled_delay_seconds: retry.scheduled_delay_seconds
              }
            },
            async (enqueueSpan) => {
              const enqueueResult = await queue.enqueue(retry);
              enqueueSpan.attributes.enqueued = enqueueResult.enqueued;
              return enqueueResult;
            }
          );
        }
      } finally {
        clearTimeout(timeout);
      }
    }
  );
}

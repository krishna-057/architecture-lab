import { deliveryHttpTimeoutMs } from "./config.js";

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export function buildAlertNotificationPayload(alert) {
  return {
    alert_id: alert.alert_id,
    route_id: alert.route_id,
    owner_id: alert.owner_id,
    delivery_id: alert.delivery_id,
    endpoint_id: alert.endpoint_id,
    event_id: alert.event_id,
    failure_class: alert.failure_class,
    delivery_status: alert.delivery_status,
    message: alert.message,
    created_at: alert.created_at
  };
}

export async function dispatchAndRecordAlertNotification({ alert, store, observability, traceId, parentSpanId = null }) {
  let notification;
  try {
    return await observability.traceSpan(
      {
        name: "hookrelay.alert.notification",
        traceId,
        parentSpanId,
        deliveryId: alert.delivery_id,
        eventId: alert.event_id,
        endpointId: alert.endpoint_id,
        attributes: {
          alert_id: alert.alert_id,
          route_id: alert.route_id,
          target_type: alert.target_type,
          target: alert.target
        }
      },
      async (span) => {
        notification = await dispatchAlertNotification(alert);
        span.attributes.notification_status = notification.status;
        span.attributes.notification_response_status = notification.responseStatus;
        if (notification.error) {
          span.attributes.error = notification.error;
        }
        const updatedAlert = await store.updateFailureAlertNotification({
          alertId: alert.alert_id,
          status: notification.status,
          responseStatus: notification.responseStatus,
          error: notification.error
        });
        if (updatedAlert) {
          span.attributes.notification_attempt_count = updatedAlert.notification_attempt_count;
          span.attributes.notification_next_retry_at = updatedAlert.notification_next_retry_at;
          span.attributes.notification_retry_exhausted = updatedAlert.notification_retry_exhausted;
        }
        return { notification, alert: updatedAlert };
      }
    );
  } catch (error) {
    notification = { status: "failed", responseStatus: null, error: errorMessage(error) };
    return { notification, alert: null };
  }
}

export async function dispatchAlertNotification(alert, { fetchImpl = fetch, timeoutMs = deliveryHttpTimeoutMs } = {}) {
  if (alert.target_type !== "webhook") {
    return {
      status: "skipped",
      responseStatus: null,
      error: `Notification delivery is not implemented for ${alert.target_type} targets.`
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(alert.target, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-HookRelay-Alert-Id": alert.alert_id,
        "X-HookRelay-Delivery-Id": alert.delivery_id
      },
      body: JSON.stringify(buildAlertNotificationPayload(alert)),
      signal: controller.signal
    });

    return response.ok
      ? { status: "delivered", responseStatus: response.status, error: null }
      : { status: "failed", responseStatus: response.status, error: `Notification target returned HTTP ${response.status}` };
  } catch (error) {
    return {
      status: "failed",
      responseStatus: null,
      error: error instanceof Error ? error.message : String(error)
    };
  } finally {
    clearTimeout(timeout);
  }
}

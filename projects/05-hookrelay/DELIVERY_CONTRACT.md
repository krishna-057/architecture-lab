# HookRelay Delivery Contract

HookRelay defines the HTTP contract for endpoint setup, event ingestion, delivery logging, HMAC signing, replay intent, and the first durable delivery worker boundary.

## Resource Boundaries

| Resource | API path | First-slice storage | Later durable owner |
| --- | --- | --- | --- |
| Producer API key | `/api/producer-api-keys` | In-memory by default, PostgreSQL when configured | Tenant identity and secret manager |
| Endpoint | `/api/endpoints` | In-memory by default, PostgreSQL when configured | PostgreSQL `webhook_endpoints` |
| Endpoint rate limit | `POST /api/events` | In-memory by default, Redis when configured | Redis counters plus tenant quota policy |
| Event | `/api/events` | In-memory by default, PostgreSQL when configured | PostgreSQL `webhook_events` |
| Delivery attempt | `/api/deliveries` | In-memory by default, PostgreSQL plus BullMQ when configured | PostgreSQL `delivery_attempts` plus BullMQ jobs |
| Delivery export | `/api/deliveries/export` | Synchronous bounded CSV response | Background export jobs plus object storage |
| Delivery saved view | `/api/delivery-views` | In-memory by default, PostgreSQL when configured | PostgreSQL `delivery_saved_views` |
| Receiver failure alert route | `/api/alert-routes` | In-memory by default, PostgreSQL when configured | Notification policy service |
| Receiver failure alert | `/api/failure-alerts` | In-memory by default, PostgreSQL when configured | Notification delivery and incident timeline |
| Failure classification | `failure_class` on delivery attempts | In-memory by default, PostgreSQL when configured | Delivery analytics and alert policy |
| Observability span | `/api/observability/spans` | In-memory by default, PostgreSQL when configured | OpenTelemetry exporter plus query store |
| Contract discovery | `/api/delivery-contract` | Static API response | Versioned API contract |

## Event Ingestion

Producers submit:

```json
{
  "endpoint_id": "endpoint_...",
  "event_type": "invoice.paid",
  "idempotency_key": "producer-event-id",
  "payload": {
    "invoice_id": "inv_123"
  }
}
```

The API accepts one event per `(endpoint_id, idempotency_key)` pair after producer authentication and owner matching. Duplicate submissions return the existing event and do not enqueue a second delivery attempt.

## Producer API Key Authentication

Producer requests authenticate with either header:

```text
Authorization: Bearer <api_key>
X-HookRelay-API-Key: <api_key>
```

Endpoint creation and event ingestion require an active API key with the `producer` or `admin` role. `POST /api/endpoints` stores the authenticated key's `owner_id` on the endpoint. `POST /api/events` requires the key owner to match the endpoint owner before rate limiting, idempotency, insertion, or enqueueing.

The local bootstrap endpoint is:

```text
POST /api/producer-api-keys
```

It accepts `owner_id`, `name`, and `role`, stores only a key hash and preview, and returns the full generated API key once. Valid roles are:

```text
producer
operator
admin
```

`GET /api/producer-api-keys` lists key previews, owners, roles, and statuses only.

Active keys can be rotated or revoked through the local admin lifecycle endpoints:

```text
POST /api/producer-api-keys/:key_id/rotate
POST /api/producer-api-keys/:key_id/revoke
```

Rotation marks the old key as `rotated`, creates a replacement key for the same `owner_id` and role, records `rotated_from_key_id` on the replacement, and returns the new full API key once. Revocation marks an active key as `revoked`. Authentication only accepts `active` keys, so `disabled`, `rotated`, and `revoked` keys are rejected before ownership matching, role checks, rate limiting, idempotency insertion, or enqueueing.

Authentication failures:

```text
401 Producer API key is required.
403 Producer API key is invalid or disabled.
403 Producer API key role is not authorized.
403 Producer API key does not own this endpoint.
404 producer API key was not found
409 producer API key is not active
```

## Endpoint Rate Limits

Each endpoint has a fixed-window ingestion policy:

```json
{
  "rate_limit_per_minute": 60,
  "rate_limit_window_seconds": 60
}
```

The default policy is configured with `ENDPOINT_RATE_LIMIT_PER_MINUTE` and `ENDPOINT_RATE_LIMIT_WINDOW_SECONDS`. `POST /api/endpoints` can override those values for a specific endpoint.

`POST /api/events` checks the endpoint window before accepting an event. Accepted requests include:

```text
X-RateLimit-Limit
X-RateLimit-Remaining
X-RateLimit-Reset
```

When the endpoint is over limit, the API returns:

```text
HTTP 429
Retry-After: <seconds until reset>
```

The response body includes `endpoint_id`, `limit`, `window_seconds`, `retry_after_seconds`, and `reset_at`. In memory mode, counters are process-local. When `REDIS_URL` is configured, counters use Redis fixed-window keys so multiple API processes share the same limit.

## Signature Headers

Each delivery attempt carries a signature preview using the endpoint secret:

```text
HookRelay-Timestamp: unix timestamp seconds
HookRelay-Signature: v1=<hex hmac sha256>
HookRelay-Event-Id: event id
HookRelay-Delivery-Id: delivery attempt id
```

The signed payload is:

```text
<timestamp>.<raw JSON event payload>
```

This keeps replay protection and payload verification explicit before the worker begins sending real HTTP requests.

## Receiver Verification

Receivers verify the webhook by rebuilding the signed payload from the exact raw request body:

```text
<HookRelay-Timestamp>.<raw JSON request body>
```

They then compute `HMAC-SHA256` with the endpoint signing secret and compare it to `HookRelay-Signature`. The first receiver example uses a five-minute timestamp tolerance so old captured requests can be rejected once real receivers are wired.

The API exposes a runnable example contract at:

```text
GET /api/receiver-verification-example
```

The example includes the required headers, a sample payload, a sample secret, and the Node.js digest expression a receiver would use.

## Retry Policy

The scaffold exposes the intended retry ladder:

```text
10 seconds, 30 seconds, 2 minutes, 5 minutes, 15 minutes
```

## Retry Jitter

Each retry receives bounded symmetric Jitter around its base delay. The default jitter ratio is `0.2`, so a 30 second base delay may schedule between 24 and 36 seconds. Set `DELIVERY_RETRY_JITTER_RATIO` to tune that spread in local durable mode.

Delivery attempts expose the computed schedule:

```text
base_delay_seconds
jitter_seconds
scheduled_delay_seconds
next_attempt_at
```

The API stores queued delivery records. When Redis is configured, it also creates delayed BullMQ jobs from `next_attempt_at`. The worker sends the signed event payload to the endpoint URL, records success or failure, creates the next retry attempt with a fresh jittered schedule, and promotes the final failed attempt to `dead_letter`.

## Failure Classification

Failed receiver attempts set `failure_class` before retry scheduling or dead-letter promotion. The current classes are:

```text
receiver_http_4xx
receiver_http_5xx
receiver_http_other
receiver_timeout
receiver_network
internal_error
```

HTTP classes are derived from the receiver response status. Timeout and network classes are derived from fetch/abort errors when no response status exists. The raw `error` string remains on the attempt for diagnostics, but `failure_class` is the stable field dashboards and alerts should group by.

The dashboard applies a server-side `failure_class` filter through `GET /api/deliveries`. It always exposes `all`, `none`, and each contract-published class. The `none` value maps to delivery attempts whose `failure_class` is null.

## Delivery Search

The server-side delivery search stays on the existing delivery collection endpoint:

```text
GET /api/deliveries?status=failed&failure_class=receiver_http_5xx&endpoint_id=endpoint_demo&limit=50
```

Supported query parameters:

| Parameter | Meaning |
| --- | --- |
| `status` | One of `queued`, `delivering`, `succeeded`, `failed`, or `dead_letter`. |
| `failure_class` | One of the receiver failure classes, or `none` for attempts without a class. |
| `endpoint_id` | Exact endpoint id. |
| `event_id` | Exact event id. |
| `q` | Case-insensitive text search over delivery ids, event ids, endpoint ids, target URL, status, response status, failure class, error, and replay audit fields. |
| `cursor` | Opaque pagination cursor returned as `page_info.next_cursor`. |
| `limit` | Result cap from `1` to `200`, defaulting to `100`. |

Results are ordered by newest delivery attempt first, using `created_at desc, delivery_id desc` so ties are stable. Responses use a page envelope:

```json
{
  "items": [
    {
      "delivery_id": "delivery_...",
      "created_at": "2026-08-01T00:00:00.000Z"
    }
  ],
  "page_info": {
    "limit": 50,
    "sort": "created_at_desc_delivery_id_desc",
    "has_more": true,
    "next_cursor": "opaque-base64url-cursor"
  }
}
```

Clients request the next page by preserving the same filters and sending `cursor=<page_info.next_cursor>`. The cursor encodes only the last row's `created_at` and `delivery_id`; clients should treat it as opaque. PostgreSQL mode uses parameterized predicates for structured filters and keeps endpoint/failure-class indexes for the common operator paths. The `q` filter is intentionally simple until saved views or long-retention analytics justify a dedicated search index.

Contract discovery exposes this as:

```json
{
  "receiver_failure_classification": {
    "field": "failure_class",
    "classes": ["receiver_http_4xx", "receiver_http_5xx", "receiver_http_other", "receiver_timeout", "receiver_network", "internal_error"],
    "stored_on": "delivery_attempts"
  }
}
```

Contract discovery exposes delivery search as:

```json
{
  "delivery_search": {
    "endpoint": "GET /api/deliveries",
    "sort": "created_at_desc_delivery_id_desc",
    "default_limit": 100,
    "max_limit": 200,
    "filters": ["status", "failure_class", "endpoint_id", "event_id", "q", "cursor", "limit"],
    "failure_class_none": "none",
    "cursor": {
      "mode": "opaque_base64url_json",
      "fields": ["created_at", "delivery_id"]
    }
  }
}
```

## Delivery Saved Views

Saved views let operators keep common delivery search filters without creating a separate analytics model. The API exposes:

```text
GET /api/delivery-views
POST /api/delivery-views
DELETE /api/delivery-views/:view_id
```

Every saved view requires an active API key with the `operator` or `admin` role. The key's `owner_id` scopes list, create, and delete operations, so one owner cannot read or delete another owner's saved delivery views.

Create requests use:

```json
{
  "name": "Failed receiver 5xx",
  "filters": {
    "status": "failed",
    "failure_class": "receiver_http_5xx",
    "endpoint_id": "endpoint_...",
    "q": "checkout",
    "limit": 50
  }
}
```

The server validates filters through the same delivery search parser and stores only `status`, `failure_class`, `endpoint_id`, `event_id`, `q`, and `limit`. Saved views store filters only; pagination cursors are request-specific and are not saved. Applying a saved view starts a fresh newest-first delivery search and can then continue with the returned `next_cursor`.

Contract discovery exposes saved views as:

```json
{
  "delivery_saved_views": {
    "endpoint": "/api/delivery-views",
    "owner_rule": "Saved delivery views are scoped to the active API key owner_id.",
    "required_roles": ["operator", "admin"],
    "stored_filters": ["status", "failure_class", "endpoint_id", "event_id", "q", "limit"],
    "cursor_rule": "Saved views store filters only; cursors are request-specific and are not saved."
  }
}
```

## Delivery Export

Operators can export the newest matching delivery attempts with:

```text
GET /api/deliveries/export?status=failed&failure_class=receiver_http_5xx&limit=1000
```

The endpoint accepts the same saved-view/search filters except `cursor`: `status`, `failure_class`, `endpoint_id`, `event_id`, `q`, and `limit`. Exports are bounded snapshots, capped at 1000 rows, ordered by `created_at desc, delivery_id desc`, and returned as `text/csv`.

Every export requires an active API key with the `operator` or `admin` role. The key's `owner_id` is applied through endpoint ownership before rows are returned, so one owner cannot export another owner's delivery attempts. Cursor-based resume, scheduled exports, durable files, and background jobs are intentionally deferred until delivery history retention exists.

Contract discovery exposes export as:

```json
{
  "delivery_export": {
    "endpoint": "GET /api/deliveries/export",
    "format": "text/csv",
    "max_rows": 1000,
    "required_roles": ["operator", "admin"],
    "owner_rule": "Export API key owner_id must match the exported delivery endpoints owner_id.",
    "filters": ["status", "failure_class", "endpoint_id", "event_id", "q", "limit"],
    "cursor_rule": "Exports are bounded snapshots from the newest matching delivery attempts and do not accept pagination cursors."
  }
}
```

## Receiver Failure Alert Routing

Alert routing is the first local policy boundary for receiver failures. Operators create routes with:

```text
GET /api/alert-routes
POST /api/alert-routes
DELETE /api/alert-routes/:route_id
GET /api/failure-alerts
POST /api/failure-alerts/:alert_id/acknowledge
POST /api/failure-alerts/:alert_id/retry-notification
```

Every route and emitted alert requires an active `operator` or `admin` API key and is scoped to the key's `owner_id`. A create request uses:

```json
{
  "name": "Dead-letter 5xx receiver alerts",
  "failure_class": "receiver_http_5xx",
  "delivery_status": "dead_letter",
  "target_type": "dashboard",
  "target": "local-dashboard",
  "suppression_window_seconds": 300,
  "enabled": true
}
```

`failure_class` is optional. `delivery_status` can be `failed`, `dead_letter`, or `any`. `target_type` is currently `dashboard`, `email`, or `webhook`. `webhook` targets must use an absolute URL and receive best-effort notification posts when a local alert record is created. `dashboard` and `email` targets are kept as local alert records with `notification_status: "skipped"` until dashboard-only and email credential workflows are added. `suppression_window_seconds` is optional; `0` disables suppression and positive values suppress repeated route matches after the route emits an alert.

When the worker records a `failed` or `dead_letter` delivery, storage matches enabled routes by endpoint owner, delivery status, and optional failure class. Matching routes create alert records visible through `GET /api/failure-alerts`. Webhook routes then receive best-effort notification posts and store the notification outcome on the alert record. Failed webhook notification posts increment retry tracking fields and receive a suggested `notification_next_retry_at`. This keeps alerting attached to the durable delivery lifecycle while deferring automatic notification retry jobs, escalation schedules, email providers, and team preferences.

## Alert Suppression Windows

Suppression windows are route-level noise control for repeated receiver failures. When a route emits an alert, storage records `last_alert_at` on the route. If another failed/dead-letter delivery matches the same route before `last_alert_at + suppression_window_seconds`, HookRelay skips creating a duplicate local alert record for that route.

This is deliberately not a calendar schedule, incident snooze, or team escalation state. It is a small throttle at the same point where alert policy already matches delivery failures. PostgreSQL and in-memory modes both expose:

```json
{
  "suppression_window_seconds": 300,
  "last_alert_at": "2026-08-11T00:00:00.000Z",
  "suppressed_until": "2026-08-11T00:05:00.000Z"
}
```

`suppressed_until` is derived for clients from `last_alert_at` and the configured window. Suppressed deliveries still keep their delivery status and `failure_class`; only duplicate local alert records are skipped.

## External Notification Delivery

Webhook alert notification delivery is best-effort and synchronous with worker processing after the local alert record is created. A `webhook` alert route posts this payload to the route target:

```json
{
  "alert_id": "alert_...",
  "route_id": "aroute_...",
  "owner_id": "owner_demo",
  "delivery_id": "delivery_...",
  "endpoint_id": "endpoint_...",
  "event_id": "event_...",
  "failure_class": "receiver_http_5xx",
  "delivery_status": "failed",
  "message": "failed delivery delivery_... matched receiver_http_5xx for Billing listener",
  "created_at": "2026-08-11T00:00:00.000Z"
}
```

The request includes `Content-Type: application/json`, `X-HookRelay-Alert-Id`, `X-HookRelay-Delivery-Id`, `HookRelay-Alert-Timestamp`, and `HookRelay-Alert-Signature`. The alert signature uses HMAC-SHA256 over:

```text
<HookRelay-Alert-Timestamp>.<raw JSON alert notification body>
```

`HookRelay-Alert-Signature` uses the same `v1=<hex digest>` shape as receiver delivery signatures, but it is signed with `HOOKRELAY_ALERT_NOTIFICATION_SIGNING_SECRET` rather than an endpoint signing secret. That keeps alert notification receivers able to verify integrity and freshness without exposing receiver endpoint secrets to alert targets.

HookRelay records the outcome on the alert record:

```json
{
  "notification_status": "delivered",
  "notification_response_status": 202,
  "notification_error": null,
  "notification_attempted_at": "2026-08-11T00:00:01.000Z",
  "notification_attempt_count": 1,
  "notification_next_retry_at": null,
  "notification_retry_exhausted": false
}
```

`notification_status` can be `pending`, `delivered`, `failed`, or `skipped`. Webhook notification attempts increment `notification_attempt_count`. Failed attempts set `notification_next_retry_at` using the current local retry ladder:

```text
60 seconds, 5 minutes, 15 minutes
```

Operators can retry a failed or pending webhook notification manually with:

```text
POST /api/failure-alerts/:alert_id/retry-notification
```

The retry endpoint requires an active owner-scoped `operator` or `admin` key, reuses the original alert record, posts the same alert payload, and returns the updated notification outcome fields. Delivered notifications return `409` rather than sending a duplicate, and non-webhook targets return `409` because they do not have an external notification target. Failed notification posts do not change the receiver delivery attempt status and do not block receiver retry scheduling; they are visible on `GET /api/failure-alerts` for operator follow-up. Automatic notification retry jobs, signed notification payloads, email providers, and dead-lettered notification jobs are intentionally deferred.

## Alert Acknowledgement

Operators acknowledge one owner-scoped failure alert with:

```text
POST /api/failure-alerts/:alert_id/acknowledge
```

The endpoint requires an active `operator` or `admin` API key whose `owner_id` matches the alert. The request body records the local operator and a human-readable note:

```json
{
  "acknowledged_by": "local-dashboard",
  "note": "Reviewed in local dashboard"
}
```

Acknowledgement adds `acknowledged_at`, `acknowledged_by`, and `acknowledgement_note` to the alert record. It does not rewrite the delivery attempt, route, failure class, or original alert message. A second acknowledgement returns `409` with `already_acknowledged` semantics so the first audit actor and note stay immutable for this slice.

Contract discovery exposes alert routing as:

```json
{
  "receiver_failure_alert_routing": {
    "route_endpoint": "/api/alert-routes",
    "alert_endpoint": "/api/failure-alerts",
    "acknowledgement_endpoint": "POST /api/failure-alerts/:alert_id/acknowledge",
    "notification_retry_endpoint": "POST /api/failure-alerts/:alert_id/retry-notification",
    "required_roles": ["operator", "admin"],
    "owner_rule": "Alert routes and emitted alerts are scoped to the active API key owner_id.",
    "trigger_statuses": ["failed", "dead_letter"],
    "route_statuses": ["failed", "dead_letter", "any"],
    "target_types": ["dashboard", "email", "webhook"],
    "notification_retry_delays_seconds": [60, 300, 900],
    "notification_signing": {
      "algorithm": "hmac_sha256",
      "signed_payload": "HookRelay-Alert-Timestamp.raw JSON alert notification body",
      "secret_source": "HOOKRELAY_ALERT_NOTIFICATION_SIGNING_SECRET",
      "headers": ["HookRelay-Alert-Timestamp", "HookRelay-Alert-Signature"]
    },
    "suppression_window_max_seconds": 86400,
    "delivery_match": "A failed/dead-letter delivery matches enabled routes by owner_id, delivery_status, and optional failure_class.",
    "dispatch_mode": "local_alert_record_before_external_integrations",
    "notification_rule": "Webhook alert routes post a compact alert payload best-effort after the local alert record is created; dashboard and email targets remain local skipped notification records.",
    "notification_retry_rule": "Webhook notification attempts increment notification_attempt_count and set notification_next_retry_at after failures; manual retry reuses the same alert record.",
    "suppression_rule": "A route with suppression_window_seconds > 0 emits one alert, then suppresses repeated matches until last_alert_at plus the window.",
    "acknowledgement_rule": "Operators/admins acknowledge owner-scoped alerts once with acknowledged_by and a human-readable note."
  }
}
```

## Replay Rule

Manual replay creates a new queued delivery attempt for an existing event. The event payload and idempotency key remain unchanged; the replay attempt receives a new delivery id, timestamp, and signature.

## Replay Authorization

Manual replay is an operator action, not an automatic retry. The replay endpoint requires an active API key with the `operator` or `admin` role:

```text
Authorization: Bearer <api_key>
X-HookRelay-API-Key: <api_key>
```

The key's `owner_id` must match the delivery endpoint owner. The request body must also include a human-readable `reason` before it queues a new delivery attempt:

```json
{
  "reason": "Operator requested replay after receiver recovery",
  "requested_by": "local-dashboard"
}
```

Contract discovery exposes replay authorization as:

```json
{
  "mode": "owner_scoped_operator_api_key",
  "required_roles": ["operator", "admin"],
  "owner_rule": "Replay API key owner_id must match the delivery endpoint owner_id."
}
```

The reason and requester are stored on the replay delivery attempt as `replay_reason` and `replay_requested_by`. This keeps the first role boundary simple while preserving the audit trail needed before adding tenant users, signed user identity, or approval workflows.

## Observability

HookRelay exposes recent delivery lifecycle spans at:

```text
GET /api/observability/spans
```

Span records use this provider-neutral envelope:

```json
{
  "span_id": "8-byte hex id",
  "trace_id": "16-byte hex id",
  "parent_span_id": null,
  "name": "hookrelay.delivery.enqueue",
  "delivery_id": "delivery_...",
  "event_id": "event_...",
  "endpoint_id": "endpoint_...",
  "status": "ok",
  "started_at": "2026-07-27T00:00:00.000Z",
  "ended_at": "2026-07-27T00:00:00.003Z",
  "duration_ms": 3,
  "attributes": {
    "queue_mode": "bullmq",
    "scheduled_delay_seconds": 24
  },
  "error": null
}
```

The current traced operations are event ingestion, delivery enqueue, manual replay, worker delivery processing, and outbound receiver HTTP. This is intentionally a local span log first; it keeps the lifecycle visible before introducing OpenTelemetry exporters, sampling, collector deployment, and long-retention query storage.

## Durable Schema Rule

PostgreSQL enforces one accepted event for each `(endpoint_id, idempotency_key)` pair. Delivery attempts remain append-friendly records, so retries and manual replays keep their own delivery ids, timestamps, signatures, and statuses.

When `DATABASE_URL` is set, alert routes are persisted in `receiver_failure_alert_routes`, alert records are persisted in `receiver_failure_alerts`, saved delivery views are persisted in `delivery_saved_views`, and observability spans can be persisted in `delivery_observability_spans`. Without PostgreSQL, the API keeps alert routes, alert records, saved views, and a bounded span log in process for local checks.

# HookRelay Decisions

## 2026-07-16: Start With Fastify API, Next Dashboard, And In-Memory Delivery Records

Decision:
Use a small Fastify API and Next.js dashboard for the first HookRelay scaffold. Store endpoints, events, idempotency keys, and delivery attempts in memory for now.

Why:
- HookRelay's core interview signal is HTTP delivery behavior: idempotency, signatures, retries, logs, and replay.
- Fastify gives a direct HTTP boundary without the extra structure of NestJS before the domain model stabilizes.
- In-memory state keeps the first slice runnable without PostgreSQL and Redis while still shaping the resources that will later become durable tables and BullMQ jobs.
- The dashboard forces the API to expose useful operator state instead of only implementing hidden backend routes.

Rejected alternatives:
- NestJS first: useful later if the API grows substantially, but heavier than needed for the first delivery contract.
- PostgreSQL and BullMQ in the first scaffold: closer to production, but it would mix schema/worker setup with the more important initial API contract.
- Sending outbound HTTP in the first scaffold: tempting, but replay, signing, and retry semantics should be explicit before real network side effects are introduced.

Follow-up:
Add PostgreSQL tables and a BullMQ delivery worker after the endpoint/event/delivery attempt shapes are validated.

## 2026-07-16: Add Optional PostgreSQL Storage And BullMQ Worker Boundary

Decision:
Keep in-memory mode as the default local scaffold, and activate PostgreSQL plus BullMQ when `DATABASE_URL` and `REDIS_URL` are configured.

Why:
- The project now has stable endpoint, event, idempotency, delivery attempt, replay, and signature shapes, so a durable schema can be introduced without guessing at table boundaries.
- PostgreSQL owns restart-safe endpoints, event payloads, idempotency uniqueness, delivery statuses, and dead-letter state.
- BullMQ is the right next boundary because webhook delivery is network-bound, retry-heavy work that should not run inside the request path.
- Optional durable mode keeps quick checks usable without Docker while still proving the real architecture with Compose.

Rejected alternatives:
- Force Docker for all local development: more production-like, but it slows lightweight API and dashboard iteration.
- Add a custom SQL-backed scheduler: unnecessary when BullMQ already provides delayed jobs and worker concurrency.
- Split the worker into a separate package now: premature for this lab; sharing signing, retry, and storage modules keeps behavior consistent.

Follow-up:
Add receiver verification examples, replay authorization, jittered retry policy, and OpenTelemetry spans.

## 2026-07-26: Add Receiver Verification Example And Replay Intent

Decision:
Expose `GET /api/receiver-verification-example` and require a replay `reason` before `POST /api/deliveries/:delivery_id/replay` queues a new attempt. Store `replay_reason` and `replay_requested_by` on replay delivery attempts.

Why:
- Receivers need an exact, copyable HMAC verification shape before HookRelay grows SDKs or framework middleware.
- Manual replay is an operator action with business impact, so the first contract should require intent even before tenant auth and roles exist.
- Keeping replay authorization as a request-body contract is enough for this slice and avoids inventing a user model too early.
- Persisting replay reason/requester on the delivery attempt gives operators an audit trail without changing event idempotency semantics.

Rejected alternatives:
- Add full tenant RBAC now: important later, but too much identity work before the replay behavior itself is settled.
- Build receiver SDK packages now: useful polish, but the verification contract should be stable first.
- Let replay stay a bare button: fast for demos, but it hides the operational accountability that webhook platforms need.

Follow-up:
Add signed operator identity, role-based replay permissions, receiver SDK helpers, and timestamp-window enforcement in a sample receiver.

## 2026-07-27: Add Bounded Retry Jitter

Decision:
Add bounded symmetric jitter to the existing retry ladder and store the computed schedule on each delivery attempt as `base_delay_seconds`, `jitter_seconds`, and `scheduled_delay_seconds`.

Why:
- Webhook receivers often fail in bursts, so exact retry timestamps can recreate a thundering herd when many events fail at once.
- A bounded jitter ratio keeps the retry policy explainable while still spreading load around the nominal delay.
- Storing the computed values makes operator logs auditable; `next_attempt_at` is no longer a mysterious timestamp.
- Keeping the helper in `retry-policy.js` gives the API, worker, contract, and tests one shared scheduling rule.

Rejected alternatives:
- Full exponential backoff rewrite: useful later, but the current ladder is already documented and good enough for this lab slice.
- Unbounded random jitter: spreads load, but makes retry timing hard to reason about and hard to explain in interviews.
- Queue-only jitter inside BullMQ: would hide timing from the database and dashboard, which weakens delivery-log observability.

Follow-up:
Add tenant-specific retry policies, endpoint-level rate limits, and OpenTelemetry timing spans.

## 2026-07-27: Add Local Delivery Observability Spans

Decision:
Record provider-neutral spans for event ingestion, delivery enqueue, manual replay, worker processing, and outbound receiver HTTP. Keep the default span log in-process, and persist spans to PostgreSQL when `DATABASE_URL` is configured.

Why:
- Webhook delivery failures need lifecycle timing, not just final statuses. Operators need to see whether time was spent accepting an event, queueing, processing a worker job, or waiting on the receiver.
- A plain JSON span envelope keeps the implementation easy to inspect while matching the concepts used by OpenTelemetry: trace id, span id, parent span, timing, status, attributes, and error.
- PostgreSQL persistence gives the API and worker a shared local trace log in durable mode without introducing a collector service before the delivery lifecycle is stable.
- The dashboard can now show observability signal directly beside delivery logs, which makes the portfolio demo easier to explain.

Rejected alternatives:
- Add a full OpenTelemetry collector now: useful later, but too much infrastructure before deciding sampling, exporter, and retention rules.
- Only use application logs: logs are helpful, but they do not give a structured parent/child lifecycle around a delivery attempt.
- Store spans only in memory: fine for the dependency-light scaffold, but durable mode needs worker and API spans to meet in one query surface.

Follow-up:
Add OpenTelemetry exporters, trace sampling, endpoint-level latency charts, and receiver failure classification.

## 2026-07-27: Add Endpoint-Level Event Rate Limits

Decision:
Add endpoint-scoped fixed-window rate limits to `POST /api/events`. Store the policy on each endpoint, use in-process counters by default, and use Redis counters when `REDIS_URL` is configured.

Why:
- Webhook platforms need a pressure valve before a noisy endpoint or producer can flood ingestion and queue creation.
- Endpoint scope is the smallest useful boundary because HookRelay does not have tenant users or producer API keys yet.
- A fixed window is easy to explain, cheap to implement with Redis `INCR` plus expiry, and good enough before per-tenant quota products exist.
- Returning standard `429`, `Retry-After`, and `X-RateLimit-*` headers gives producers a concrete retry contract.

Rejected alternatives:
- Token bucket now: smoother under bursty traffic, but more moving parts than needed for the first quota slice.
- Global API-only limit: protects the service, but does not prove endpoint-specific isolation.
- Full tenant quota service: important later, but premature before tenant ownership and auth are implemented.

Follow-up:
Add tenant identity, producer API keys, token-bucket smoothing, and separate read/write/admin quotas.

## 2026-07-28: Add Producer API Keys And Endpoint Ownership

Decision:
Add producer API keys with hashed storage and bind endpoints to an `owner_id`. Require an active producer key for endpoint creation and event ingestion, and require the key owner to match the endpoint owner before accepting events.

Why:
- Endpoint-level rate limits are more meaningful once an endpoint belongs to an owner instead of being globally writable.
- Producer API keys are the smallest useful authentication boundary before adding tenant users, login sessions, teams, and RBAC.
- Hashing keys and returning only previews after creation matches the operational shape of API-key systems without bringing in a secret manager yet.
- Checking ownership before rate limiting and insertion prevents a producer from consuming another owner's endpoint quota or creating delivery attempts.

Rejected alternatives:
- Full user accounts and OAuth now: correct later, but too much identity work for this delivery-focused lab slice.
- Store plaintext API keys: easier for demos, but it teaches the wrong production habit.
- Protect only event ingestion: endpoint creation also needs ownership, otherwise local users can create unowned endpoints that do not fit the later tenant model.

Follow-up:
Add key rotation, disabled/revoked key flows, tenant users, team membership, and role-based replay authorization.

## 2026-07-30: Add Producer Key Rotation And Revocation

Decision:
Add producer API key lifecycle endpoints for rotation and revocation. Rotation marks the current key as `rotated`, creates a replacement key for the same `owner_id`, links it with `rotated_from_key_id`, and returns the new secret once. Revocation marks an active key as `revoked`.

Why:
- Producers need a low-friction way to replace exposed or aging credentials without changing endpoint ownership.
- Keeping the replacement key on the same `owner_id` preserves the existing ownership rule and avoids introducing tenant users before they are needed.
- Storing terminal statuses plus `revoked_at` makes key state explainable in the dashboard and durable schema while keeping authentication simple: only `active` keys pass.
- Returning the full key only on creation or rotation keeps the secret-handling behavior consistent.

Rejected alternatives:
- Add full tenant RBAC for key lifecycle now: correct later, but too broad for this slice.
- Physically delete revoked keys: simpler storage, but it removes audit context and makes support/debugging weaker.
- Allow rotating inactive keys: convenient in demos, but it muddies the lifecycle and can hide operational mistakes.

Follow-up:
Add tenant users, lifecycle audit actors, approval-backed revocation, scoped producer permissions, and role-based replay authorization.

## 2026-07-31: Add Role-Based Replay Authorization

Decision:
Add a minimal role field to producer API keys and require `operator` or `admin` for manual replay. Keep `producer` or `admin` for endpoint creation and event ingestion. Replay still requires the key `owner_id` to match the delivery endpoint owner and still requires a human-readable replay reason.

Why:
- Manual replay can resend customer-facing webhooks, so it should not be authorized by intent text alone.
- API-key roles reuse the existing hashed key and owner model, avoiding a premature tenant user/RBAC build.
- Separating `producer` and `operator` gives the portfolio slice a concrete least-privilege story while keeping local bootstrap simple.
- Keeping owner matching on replay prevents one tenant operator key from replaying another tenant's delivery.

Rejected alternatives:
- Full tenant users and team RBAC now: the final shape is right, but it would dominate the delivery-platform slice.
- A shared static operator token: fast to implement, but it would bypass owner scope and duplicate the API-key auth path.
- Keep replay unauthenticated with only `requested_by`: useful for a first demo, but too weak once producer keys and ownership exist.

Follow-up:
Add signed user identity to replay audit records, approval workflows for sensitive replays, scoped permissions per endpoint, and tenant-managed team membership.

## 2026-07-31: Add Receiver Failure Classification

Decision:
Classify failed delivery attempts with a stable `failure_class` field before retry scheduling or dead-letter promotion. Use a small first taxonomy: `receiver_http_4xx`, `receiver_http_5xx`, `receiver_http_other`, `receiver_timeout`, `receiver_network`, and `internal_error`.

Why:
- Operators need to know whether failures are receiver application errors, receiver outages, network path issues, timeouts, or worker/internal problems without parsing free-form error strings.
- Classification belongs in the worker because that is where HookRelay sees the receiver response or fetch error.
- Keeping the class on `delivery_attempts` makes retries, dead letters, dashboards, and future alerts query the same durable field.
- A small text taxonomy is enough for this slice and avoids premature alert routing or incident workflow modeling.

Rejected alternatives:
- Store only raw error messages: easy, but too brittle for dashboards and interview discussion.
- Add a separate failure analytics table now: useful later, but overkill before the delivery attempt lifecycle needs aggregation.
- Classify only in the dashboard: presentation-only classification would drift from worker behavior and would not help durable alerting.

Follow-up:
Add receiver failure trend charts, alert routing by failure class, endpoint-specific retry policies, and richer receiver diagnostics.

## 2026-08-01: Add Failure-Class Dashboard Filters

Decision:
Add client-side failure-class filtering to the delivery log. The dashboard exposes `all`, `none`, and every contract-published/observed `failure_class` with live counts, then filters the already-loaded delivery attempts in memory.

Why:
- Operators need to isolate receiver failures quickly once `failure_class` exists.
- The current `/api/deliveries` endpoint returns a bounded local list, so client-side filtering is simpler than adding query parameters before pagination or long-retention search exists.
- Counts beside each class make the filter useful even when the selected class has no matching attempts.
- Including `none` keeps successful, queued, and not-yet-run attempts visible as a deliberate operational state.

Rejected alternatives:
- Add server-side filtering now: useful later, but premature without pagination, saved views, or delivery history retention.
- Build charts immediately: attractive, but filtering is the smaller operator workflow that proves the classification is usable.
- Hard-code only current classes in the UI: contract-published classes keep the dashboard aligned with the API if the taxonomy grows.

Follow-up:
Add server-side delivery search, failure trend charts, saved operator views, and alert routing by failure class.

## 2026-08-01: Add Server-Side Delivery Search

Decision:
Move delivery-log filtering behind `GET /api/deliveries` query parameters. Support exact filters for `status`, `failure_class`, `endpoint_id`, and `event_id`, plus a small text query `q` and a bounded `limit`.

Why:
- Operators need the API to own delivery search before delivery history grows beyond a single dashboard session.
- Exact filters cover the most useful troubleshooting paths: failed attempts, one failure class, one endpoint, or one event chain.
- Keeping the response shape as the existing delivery-attempt array avoids a dashboard migration and keeps replay/signature display unchanged.
- Bounded limits and parameterized PostgreSQL predicates are enough for the current portfolio slice without adding a search service.

Rejected alternatives:
- Add cursor pagination now: useful once there is long-retention history, but unnecessary before the product needs infinite scroll or exports.
- Add a full-text index immediately: better for large datasets, but premature while `q` is a small diagnostic convenience.
- Create a separate `/api/delivery-search` resource: noisier than extending the collection endpoint with query parameters.

Follow-up:
Add pagination cursors, saved operator views, richer event metadata search, failure trend charts, and alert routing by failure class.

## 2026-08-01: Add Delivery Pagination Cursors

Decision:
Return delivery search results as `{ items, page_info }` and paginate `GET /api/deliveries` with an opaque cursor over `(created_at, delivery_id)`. Keep the existing search filters and add `cursor` as the only new query parameter.

Why:
- Delivery attempts are append-friendly, so offset pagination can skip or duplicate rows when workers add new attempts between page requests.
- `(created_at, delivery_id)` matches the newest-first operator view and gives a deterministic tie-breaker when attempts share a timestamp.
- The envelope keeps pagination metadata out of individual delivery records while preserving the delivery attempt shape used by replay and signature display.
- An opaque base64url cursor is enough for this slice and avoids introducing a pagination library or separate read model.

Rejected alternatives:
- Offset pagination: simpler to type, but unstable for an append-heavy delivery log.
- Timestamp-only cursors: compact, but ambiguous when multiple attempts have the same timestamp.
- Separate history table or search index: useful at scale, but premature while PostgreSQL can answer the bounded operational search.

Follow-up:
Add saved delivery views, export workflows, cursor-aware observability joins, and long-retention delivery analytics.

## 2026-08-02: Add Saved Delivery Views

Decision:
Add owner-scoped saved delivery search presets through `GET/POST/DELETE /api/delivery-views`. Require `operator` or `admin` API-key roles, validate saved filters with the existing delivery search parser, persist views in memory or PostgreSQL, and deliberately exclude pagination cursors from stored view state.

Why:
- Operators often return to the same troubleshooting slices, such as failed deliveries for one endpoint or one receiver failure class.
- Reusing the delivery search contract keeps saved views as a thin workflow feature instead of a parallel query model.
- Owner scoping and operator/admin role checks match manual replay authorization and avoid introducing tenant teams before the platform needs them.
- Cursors represent one page position in a changing append-only log, so saving them would make views stale and surprising.

Rejected alternatives:
- Save cursor state with the view: it would resume from an old page rather than showing the newest matching failures.
- Create a separate delivery analytics table now: useful later for trends, but unnecessary for saving operator presets.
- Make saved views public across owners: team sharing belongs with a real tenant/team model and audit trail.

Follow-up:
Add shared/team views, favorites, export workflows, and long-retention delivery analytics.

## 2026-08-02: Add Bounded Delivery CSV Export

Decision:
Add `GET /api/deliveries/export` as a synchronous CSV snapshot over the existing delivery search filters. Require an `operator` or `admin` API key, scope exported rows by endpoint `owner_id`, cap exports at 1000 newest matching rows, and exclude pagination cursors from export requests.

Why:
- Operators need a quick way to hand off delivery evidence without building analytics, reports, or file storage first.
- Reusing delivery search filters keeps export behavior aligned with the dashboard and saved views.
- Owner scoping matches replay and saved-view authorization, which keeps the first export path from becoming a cross-tenant read surface.
- A bounded synchronous CSV is enough for the current local lab and easy to validate without adding background job state.

Rejected alternatives:
- Background export jobs now: useful once delivery history is large, but premature before retention and file lifecycle rules exist.
- Export the current paginated cursor page: too tied to transient UI state; exports should be newest matching snapshots.
- JSONL plus CSV immediately: flexible, but a single CSV format is enough for operator handoff and spreadsheet inspection.

Follow-up:
Add scheduled exports, durable export files, JSONL format, and long-retention delivery analytics.

## 2026-08-03: Add Local Receiver Failure Alert Routing

Decision:
Add owner-scoped receiver failure alert routes and local alert records. Routes match worker-recorded `failed` or `dead_letter` delivery attempts by endpoint owner, delivery status, and optional `failure_class`. Keep dispatch local as persisted alert records exposed through `/api/failure-alerts` before adding external notification integrations.

Why:
- Alert policy belongs where HookRelay already knows the receiver failure class and final delivery status: immediately after the worker records the failed attempt.
- Owner-scoped routes reuse the existing API-key authorization model and prevent cross-tenant alert visibility.
- Local alert records prove the policy and audit surface without needing email, Slack, PagerDuty, or webhook delivery credentials.
- Matching on status plus optional failure class gives useful operator routing while keeping the first rule model small.

Rejected alternatives:
- Send external email/webhook alerts now: useful later, but it adds secrets, retries, and delivery failure handling before local policy is stable.
- Alert only on `dead_letter`: lower noise, but operators may want early warnings on every failed attempt for selected receiver classes.
- Build escalation schedules now: correct for production incident response, but too much tenant/team modeling for this portfolio slice.

Follow-up:
Add external notification delivery, per-route throttling, escalation policies, and alert acknowledgement workflows.

## 2026-08-10: Add Alert Acknowledgement Workflow

Decision:
Add one owner-scoped acknowledgement endpoint for local receiver failure alerts. `POST /api/failure-alerts/:alert_id/acknowledge` requires an active `operator` or `admin` API key, checks the key owner against the alert owner, and writes `acknowledged_at`, `acknowledged_by`, and `acknowledgement_note` once.

Why:
- Acknowledgement is operator audit metadata on the alert record; it should not mutate the original delivery attempt, failure class, route, or alert message.
- Reusing the existing operator/admin API-key boundary keeps the workflow tenant-safe without adding user/team identity too early.
- Returning a conflict for already acknowledged alerts preserves the first acknowledgement actor and note for this slice.
- Keeping the workflow local gives the dashboard a complete alert triage loop before external notification delivery, escalation, or incident timelines exist.

Rejected alternatives:
- Make acknowledgement idempotent and overwrite the note: simpler for clients, but it weakens the audit trail.
- Add assignment, severity, snooze, and incident status now: useful later, but too much workflow state before external notifications exist.
- Acknowledge by delivery id instead of alert id: convenient for batch triage, but routes can intentionally create multiple alert records for one delivery.

Follow-up:
Add alert suppression windows, external notification delivery, and team-level incident ownership.

## 2026-08-11: Add Alert Suppression Windows

Decision:
Add route-level suppression windows for local receiver failure alerts. Alert routes accept `suppression_window_seconds`; after a route emits an alert, HookRelay records `last_alert_at` and suppresses repeated matches for that route until `last_alert_at` plus the configured window.

Why:
- Receiver outages can generate many identical failed/dead-letter deliveries, so operators need a simple noise control before external notifications exist.
- The alert route is the right boundary because it already owns status, failure-class, owner, and target matching.
- Keeping suppression as route-local state avoids introducing incidents, assignments, calendars, or team escalation policy too early.
- Suppressed deliveries still keep their delivery status and failure class, so delivery evidence is not lost; only duplicate local alert records are skipped.

Rejected alternatives:
- Suppress by endpoint globally: easier to reason about, but it would hide different route policies such as dead-letter-only versus selected failure classes.
- Add incident snooze and assignment now: useful later, but it requires user/team identity and incident lifecycle state.
- Add external-notification throttling only: that will be needed later, but local alert records already need noise control for the dashboard.

Follow-up:
Add external notification delivery, per-target retry tracking, and team-level incident ownership.

## 2026-08-11: Add Best-Effort Webhook Alert Notifications

Decision:
Add the first external notification path for receiver failure alerts by dispatching `target_type: "webhook"` routes from the worker after local alert records are created. Store `notification_status`, `notification_response_status`, `notification_error`, and `notification_attempted_at` on each alert record.

Why:
- Webhook notification delivery fits HookRelay's existing domain and can be validated locally without email providers, OAuth, or paid integrations.
- Creating the local alert record first preserves the audit trail even if the external notification target fails.
- Best-effort synchronous dispatch keeps the slice small and makes notification outcome visible without introducing a second queue or retry scheduler for notifications.
- Persisting notification status gives operators enough evidence to distinguish "alert matched" from "external notification delivered".

Rejected alternatives:
- Add email delivery now: useful later, but it requires credential handling, provider-specific errors, and deliverability concerns.
- Add a dedicated notification queue now: more production-ready, but premature before the payload, target model, and failure states are proven.
- Treat notification failure as delivery failure: incorrect boundary; the receiver delivery and the operator notification are separate side effects.

Follow-up:
Add notification retry jobs, signed alert notifications, email provider configuration, and per-target delivery history.

## 2026-08-12: Add Notification Retry Tracking

Decision:
Track webhook alert notification retry state on the alert record and add `POST /api/failure-alerts/:alert_id/retry-notification` for owner-scoped operator/admin manual retries. The record now stores attempt count, next retry timestamp, and retry exhaustion state alongside the existing notification status, response status, error, and attempted timestamp.

Why:
- Failed operator notifications need their own retry evidence, but they should still remain separate from receiver delivery attempts.
- Manual retry is the smallest useful workflow before adding a second queue, background notification workers, or incident escalation policy.
- Keeping retry state on the alert record preserves the local-alert-first audit trail and avoids creating duplicate alert records for the same route match.
- A short fixed notification retry ladder is easy to explain and gives operators a clear next-action timestamp without pretending automatic jobs exist yet.

Rejected alternatives:
- Add automatic notification retry jobs now: likely production direction, but it adds queue ownership and dead-letter semantics before manual retry behavior is proven.
- Create a separate notification delivery history table now: useful later for per-target analytics, but too broad for a single alert notification slice.
- Reuse receiver delivery retry state: incorrect boundary because receiver webhook delivery and operator alert notification are separate side effects.

Follow-up:
Add automatic notification retry workers, signed alert notification payloads, per-target notification history, and email provider configuration.

## 2026-08-12: Add Signed Alert Notifications

Decision:
Sign webhook alert notification requests with `HookRelay-Alert-Timestamp` and `HookRelay-Alert-Signature`. The signature is HMAC-SHA256 over `<timestamp>.<raw JSON alert notification body>` using `HOOKRELAY_ALERT_NOTIFICATION_SIGNING_SECRET`.

Why:
- Alert notification targets need a way to verify that the alert came from HookRelay and that the JSON body was not changed in transit.
- Reusing the receiver delivery signature shape keeps the mental model consistent while keeping alert notification secrets separate from endpoint signing secrets.
- Signing the exact raw JSON body avoids ambiguity from parsed object ordering or whitespace.
- A single local signing secret is enough for this slice before tenant-managed alert destination secrets or rotation workflows exist.

Rejected alternatives:
- Reuse endpoint signing secrets: incorrect boundary because alert targets may be different systems from receiver endpoints.
- Add per-route notification secrets now: useful later, but it requires secret lifecycle UI and storage before alert targets are more mature.
- Sign only alert ids: simpler, but it would not protect the notification payload body.

Follow-up:
Add per-route alert signing secrets, timestamp tolerance examples for alert receivers, secret rotation, and automatic notification retry workers.

## 2026-08-12: Add Per-Route Alert Signing Secrets

Decision:
Store an alert notification signing secret on each receiver failure alert route. Route creation accepts an optional `notification_signing_secret`; when omitted, HookRelay generates one. Emitted alert records snapshot the route secret and public route/alert responses expose only `notification_signing_secret_preview`.

Why:
- Alert notification targets can be separate services, so each destination should verify requests with its own secret instead of sharing one global alert secret.
- Snapshotting the route secret onto the alert record keeps manual notification retry verifiable even if the route is later edited or deleted.
- Returning a preview gives operators enough confirmation without leaking the full signing secret through list/detail APIs.
- Keeping `HOOKRELAY_ALERT_NOTIFICATION_SIGNING_SECRET` as a fallback preserves older local alert records that predate route-specific secrets.

Rejected alternatives:
- Only use one environment secret forever: simpler, but it couples every alert target to the same credential.
- Join route secrets at retry time only: avoids duplicating the secret, but manual retry would change behavior after route edits or deletion.
- Add rotation/versioning now: useful later, but premature before alert destination management exists.

Follow-up:
Add timestamp tolerance examples for alert receivers, explicit alert secret rotation, automatic notification retry workers, and per-target notification history.

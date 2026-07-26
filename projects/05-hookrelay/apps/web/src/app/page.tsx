"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Endpoint = {
  endpoint_id: string;
  name: string;
  target_url: string;
  status: "active";
  created_at: string;
  signing_secret_preview: string;
};

type DeliveryEvent = {
  event_id: string;
  endpoint_id: string;
  event_type: string;
  idempotency_key: string;
  payload: Record<string, unknown>;
  status: "accepted";
  created_at: string;
};

type DeliveryAttempt = {
  delivery_id: string;
  event_id: string;
  endpoint_id: string;
  target_url: string;
  status: "queued" | "delivering" | "succeeded" | "failed" | "dead_letter";
  attempt_number: number;
  next_attempt_at: string;
  base_delay_seconds: number;
  jitter_seconds: number;
  scheduled_delay_seconds: number;
  response_status: number | null;
  error: string | null;
  replayed_from_delivery_id: string | null;
  replay_reason: string | null;
  replay_requested_by: string | null;
  signature_headers: Record<string, string>;
  created_at: string;
};

type ObservabilitySpan = {
  span_id: string;
  trace_id: string;
  parent_span_id: string | null;
  name: string;
  delivery_id: string | null;
  event_id: string | null;
  endpoint_id: string | null;
  status: "ok" | "error";
  started_at: string;
  ended_at: string;
  duration_ms: number;
  attributes: Record<string, unknown>;
  error: string | null;
};

type DeliveryContract = {
  transport: string;
  storage_mode: string;
  queue_boundary: string;
  observability: {
    mode: string;
    span_endpoint: string;
    traced_operations: string[];
  };
  idempotency_key: string;
  signature_algorithm: string;
  signature_headers: string[];
  retry_policy: {
    mode: string;
    delays_seconds: number[];
    jitter_ratio: number;
    jitter_mode: string;
    dead_letter_after_attempts: number;
  };
  replay_rule: string;
  replay_authorization: {
    mode: string;
    required_body_fields: string[];
    optional_body_fields: string[];
    audit_rule: string;
  };
  receiver_verification: {
    timestamp_tolerance_seconds: number;
    signed_payload: string;
    example_endpoint: string;
  };
};

type ReceiverVerificationExample = {
  timestamp_tolerance_seconds: number;
  signed_payload: string;
  required_headers: string[];
  sample_secret: string;
  sample_payload: Record<string, unknown>;
  sample_headers: Record<string, string>;
  node_example: string;
};

type IngestResponse = {
  duplicate: boolean;
  event: DeliveryEvent;
  deliveries: DeliveryAttempt[];
};

type ObservabilityResponse = {
  mode: string;
  spans: ObservabilitySpan[];
};

const apiBaseUrl = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8400").replace(/\/$/, "");

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const hasBody = Boolean(init?.body);
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      ...init?.headers
    }
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `API request failed with ${response.status}`);
  }

  return response.json() as Promise<T>;
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}

export default function HookRelayHome() {
  const [contract, setContract] = useState<DeliveryContract | null>(null);
  const [verificationExample, setVerificationExample] = useState<ReceiverVerificationExample | null>(null);
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [events, setEvents] = useState<DeliveryEvent[]>([]);
  const [deliveries, setDeliveries] = useState<DeliveryAttempt[]>([]);
  const [observabilityMode, setObservabilityMode] = useState("loading");
  const [spans, setSpans] = useState<ObservabilitySpan[]>([]);
  const [endpointName, setEndpointName] = useState("Billing listener");
  const [targetUrl, setTargetUrl] = useState("https://example.test/webhooks/billing");
  const [selectedEndpointId, setSelectedEndpointId] = useState("endpoint_demo");
  const [eventType, setEventType] = useState("invoice.paid");
  const [idempotencyKey, setIdempotencyKey] = useState("invoice-1001-paid");
  const [payloadText, setPayloadText] = useState('{"invoice_id":"inv_1001","amount":4900,"currency":"USD"}');
  const [statusMessage, setStatusMessage] = useState("Loading HookRelay scaffold state...");

  const selectedEndpoint = endpoints.find((endpoint) => endpoint.endpoint_id === selectedEndpointId) ?? endpoints[0];
  const latestDelivery = deliveries[0];
  const latestSpan = spans[0];
  const queuedCount = deliveries.filter((delivery) => delivery.status === "queued").length;
  const duplicateKeys = useMemo(() => new Set(events.map((event) => event.idempotency_key)), [events]);

  async function refreshAll() {
    const [nextContract, nextVerificationExample, nextEndpoints, nextEvents, nextDeliveries, nextObservability] = await Promise.all([
      requestJson<DeliveryContract>("/api/delivery-contract"),
      requestJson<ReceiverVerificationExample>("/api/receiver-verification-example"),
      requestJson<Endpoint[]>("/api/endpoints"),
      requestJson<DeliveryEvent[]>("/api/events"),
      requestJson<DeliveryAttempt[]>("/api/deliveries"),
      requestJson<ObservabilityResponse>("/api/observability/spans")
    ]);

    setContract(nextContract);
    setVerificationExample(nextVerificationExample);
    setEndpoints(nextEndpoints);
    setEvents(nextEvents);
    setDeliveries(nextDeliveries);
    setObservabilityMode(nextObservability.mode);
    setSpans(nextObservability.spans);
    setSelectedEndpointId((current) => current || nextEndpoints[0]?.endpoint_id || "");
    setStatusMessage("Scaffold API is reachable.");
  }

  async function createEndpoint(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const endpoint = await requestJson<Endpoint>("/api/endpoints", {
        method: "POST",
        body: JSON.stringify({ name: endpointName, target_url: targetUrl })
      });
      setEndpoints((current) => [endpoint, ...current]);
      setSelectedEndpointId(endpoint.endpoint_id);
      setStatusMessage(`Endpoint ${endpoint.name} is ready for events.`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Endpoint creation failed.");
    }
  }

  async function ingestEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedEndpoint) {
      setStatusMessage("Create an endpoint before ingesting events.");
      return;
    }

    try {
      const payload = JSON.parse(payloadText) as Record<string, unknown>;
      const response = await requestJson<IngestResponse>("/api/events", {
        method: "POST",
        body: JSON.stringify({
          endpoint_id: selectedEndpoint.endpoint_id,
          event_type: eventType,
          idempotency_key: idempotencyKey,
          payload
        })
      });
      await refreshAll();
      setStatusMessage(
        response.duplicate
          ? "Duplicate idempotency key returned the existing event without a second enqueue."
          : `Accepted ${response.event.event_type} and queued ${response.deliveries.length} delivery.`
      );
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Event ingestion failed.");
    }
  }

  async function replayDelivery(deliveryId: string) {
    try {
      await requestJson<DeliveryAttempt>(`/api/deliveries/${deliveryId}/replay`, {
        method: "POST",
        body: JSON.stringify({
          reason: "Operator requested replay after receiver recovery",
          requested_by: "local-dashboard"
        })
      });
      await refreshAll();
      setStatusMessage("Replay authorized with operator intent and queued as a new delivery attempt.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Replay failed.");
    }
  }

  useEffect(() => {
    void refreshAll().catch((error) => {
      setStatusMessage(error instanceof Error ? error.message : "Could not load API state.");
    });
  }, []);

  return (
    <main className="app-shell">
      <section className="workbench" aria-label="HookRelay event workbench">
        <div className="topbar">
          <div>
            <span>HookRelay</span>
            <strong>Webhook delivery console</strong>
          </div>
          <button type="button" onClick={() => void refreshAll()}>
            Refresh
          </button>
        </div>

        <div className="metric-strip" aria-label="Delivery metrics">
          <div>
            <span>Endpoints</span>
            <strong>{endpoints.length}</strong>
          </div>
          <div>
            <span>Events</span>
            <strong>{events.length}</strong>
          </div>
          <div>
            <span>Queued</span>
            <strong>{queuedCount}</strong>
          </div>
          <div>
            <span>Retry steps</span>
            <strong>{contract?.retry_policy.delays_seconds.length ?? 0}</strong>
          </div>
          <div>
            <span>Spans</span>
            <strong>{spans.length}</strong>
          </div>
        </div>

        <section className="form-grid">
          <form className="form-panel" onSubmit={createEndpoint}>
            <div className="section-header">
              <span>Endpoint</span>
              <strong>{selectedEndpoint?.status ?? "none"}</strong>
            </div>
            <label>
              <span>Name</span>
              <input value={endpointName} onChange={(event) => setEndpointName(event.target.value)} />
            </label>
            <label>
              <span>Target URL</span>
              <input value={targetUrl} onChange={(event) => setTargetUrl(event.target.value)} />
            </label>
            <button type="submit">Create Endpoint</button>
          </form>

          <form className="form-panel" onSubmit={ingestEvent}>
            <div className="section-header">
              <span>Event Ingestion</span>
              <strong>{duplicateKeys.has(idempotencyKey) ? "duplicate key" : "new key"}</strong>
            </div>
            <label>
              <span>Endpoint</span>
              <select value={selectedEndpoint?.endpoint_id ?? ""} onChange={(event) => setSelectedEndpointId(event.target.value)}>
                {endpoints.map((endpoint) => (
                  <option key={endpoint.endpoint_id} value={endpoint.endpoint_id}>
                    {endpoint.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Event Type</span>
              <input value={eventType} onChange={(event) => setEventType(event.target.value)} />
            </label>
            <label>
              <span>Idempotency Key</span>
              <input value={idempotencyKey} onChange={(event) => setIdempotencyKey(event.target.value)} />
            </label>
            <label>
              <span>Payload JSON</span>
              <textarea value={payloadText} onChange={(event) => setPayloadText(event.target.value)} rows={5} />
            </label>
            <button type="submit" disabled={!selectedEndpoint}>
              Ingest Event
            </button>
          </form>
        </section>

        <section className="table-section" aria-label="Delivery attempts">
          <div className="section-header">
            <span>Delivery Log</span>
            <strong>{deliveries.length}</strong>
          </div>
          <div className="delivery-list">
            {deliveries.length === 0 ? <p className="empty-state">No delivery attempts queued yet.</p> : null}
            {deliveries.map((delivery) => (
              <article className="delivery-row" key={delivery.delivery_id}>
                <div>
                  <strong>{delivery.delivery_id}</strong>
                  <span>{delivery.target_url}</span>
                </div>
                <div>
                  <span>Status</span>
                  <strong>{delivery.status}</strong>
                </div>
                <div>
                  <span>Attempt</span>
                  <strong>{delivery.attempt_number}</strong>
                </div>
                <div>
                  <span>Next try</span>
                  <strong>{formatTime(delivery.next_attempt_at)}</strong>
                </div>
                <div>
                  <span>Jitter</span>
                  <strong>
                    {delivery.jitter_seconds >= 0 ? "+" : ""}
                    {delivery.jitter_seconds}s
                  </strong>
                </div>
                <div>
                  <span>Replay</span>
                  <strong>{delivery.replay_requested_by ?? "original"}</strong>
                </div>
                <button type="button" onClick={() => void replayDelivery(delivery.delivery_id)}>
                  Replay
                </button>
                {delivery.replay_reason ? <p>{delivery.replay_reason}</p> : null}
              </article>
            ))}
          </div>
        </section>
      </section>

      <aside className="side-panel" aria-label="Contract and signature details">
        <section className="panel-block">
          <div className="section-header">
            <span>Delivery Contract</span>
            <strong>{contract?.transport ?? "loading"}</strong>
          </div>
          <dl className="detail-list">
            <div>
              <dt>Storage</dt>
              <dd>{contract?.storage_mode ?? "unknown"}</dd>
            </div>
            <div>
              <dt>Queue Boundary</dt>
              <dd>{contract?.queue_boundary ?? "unknown"}</dd>
            </div>
            <div>
              <dt>Idempotency</dt>
              <dd>{contract?.idempotency_key ?? "unknown"}</dd>
            </div>
            <div>
              <dt>Signing</dt>
              <dd>{contract?.signature_algorithm ?? "unknown"}</dd>
            </div>
            <div>
              <dt>Replay Auth</dt>
              <dd>{contract?.replay_authorization.mode ?? "unknown"}</dd>
            </div>
            <div>
              <dt>Observability</dt>
              <dd>{contract?.observability.mode ?? observabilityMode}</dd>
            </div>
            <div>
              <dt>Receiver Window</dt>
              <dd>{contract?.receiver_verification.timestamp_tolerance_seconds ?? 0}s</dd>
            </div>
            <div>
              <dt>Retry Jitter</dt>
              <dd>{Math.round((contract?.retry_policy.jitter_ratio ?? 0) * 100)}% bounded</dd>
            </div>
          </dl>
        </section>

        <section className="panel-block">
          <div className="section-header">
            <span>Retry Policy</span>
            <strong>{contract?.retry_policy.dead_letter_after_attempts ?? 0} tries</strong>
          </div>
          <div className="retry-grid">
            {contract?.retry_policy.delays_seconds.map((seconds) => (
              <span key={seconds}>{seconds}s</span>
            ))}
          </div>
          <p>
            {contract ? `${contract.retry_policy.jitter_mode} at ${Math.round(contract.retry_policy.jitter_ratio * 100)}% per attempt.` : ""}
          </p>
          <p>{contract?.replay_rule}</p>
          <p>{contract?.replay_authorization.audit_rule}</p>
        </section>

        <section className="panel-block">
          <div className="section-header">
            <span>Receiver Verification</span>
            <strong>{verificationExample ? `${verificationExample.timestamp_tolerance_seconds}s` : "loading"}</strong>
          </div>
          {verificationExample ? (
            <dl className="detail-list">
              <div>
                <dt>Signed Payload</dt>
                <dd>{verificationExample.signed_payload}</dd>
              </div>
              <div>
                <dt>Sample Secret</dt>
                <dd>{verificationExample.sample_secret}</dd>
              </div>
              <div>
                <dt>Required Headers</dt>
                <dd>{verificationExample.required_headers.join(", ")}</dd>
              </div>
              <div>
                <dt>Verifier</dt>
                <dd>{verificationExample.node_example}</dd>
              </div>
            </dl>
          ) : (
            <p>Receiver verification example is loading.</p>
          )}
        </section>

        <section className="panel-block">
          <div className="section-header">
            <span>Signature Preview</span>
            <strong>{latestDelivery ? "ready" : "empty"}</strong>
          </div>
          {latestDelivery ? (
            <dl className="detail-list">
              {Object.entries(latestDelivery.signature_headers).map(([name, value]) => (
                <div key={name}>
                  <dt>{name}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p>No signature generated until an event is accepted.</p>
          )}
        </section>

        <section className="panel-block">
          <div className="section-header">
            <span>Endpoints</span>
            <strong>{endpoints.length}</strong>
          </div>
          <div className="endpoint-list">
            {endpoints.map((endpoint) => (
              <article className="endpoint-row" key={endpoint.endpoint_id}>
                <strong>{endpoint.name}</strong>
                <span>{endpoint.target_url}</span>
                <small>{endpoint.signing_secret_preview}</small>
              </article>
            ))}
          </div>
        </section>

        <section className="panel-block">
          <div className="section-header">
            <span>Observability</span>
            <strong>{latestSpan ? `${latestSpan.duration_ms}ms` : observabilityMode}</strong>
          </div>
          <dl className="detail-list">
            <div>
              <dt>Span Endpoint</dt>
              <dd>{contract?.observability.span_endpoint ?? "/api/observability/spans"}</dd>
            </div>
            <div>
              <dt>Latest Trace</dt>
              <dd>{latestSpan?.trace_id ?? "none"}</dd>
            </div>
            <div>
              <dt>Operations</dt>
              <dd>{contract?.observability.traced_operations.join(", ") ?? "loading"}</dd>
            </div>
          </dl>
          <div className="span-list">
            {spans.slice(0, 5).map((span) => (
              <article className="span-row" key={span.span_id}>
                <div>
                  <strong>{span.name}</strong>
                  <span>{span.delivery_id ?? span.event_id ?? span.endpoint_id ?? span.trace_id}</span>
                </div>
                <small>
                  {span.status} / {span.duration_ms}ms / {formatTime(span.started_at)}
                </small>
              </article>
            ))}
          </div>
        </section>

        <section className="panel-block">
          <div className="section-header">
            <span>Runtime</span>
            <strong>{apiBaseUrl}</strong>
          </div>
          <p>{statusMessage}</p>
        </section>
      </aside>
    </main>
  );
}

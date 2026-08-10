"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Endpoint = {
  endpoint_id: string;
  owner_id: string;
  name: string;
  target_url: string;
  status: "active";
  created_at: string;
  rate_limit_per_minute: number;
  rate_limit_window_seconds: number;
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
  failure_class: string | null;
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
  producer_authentication: {
    mode: string;
    accepted_headers: string[];
    owner_rule: string;
    roles: string[];
    producer_roles: string[];
    rotation_endpoint: string;
    revocation_endpoint: string;
    inactive_statuses: string[];
    demo_owner_id: string;
  };
  endpoint_rate_limit: {
    mode: string;
    scope: string;
    algorithm: string;
    default_limit: number;
    default_window_seconds: number;
    enforced_on: string;
    exceeded_status: number;
    retry_after_header: string;
  };
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
  receiver_failure_classification: {
    field: string;
    classes: string[];
    stored_on: string;
    classified_on: string;
    retry_rule: string;
  };
  delivery_search: {
    endpoint: string;
    sort: string;
    default_limit: number;
    max_limit: number;
    filters: string[];
    failure_class_none: string;
    cursor: {
      mode: string;
      fields: string[];
    };
  };
  delivery_saved_views: {
    endpoint: string;
    owner_rule: string;
    required_roles: string[];
    stored_filters: string[];
    cursor_rule: string;
  };
  delivery_export: {
    endpoint: string;
    format: string;
    max_rows: number;
    required_roles: string[];
    owner_rule: string;
    filters: string[];
    cursor_rule: string;
  };
  receiver_failure_alert_routing: {
    route_endpoint: string;
    alert_endpoint: string;
    acknowledgement_endpoint: string;
    required_roles: string[];
    owner_rule: string;
    trigger_statuses: string[];
    route_statuses: string[];
    target_types: string[];
    delivery_match: string;
    dispatch_mode: string;
    acknowledgement_rule: string;
  };
  replay_rule: string;
  replay_authorization: {
    mode: string;
    accepted_headers: string[];
    required_roles: string[];
    owner_rule: string;
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

type DeliverySearchPageInfo = {
  limit: number;
  sort: string;
  has_more: boolean;
  next_cursor: string | null;
};

type DeliverySearchResponse = {
  items: DeliveryAttempt[];
  page_info: DeliverySearchPageInfo;
};

type DeliveryViewFilters = {
  status: string | null;
  failure_class: string | null;
  endpoint_id: string | null;
  event_id: string | null;
  q: string | null;
  limit: number;
};

type DeliverySavedView = {
  view_id: string;
  owner_id: string;
  name: string;
  filters: DeliveryViewFilters;
  created_at: string;
  updated_at: string;
};

type FailureAlertRoute = {
  route_id: string;
  owner_id: string;
  name: string;
  failure_class: string | null;
  delivery_status: "failed" | "dead_letter" | "any";
  target_type: "dashboard" | "email" | "webhook";
  target: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

type FailureAlert = {
  alert_id: string;
  route_id: string;
  owner_id: string;
  delivery_id: string;
  endpoint_id: string;
  event_id: string;
  failure_class: string | null;
  delivery_status: string;
  target_type: string;
  target: string;
  message: string;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  acknowledgement_note: string | null;
  created_at: string;
};

type ProducerApiKey = {
  key_id: string;
  owner_id: string;
  name: string;
  role: "producer" | "operator" | "admin";
  status: "active" | "disabled" | "rotated" | "revoked";
  key_preview: string;
  rotated_from_key_id?: string | null;
  revoked_at?: string | null;
  created_at: string;
  updated_at?: string;
  api_key?: string;
};

type ProducerApiKeyRotation = {
  previous: ProducerApiKey;
  next: ProducerApiKey;
};

const apiBaseUrl = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8400").replace(/\/$/, "");
const defaultProducerApiKey = process.env.NEXT_PUBLIC_HOOKRELAY_DEMO_PRODUCER_API_KEY ?? "hrp_demo_local_key";

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
  const [deliveryPageInfo, setDeliveryPageInfo] = useState<DeliverySearchPageInfo | null>(null);
  const [savedDeliveryViews, setSavedDeliveryViews] = useState<DeliverySavedView[]>([]);
  const [alertRoutes, setAlertRoutes] = useState<FailureAlertRoute[]>([]);
  const [failureAlerts, setFailureAlerts] = useState<FailureAlert[]>([]);
  const [producerKeys, setProducerKeys] = useState<ProducerApiKey[]>([]);
  const [producerApiKey, setProducerApiKey] = useState(defaultProducerApiKey);
  const [newKeyOwnerId, setNewKeyOwnerId] = useState("owner_demo");
  const [newKeyName, setNewKeyName] = useState("Local dashboard producer");
  const [newKeyRole, setNewKeyRole] = useState<ProducerApiKey["role"]>("producer");
  const [observabilityMode, setObservabilityMode] = useState("loading");
  const [spans, setSpans] = useState<ObservabilitySpan[]>([]);
  const [endpointName, setEndpointName] = useState("Billing listener");
  const [targetUrl, setTargetUrl] = useState("https://example.test/webhooks/billing");
  const [rateLimitPerMinute, setRateLimitPerMinute] = useState(60);
  const [rateLimitWindowSeconds, setRateLimitWindowSeconds] = useState(60);
  const [selectedEndpointId, setSelectedEndpointId] = useState("endpoint_demo");
  const [eventType, setEventType] = useState("invoice.paid");
  const [idempotencyKey, setIdempotencyKey] = useState("invoice-1001-paid");
  const [payloadText, setPayloadText] = useState('{"invoice_id":"inv_1001","amount":4900,"currency":"USD"}');
  const [deliveryStatusFilter, setDeliveryStatusFilter] = useState("all");
  const [statusMessage, setStatusMessage] = useState("Loading HookRelay scaffold state...");
  const [failureClassFilter, setFailureClassFilter] = useState("all");
  const [deliveryEndpointFilter, setDeliveryEndpointFilter] = useState("all");
  const [deliverySearchText, setDeliverySearchText] = useState("");
  const [deliveryViewName, setDeliveryViewName] = useState("Failed receiver issues");
  const [selectedDeliveryViewId, setSelectedDeliveryViewId] = useState("");
  const [alertRouteName, setAlertRouteName] = useState("Dead-letter receiver alerts");
  const [alertFailureClass, setAlertFailureClass] = useState("all");
  const [alertDeliveryStatus, setAlertDeliveryStatus] = useState<FailureAlertRoute["delivery_status"]>("dead_letter");
  const [alertTargetType, setAlertTargetType] = useState<FailureAlertRoute["target_type"]>("dashboard");
  const [alertTarget, setAlertTarget] = useState("local-dashboard");
  const [acknowledgementNote, setAcknowledgementNote] = useState("Reviewed in local dashboard");

  const selectedEndpoint = endpoints.find((endpoint) => endpoint.endpoint_id === selectedEndpointId) ?? endpoints[0];
  const latestDelivery = deliveries[0];
  const latestSpan = spans[0];
  const queuedCount = deliveries.filter((delivery) => delivery.status === "queued").length;
  const duplicateKeys = useMemo(() => new Set(events.map((event) => event.idempotency_key)), [events]);
  const failureClassOptions = useMemo(() => {
    const contractClasses = contract?.receiver_failure_classification.classes ?? [];
    const observedClasses = deliveries
      .map((delivery) => delivery.failure_class)
      .filter((failureClass): failureClass is string => Boolean(failureClass));

    return Array.from(new Set([...contractClasses, ...observedClasses]));
  }, [contract, deliveries]);

  function currentDeliveryViewFilters(): DeliveryViewFilters {
    return {
      status: deliveryStatusFilter === "all" ? null : deliveryStatusFilter,
      failure_class: failureClassFilter === "all" ? null : failureClassFilter,
      endpoint_id: deliveryEndpointFilter === "all" ? null : deliveryEndpointFilter,
      event_id: null,
      q: deliverySearchText.trim() || null,
      limit: contract?.delivery_search.default_limit ?? 100
    };
  }

  function deliveryQueryParamsFromFilters(filters: DeliveryViewFilters, cursor?: string | null) {
    const params = new URLSearchParams();
    params.set("limit", String(filters.limit ?? contract?.delivery_search.default_limit ?? 100));

    if (filters.status) {
      params.set("status", filters.status);
    }

    if (filters.failure_class) {
      params.set("failure_class", filters.failure_class);
    }

    if (filters.endpoint_id) {
      params.set("endpoint_id", filters.endpoint_id);
    }

    if (filters.event_id) {
      params.set("event_id", filters.event_id);
    }

    if (filters.q) {
      params.set("q", filters.q);
    }

    if (cursor) {
      params.set("cursor", cursor);
    }

    return params;
  }

  function deliverySearchPathFromFilters(filters: DeliveryViewFilters, cursor?: string | null) {
    return `/api/deliveries?${deliveryQueryParamsFromFilters(filters, cursor).toString()}`;
  }

  function deliveryExportPathFromFilters(filters: DeliveryViewFilters) {
    return `/api/deliveries/export?${deliveryQueryParamsFromFilters(filters).toString()}`;
  }

  function buildDeliverySearchPath(cursor?: string | null) {
    return deliverySearchPathFromFilters(currentDeliveryViewFilters(), cursor);
  }

  async function refreshDeliveries({ cursor = null, append = false }: { cursor?: string | null; append?: boolean } = {}) {
    const response = await requestJson<DeliverySearchResponse>(buildDeliverySearchPath(cursor));
    setDeliveries((current) => (append ? [...current, ...response.items] : response.items));
    setDeliveryPageInfo(response.page_info);
    return response;
  }

  async function refreshSavedDeliveryViews() {
    try {
      const views = await requestJson<DeliverySavedView[]>("/api/delivery-views", {
        headers: { Authorization: `Bearer ${producerApiKey}` }
      });
      setSavedDeliveryViews(views);
      setSelectedDeliveryViewId((current) => current || views[0]?.view_id || "");
      return views;
    } catch {
      setSavedDeliveryViews([]);
      setSelectedDeliveryViewId("");
      return [];
    }
  }

  async function refreshAlertRouting() {
    try {
      const [routes, alerts] = await Promise.all([
        requestJson<FailureAlertRoute[]>("/api/alert-routes", {
          headers: { Authorization: `Bearer ${producerApiKey}` }
        }),
        requestJson<FailureAlert[]>("/api/failure-alerts?limit=20", {
          headers: { Authorization: `Bearer ${producerApiKey}` }
        })
      ]);
      setAlertRoutes(routes);
      setFailureAlerts(alerts);
      return { routes, alerts };
    } catch {
      setAlertRoutes([]);
      setFailureAlerts([]);
      return { routes: [], alerts: [] };
    }
  }

  async function refreshAll() {
    const [
      nextContract,
      nextVerificationExample,
      nextProducerKeys,
      nextEndpoints,
      nextEvents,
      nextDeliverySearch,
      nextObservability
    ] = await Promise.all([
      requestJson<DeliveryContract>("/api/delivery-contract"),
      requestJson<ReceiverVerificationExample>("/api/receiver-verification-example"),
      requestJson<ProducerApiKey[]>("/api/producer-api-keys"),
      requestJson<Endpoint[]>("/api/endpoints"),
      requestJson<DeliveryEvent[]>("/api/events"),
      requestJson<DeliverySearchResponse>(buildDeliverySearchPath()),
      requestJson<ObservabilityResponse>("/api/observability/spans")
    ]);

    setContract(nextContract);
    setVerificationExample(nextVerificationExample);
    setProducerKeys(nextProducerKeys);
    setEndpoints(nextEndpoints);
    setEvents(nextEvents);
    setDeliveries(nextDeliverySearch.items);
    setDeliveryPageInfo(nextDeliverySearch.page_info);
    setObservabilityMode(nextObservability.mode);
    setSpans(nextObservability.spans);
    setSelectedEndpointId((current) => current || nextEndpoints[0]?.endpoint_id || "");
    void refreshSavedDeliveryViews();
    void refreshAlertRouting();
    setStatusMessage("Scaffold API is reachable.");
  }

  async function searchDeliveries(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const response = await refreshDeliveries();
      setStatusMessage(`Delivery search returned ${response.items.length} attempts.`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Delivery search failed.");
    }
  }

  async function loadMoreDeliveries() {
    if (!deliveryPageInfo?.next_cursor) {
      return;
    }

    try {
      const response = await refreshDeliveries({ cursor: deliveryPageInfo.next_cursor, append: true });
      setStatusMessage(`Loaded ${response.items.length} more delivery attempts.`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Loading the next delivery page failed.");
    }
  }

  async function downloadDeliveryExport() {
    const filters = {
      ...currentDeliveryViewFilters(),
      limit: contract?.delivery_export.max_rows ?? 1000
    };

    try {
      const response = await fetch(`${apiBaseUrl}${deliveryExportPathFromFilters(filters)}`, {
        headers: { Authorization: `Bearer ${producerApiKey}` }
      });
      if (!response.ok) {
        throw new Error((await response.text()) || `Delivery export failed with ${response.status}`);
      }

      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const fileName = disposition.match(/filename="([^"]+)"/)?.[1] ?? "hookrelay-deliveries.csv";
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(href);
      setStatusMessage(`Exported ${response.headers.get("X-HookRelay-Export-Row-Count") ?? "0"} delivery rows.`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Delivery export failed.");
    }
  }

  async function saveDeliveryView(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const view = await requestJson<DeliverySavedView>("/api/delivery-views", {
        method: "POST",
        headers: { Authorization: `Bearer ${producerApiKey}` },
        body: JSON.stringify({
          name: deliveryViewName,
          filters: currentDeliveryViewFilters()
        })
      });
      setSavedDeliveryViews((current) => [view, ...current]);
      setSelectedDeliveryViewId(view.view_id);
      setStatusMessage(`Saved delivery view ${view.name}.`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Saving the delivery view failed.");
    }
  }

  async function applyDeliveryView(viewId: string) {
    const view = savedDeliveryViews.find((candidate) => candidate.view_id === viewId);
    if (!view) {
      return;
    }

    const filters = view.filters;
    setSelectedDeliveryViewId(view.view_id);
    setDeliveryStatusFilter(filters.status ?? "all");
    setFailureClassFilter(filters.failure_class ?? "all");
    setDeliveryEndpointFilter(filters.endpoint_id ?? "all");
    setDeliverySearchText(filters.q ?? "");
    setDeliveryPageInfo(null);

    try {
      const response = await requestJson<DeliverySearchResponse>(deliverySearchPathFromFilters(filters));
      setDeliveries(response.items);
      setDeliveryPageInfo(response.page_info);
      setStatusMessage(`Applied delivery view ${view.name}.`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Applying the delivery view failed.");
    }
  }

  async function deleteDeliveryView() {
    if (!selectedDeliveryViewId) {
      return;
    }

    try {
      await requestJson<DeliverySavedView>(`/api/delivery-views/${selectedDeliveryViewId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${producerApiKey}` }
      });
      setSavedDeliveryViews((current) => current.filter((view) => view.view_id !== selectedDeliveryViewId));
      setSelectedDeliveryViewId("");
      setStatusMessage("Delivery view deleted.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Deleting the delivery view failed.");
    }
  }

  async function createAlertRoute(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const route = await requestJson<FailureAlertRoute>("/api/alert-routes", {
        method: "POST",
        headers: { Authorization: `Bearer ${producerApiKey}` },
        body: JSON.stringify({
          name: alertRouteName,
          failure_class: alertFailureClass === "all" ? null : alertFailureClass,
          delivery_status: alertDeliveryStatus,
          target_type: alertTargetType,
          target: alertTarget,
          enabled: true
        })
      });
      setAlertRoutes((current) => [route, ...current]);
      setStatusMessage(`Alert route ${route.name} created.`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Creating the alert route failed.");
    }
  }

  async function deleteAlertRoute(routeId: string) {
    try {
      await requestJson<FailureAlertRoute>(`/api/alert-routes/${routeId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${producerApiKey}` }
      });
      setAlertRoutes((current) => current.filter((route) => route.route_id !== routeId));
      setStatusMessage("Alert route deleted.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Deleting the alert route failed.");
    }
  }

  async function acknowledgeFailureAlert(alertId: string) {
    try {
      const alert = await requestJson<FailureAlert>(`/api/failure-alerts/${alertId}/acknowledge`, {
        method: "POST",
        headers: { Authorization: `Bearer ${producerApiKey}` },
        body: JSON.stringify({
          acknowledged_by: "local-dashboard",
          note: acknowledgementNote
        })
      });
      setFailureAlerts((current) => current.map((candidate) => (candidate.alert_id === alert.alert_id ? alert : candidate)));
      setStatusMessage(`Acknowledged alert ${alert.alert_id}.`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Acknowledging the failure alert failed.");
    }
  }

  async function createEndpoint(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const endpoint = await requestJson<Endpoint>("/api/endpoints", {
        method: "POST",
        headers: { Authorization: `Bearer ${producerApiKey}` },
        body: JSON.stringify({
          name: endpointName,
          target_url: targetUrl,
          rate_limit_per_minute: rateLimitPerMinute,
          rate_limit_window_seconds: rateLimitWindowSeconds
        })
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
        headers: { Authorization: `Bearer ${producerApiKey}` },
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

  async function createProducerKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const key = await requestJson<ProducerApiKey>("/api/producer-api-keys", {
        method: "POST",
        body: JSON.stringify({ owner_id: newKeyOwnerId, name: newKeyName, role: newKeyRole })
      });
      setProducerKeys((current) => [key, ...current]);
      if (key.api_key) {
        setProducerApiKey(key.api_key);
      }
      setStatusMessage("Producer API key created. The full key is shown once in the API response and loaded into this dashboard.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Producer key creation failed.");
    }
  }

  async function rotateProducerKey(keyId: string) {
    try {
      const rotation = await requestJson<ProducerApiKeyRotation>(`/api/producer-api-keys/${keyId}/rotate`, {
        method: "POST"
      });
      await refreshAll();
      if (rotation.next.api_key) {
        setProducerApiKey(rotation.next.api_key);
      }
      setStatusMessage("Producer API key rotated. The old key is inactive and the replacement key is loaded into this dashboard.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Producer key rotation failed.");
    }
  }

  async function revokeProducerKey(keyId: string) {
    try {
      await requestJson<ProducerApiKey>(`/api/producer-api-keys/${keyId}/revoke`, {
        method: "POST"
      });
      await refreshAll();
      setStatusMessage("Producer API key revoked. Revoked keys can no longer create endpoints or ingest events.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Producer key revocation failed.");
    }
  }

  async function replayDelivery(deliveryId: string) {
    try {
      await requestJson<DeliveryAttempt>(`/api/deliveries/${deliveryId}/replay`, {
        method: "POST",
        headers: { Authorization: `Bearer ${producerApiKey}` },
        body: JSON.stringify({
          reason: "Operator requested replay after receiver recovery",
          requested_by: "local-dashboard"
        })
      });
      await refreshAll();
      setStatusMessage("Replay authorized with an operator/admin key and queued as a new delivery attempt.");
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
          <div>
            <span>Rate limit</span>
            <strong>{selectedEndpoint?.rate_limit_per_minute ?? contract?.endpoint_rate_limit.default_limit ?? 0}/min</strong>
          </div>
          <div>
            <span>API keys</span>
            <strong>{producerKeys.length}</strong>
          </div>
        </div>

        <section className="form-grid">
          <form className="form-panel" onSubmit={createProducerKey}>
            <div className="section-header">
              <span>Producer Auth</span>
              <strong>{contract?.producer_authentication.mode ?? "loading"}</strong>
            </div>
            <label>
              <span>Active API Key</span>
              <input value={producerApiKey} onChange={(event) => setProducerApiKey(event.target.value)} />
            </label>
            <label>
              <span>Owner ID</span>
              <input value={newKeyOwnerId} onChange={(event) => setNewKeyOwnerId(event.target.value)} />
            </label>
            <label>
              <span>Key Name</span>
              <input value={newKeyName} onChange={(event) => setNewKeyName(event.target.value)} />
            </label>
            <label>
              <span>Role</span>
              <select value={newKeyRole} onChange={(event) => setNewKeyRole(event.target.value as ProducerApiKey["role"])}>
                <option value="producer">producer</option>
                <option value="operator">operator</option>
                <option value="admin">admin</option>
              </select>
            </label>
            <button type="submit">Create API Key</button>
          </form>

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
            <label>
              <span>Events Per Window</span>
              <input
                min={1}
                type="number"
                value={rateLimitPerMinute}
                onChange={(event) => setRateLimitPerMinute(Number(event.target.value))}
              />
            </label>
            <label>
              <span>Window Seconds</span>
              <input
                min={1}
                type="number"
                value={rateLimitWindowSeconds}
                onChange={(event) => setRateLimitWindowSeconds(Number(event.target.value))}
              />
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
            <strong>
              {deliveries.length}
              {deliveryPageInfo?.has_more ? "+" : ""}
            </strong>
          </div>
          <form className="filter-row" aria-label="Server-side delivery search" onSubmit={searchDeliveries}>
            <label>
              <span>Status</span>
              <select
                value={deliveryStatusFilter}
                onChange={(event) => {
                  setDeliveryStatusFilter(event.target.value);
                  setDeliveryPageInfo(null);
                }}
              >
                <option value="all">all</option>
                <option value="queued">queued</option>
                <option value="delivering">delivering</option>
                <option value="succeeded">succeeded</option>
                <option value="failed">failed</option>
                <option value="dead_letter">dead_letter</option>
              </select>
            </label>
            <label>
              <span>Failure Class</span>
              <select
                value={failureClassFilter}
                onChange={(event) => {
                  setFailureClassFilter(event.target.value);
                  setDeliveryPageInfo(null);
                }}
              >
                <option value="all">all</option>
                <option value="none">none</option>
                {failureClassOptions.map((failureClass) => (
                  <option key={failureClass} value={failureClass}>
                    {failureClass}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Endpoint</span>
              <select
                value={deliveryEndpointFilter}
                onChange={(event) => {
                  setDeliveryEndpointFilter(event.target.value);
                  setDeliveryPageInfo(null);
                }}
              >
                <option value="all">all</option>
                {endpoints.map((endpoint) => (
                  <option key={endpoint.endpoint_id} value={endpoint.endpoint_id}>
                    {endpoint.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Search</span>
              <input
                value={deliverySearchText}
                onChange={(event) => {
                  setDeliverySearchText(event.target.value);
                  setDeliveryPageInfo(null);
                }}
              />
            </label>
            <div className="filter-actions">
              <button type="submit">Search Deliveries</button>
              <button type="button" onClick={() => void downloadDeliveryExport()}>
                Export CSV
              </button>
            </div>
          </form>
          <form className="saved-view-row" aria-label="Saved delivery views" onSubmit={saveDeliveryView}>
            <label>
              <span>View Name</span>
              <input value={deliveryViewName} onChange={(event) => setDeliveryViewName(event.target.value)} />
            </label>
            <button type="submit">Save View</button>
            <label>
              <span>Saved Views</span>
              <select
                value={selectedDeliveryViewId}
                onChange={(event) => {
                  void applyDeliveryView(event.target.value);
                }}
              >
                <option value="">none</option>
                {savedDeliveryViews.map((view) => (
                  <option key={view.view_id} value={view.view_id}>
                    {view.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" disabled={!selectedDeliveryViewId} onClick={() => void deleteDeliveryView()}>
              Delete View
            </button>
          </form>
          <div className="delivery-list">
            {deliveries.length === 0 ? <p className="empty-state">No delivery attempts match the delivery search.</p> : null}
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
                  <span>Failure</span>
                  <strong>{delivery.failure_class ?? "none"}</strong>
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
            {deliveryPageInfo?.has_more ? (
              <button className="load-more" type="button" onClick={() => void loadMoreDeliveries()}>
                Load More
              </button>
            ) : null}
          </div>
        </section>

        <section className="table-section" aria-label="Receiver failure alert routing">
          <div className="section-header">
            <span>Alert Routing</span>
            <strong>{failureAlerts.length} recent</strong>
          </div>
          <form className="alert-route-row" onSubmit={createAlertRoute}>
            <label>
              <span>Route Name</span>
              <input value={alertRouteName} onChange={(event) => setAlertRouteName(event.target.value)} />
            </label>
            <label>
              <span>Failure Class</span>
              <select value={alertFailureClass} onChange={(event) => setAlertFailureClass(event.target.value)}>
                <option value="all">any</option>
                {failureClassOptions.map((failureClass) => (
                  <option key={failureClass} value={failureClass}>
                    {failureClass}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Status</span>
              <select
                value={alertDeliveryStatus}
                onChange={(event) => setAlertDeliveryStatus(event.target.value as FailureAlertRoute["delivery_status"])}
              >
                <option value="dead_letter">dead_letter</option>
                <option value="failed">failed</option>
                <option value="any">any</option>
              </select>
            </label>
            <label>
              <span>Target Type</span>
              <select value={alertTargetType} onChange={(event) => setAlertTargetType(event.target.value as FailureAlertRoute["target_type"])}>
                <option value="dashboard">dashboard</option>
                <option value="email">email</option>
                <option value="webhook">webhook</option>
              </select>
            </label>
            <label>
              <span>Target</span>
              <input value={alertTarget} onChange={(event) => setAlertTarget(event.target.value)} />
            </label>
            <button type="submit">Add Route</button>
          </form>
          <div className="alert-grid">
            <section>
              <div className="section-header">
                <span>Routes</span>
                <strong>{alertRoutes.length}</strong>
              </div>
              <div className="detail-list">
                {alertRoutes.length === 0 ? <p className="empty-state">No alert routes configured.</p> : null}
                {alertRoutes.map((route) => (
                  <div key={route.route_id}>
                    <dt>{route.name}</dt>
                    <dd>
                      {route.delivery_status} / {route.failure_class ?? "any"} / {route.target_type}:{route.target}
                    </dd>
                    <button type="button" onClick={() => void deleteAlertRoute(route.route_id)}>
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            </section>
            <section>
              <div className="section-header">
                <span>Recent Alerts</span>
                <strong>{failureAlerts.length}</strong>
              </div>
              <label>
                <span>Acknowledgement Note</span>
                <input value={acknowledgementNote} onChange={(event) => setAcknowledgementNote(event.target.value)} />
              </label>
              <div className="detail-list">
                {failureAlerts.length === 0 ? <p className="empty-state">No failure alerts have matched routes.</p> : null}
                {failureAlerts.map((alert) => (
                  <div key={alert.alert_id}>
                    <dt>{alert.acknowledged_at ? "acknowledged" : alert.delivery_status}</dt>
                    <dd>{alert.message}</dd>
                    {alert.acknowledged_at ? (
                      <dd>
                        {alert.acknowledged_by ?? "operator"} / {formatTime(alert.acknowledged_at)} / {alert.acknowledgement_note}
                      </dd>
                    ) : (
                      <button
                        type="button"
                        disabled={acknowledgementNote.trim().length < 6}
                        onClick={() => void acknowledgeFailureAlert(alert.alert_id)}
                      >
                        Acknowledge
                      </button>
                    )}
                    <dd>{formatTime(alert.created_at)}</dd>
                  </div>
                ))}
              </div>
            </section>
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
              <dt>Producer Auth</dt>
              <dd>{contract?.producer_authentication.owner_rule ?? "unknown"}</dd>
            </div>
            <div>
              <dt>Key Lifecycle</dt>
              <dd>
                {contract
                  ? `${contract.producer_authentication.rotation_endpoint} / ${contract.producer_authentication.revocation_endpoint}`
                  : "unknown"}
              </dd>
            </div>
            <div>
              <dt>Signing</dt>
              <dd>{contract?.signature_algorithm ?? "unknown"}</dd>
            </div>
            <div>
              <dt>Replay Auth</dt>
              <dd>
                {contract
                  ? `${contract.replay_authorization.mode}: ${contract.replay_authorization.required_roles.join(", ")}`
                  : "unknown"}
              </dd>
            </div>
            <div>
              <dt>Failure Class</dt>
              <dd>{contract?.receiver_failure_classification.field ?? "unknown"}</dd>
            </div>
            <div>
              <dt>Delivery Search</dt>
              <dd>
                {contract
                  ? `${contract.delivery_search.filters.join(", ")} / ${contract.delivery_search.cursor.mode}`
                  : "unknown"}
              </dd>
            </div>
            <div>
              <dt>Saved Views</dt>
              <dd>{contract?.delivery_saved_views.stored_filters.join(", ") ?? "unknown"}</dd>
            </div>
            <div>
              <dt>Delivery Export</dt>
              <dd>{contract ? `${contract.delivery_export.format} / ${contract.delivery_export.max_rows} rows` : "unknown"}</dd>
            </div>
            <div>
              <dt>Alert Routing</dt>
              <dd>
                {contract
                  ? `${contract.receiver_failure_alert_routing.route_statuses.join(", ")} / ${contract.receiver_failure_alert_routing.acknowledgement_endpoint}`
                  : "unknown"}
              </dd>
            </div>
            <div>
              <dt>Rate Limit</dt>
              <dd>
                {contract
                  ? `${contract.endpoint_rate_limit.default_limit}/${contract.endpoint_rate_limit.default_window_seconds}s ${contract.endpoint_rate_limit.algorithm}`
                  : "unknown"}
              </dd>
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
          <p>{contract?.receiver_failure_classification.retry_rule}</p>
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
                <small>{endpoint.owner_id}</small>
                <small>
                  {endpoint.rate_limit_per_minute}/{endpoint.rate_limit_window_seconds}s
                </small>
                <small>{endpoint.signing_secret_preview}</small>
              </article>
            ))}
          </div>
        </section>

        <section className="panel-block">
          <div className="section-header">
            <span>Producer Keys</span>
            <strong>{producerKeys.length}</strong>
          </div>
          <div className="endpoint-list">
            {producerKeys.map((key) => (
              <article className="endpoint-row" key={key.key_id}>
                <strong>{key.name}</strong>
                <span>{key.owner_id}</span>
                <small>
                  {key.key_preview} / {key.role} / {key.status}
                </small>
                {key.rotated_from_key_id ? <small>rotated from {key.rotated_from_key_id}</small> : null}
                {key.revoked_at ? <small>inactive since {formatTime(key.revoked_at)}</small> : null}
                <div className="key-actions">
                  <button type="button" disabled={key.status !== "active"} onClick={() => void rotateProducerKey(key.key_id)}>
                    Rotate
                  </button>
                  <button type="button" disabled={key.status !== "active"} onClick={() => void revokeProducerKey(key.key_id)}>
                    Revoke
                  </button>
                </div>
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

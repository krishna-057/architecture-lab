import crypto from "node:crypto";
import pg from "pg";
import {
  generateProducerApiKey,
  hashProducerApiKey,
  producerApiKeyPreview,
  publicProducerApiKey
} from "./producer-auth.js";
import { buildDelivery, nowIso, publicEndpoint } from "./signing.js";
import {
  demoOwnerId,
  demoProducerApiKey,
  endpointRateLimitPerMinute,
  endpointRateLimitWindowSeconds,
  retryDelaysSeconds,
  retryJitterRatio
} from "./config.js";

const { Pool } = pg;

function sortNewest(items) {
  return items.sort((left, right) => {
    const createdAtOrder = right.created_at.localeCompare(left.created_at);
    return createdAtOrder === 0 ? right.delivery_id?.localeCompare(left.delivery_id) ?? 0 : createdAtOrder;
  });
}

function normalizeRow(row) {
  if (!row) {
    return null;
  }

  return {
    ...row,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
    revoked_at: row.revoked_at instanceof Date ? row.revoked_at.toISOString() : row.revoked_at,
    acknowledged_at: row.acknowledged_at instanceof Date ? row.acknowledged_at.toISOString() : row.acknowledged_at,
    next_attempt_at: row.next_attempt_at instanceof Date ? row.next_attempt_at.toISOString() : row.next_attempt_at
  };
}

function normalizeJson(value) {
  return typeof value === "string" ? JSON.parse(value) : value;
}

function publicDeliveryView(view) {
  return {
    view_id: view.view_id,
    owner_id: view.owner_id,
    name: view.name,
    filters: normalizeJson(view.filters),
    created_at: view.created_at,
    updated_at: view.updated_at
  };
}

function publicAlertRoute(route) {
  return {
    route_id: route.route_id,
    owner_id: route.owner_id,
    name: route.name,
    failure_class: route.failure_class,
    delivery_status: route.delivery_status,
    target_type: route.target_type,
    target: route.target,
    enabled: Boolean(route.enabled),
    created_at: route.created_at,
    updated_at: route.updated_at
  };
}

function publicFailureAlert(alert) {
  return {
    alert_id: alert.alert_id,
    route_id: alert.route_id,
    owner_id: alert.owner_id,
    delivery_id: alert.delivery_id,
    endpoint_id: alert.endpoint_id,
    event_id: alert.event_id,
    failure_class: alert.failure_class,
    delivery_status: alert.delivery_status,
    target_type: alert.target_type,
    target: alert.target,
    message: alert.message,
    acknowledged_at: alert.acknowledged_at ?? null,
    acknowledged_by: alert.acknowledged_by ?? null,
    acknowledgement_note: alert.acknowledgement_note ?? null,
    created_at: alert.created_at
  };
}

function alertRouteMatches(route, delivery) {
  if (!route.enabled) {
    return false;
  }

  const statusMatches = route.delivery_status === "any" || route.delivery_status === delivery.status;
  const failureMatches = !route.failure_class || route.failure_class === delivery.failure_class;
  return statusMatches && failureMatches;
}

function buildFailureAlert({ route, delivery, endpoint }) {
  return {
    alert_id: `alert_${crypto.randomUUID()}`,
    route_id: route.route_id,
    owner_id: endpoint.owner_id,
    delivery_id: delivery.delivery_id,
    endpoint_id: delivery.endpoint_id,
    event_id: delivery.event_id,
    failure_class: delivery.failure_class,
    delivery_status: delivery.status,
    target_type: route.target_type,
    target: route.target,
    message: `${delivery.status} delivery ${delivery.delivery_id} matched ${delivery.failure_class ?? "unclassified"} for ${endpoint.name}`,
    acknowledged_at: null,
    acknowledged_by: null,
    acknowledgement_note: null,
    created_at: nowIso()
  };
}

function normalizeDeliverySearch(search = {}, { maxLimit = 200 } = {}) {
  return {
    status: search.status ?? null,
    failureClass: search.failureClass ?? null,
    endpointId: search.endpointId ?? null,
    eventId: search.eventId ?? null,
    text: search.text ? String(search.text).toLowerCase() : null,
    cursor: search.cursor ?? null,
    limit: Math.min(Math.max(Number(search.limit ?? 100), 1), maxLimit),
    ownerId: search.ownerId ?? null
  };
}

function deliverySearchText(delivery) {
  return [
    delivery.delivery_id,
    delivery.event_id,
    delivery.endpoint_id,
    delivery.target_url,
    delivery.status,
    delivery.response_status,
    delivery.failure_class,
    delivery.error,
    delivery.replay_reason,
    delivery.replay_requested_by,
    delivery.replayed_from_delivery_id
  ].filter(Boolean).join(" ").toLowerCase();
}

function filterDeliveryMatches(deliveries, filters) {
  return sortNewest(deliveries)
    .filter((delivery) => !filters.status || delivery.status === filters.status)
    .filter((delivery) => {
      if (!filters.failureClass) {
        return true;
      }

      return filters.failureClass === "none"
        ? !delivery.failure_class
        : delivery.failure_class === filters.failureClass;
    })
    .filter((delivery) => !filters.endpointId || delivery.endpoint_id === filters.endpointId)
    .filter((delivery) => !filters.eventId || delivery.event_id === filters.eventId)
    .filter((delivery) => !filters.text || deliverySearchText(delivery).includes(filters.text))
    .filter((delivery) => isAfterDeliveryCursor(delivery, filters.cursor));
}

function applyDeliverySearch(deliveries, search) {
  const filters = normalizeDeliverySearch(search);
  const matches = filterDeliveryMatches(deliveries, filters);

  return buildDeliveryPage(matches, filters);
}

function applyDeliveryExportSearch(deliveries, search) {
  const filters = normalizeDeliverySearch({ ...search, cursor: null }, { maxLimit: 1000 });
  return filterDeliveryMatches(deliveries, filters).slice(0, filters.limit);
}

function isAfterDeliveryCursor(delivery, cursor) {
  if (!cursor) {
    return true;
  }

  if (delivery.created_at < cursor.created_at) {
    return true;
  }

  return delivery.created_at === cursor.created_at && delivery.delivery_id < cursor.delivery_id;
}

function encodeDeliveryCursor(delivery) {
  if (!delivery) {
    return null;
  }

  return Buffer.from(JSON.stringify({
    created_at: delivery.created_at,
    delivery_id: delivery.delivery_id
  })).toString("base64url");
}

function buildDeliveryPage(matches, filters) {
  const rows = matches.slice(0, filters.limit + 1);
  const items = rows.slice(0, filters.limit);
  const hasMore = rows.length > filters.limit;

  return {
    items,
    page_info: {
      limit: filters.limit,
      sort: "created_at_desc_delivery_id_desc",
      has_more: hasMore,
      next_cursor: hasMore ? encodeDeliveryCursor(items.at(-1)) : null
    }
  };
}

export class MemoryStore {
  constructor() {
    this.mode = "in_memory_scaffold";
    this.endpoints = new Map();
    this.events = new Map();
    this.deliveries = new Map();
    this.deliveryViews = new Map();
    this.alertRoutes = new Map();
    this.failureAlerts = new Map();
    this.producerApiKeys = new Map();
    this.idempotencyIndex = new Map();
  }

  async init() {
    const demoKey = this.createProducerApiKeyRecord({
      apiKey: demoProducerApiKey,
      ownerId: demoOwnerId,
      name: "Local demo producer",
      role: "admin"
    });
    this.producerApiKeys.set(demoKey.key_hash, demoKey);

    const endpoint = {
      endpoint_id: "endpoint_demo",
      owner_id: demoOwnerId,
      name: "Local billing listener",
      target_url: "https://example.test/webhooks/billing",
      status: "active",
      signing_secret: "whsec_demo_local_secret",
      rate_limit_per_minute: endpointRateLimitPerMinute,
      rate_limit_window_seconds: endpointRateLimitWindowSeconds,
      created_at: nowIso(),
      updated_at: nowIso()
    };
    this.endpoints.set(endpoint.endpoint_id, endpoint);
  }

  async close() {}

  async health() {
    return { storage_mode: this.mode, database_connected: false };
  }

  async listEndpoints() {
    return Array.from(this.endpoints.values()).map(publicEndpoint);
  }

  createProducerApiKeyRecord({ apiKey, ownerId, name, role = "producer", rotatedFromKeyId = null }) {
    return {
      key_id: `pkey_${crypto.randomUUID()}`,
      owner_id: ownerId,
      name,
      role,
      key_hash: hashProducerApiKey(apiKey),
      key_preview: producerApiKeyPreview(apiKey),
      status: "active",
      rotated_from_key_id: rotatedFromKeyId,
      revoked_at: null,
      created_at: nowIso(),
      updated_at: nowIso()
    };
  }

  async listProducerApiKeys() {
    return Array.from(this.producerApiKeys.values()).map(publicProducerApiKey);
  }

  async createProducerApiKey({ ownerId, name, role = "producer" }) {
    const apiKey = generateProducerApiKey();
    const key = this.createProducerApiKeyRecord({ apiKey, ownerId, name, role });
    this.producerApiKeys.set(key.key_hash, key);
    return { ...publicProducerApiKey(key), api_key: apiKey };
  }

  async rotateProducerApiKey(keyId) {
    const current = Array.from(this.producerApiKeys.values()).find((key) => key.key_id === keyId);
    if (!current) {
      return null;
    }

    if (current.status !== "active") {
      return { error: "not_active", key: publicProducerApiKey(current) };
    }

    const now = nowIso();
    current.status = "rotated";
    current.revoked_at = now;
    current.updated_at = now;

    const apiKey = generateProducerApiKey();
    const next = this.createProducerApiKeyRecord({
      apiKey,
      ownerId: current.owner_id,
      name: current.name,
      role: current.role,
      rotatedFromKeyId: current.key_id
    });
    this.producerApiKeys.set(next.key_hash, next);

    return {
      previous: publicProducerApiKey(current),
      next: { ...publicProducerApiKey(next), api_key: apiKey }
    };
  }

  async revokeProducerApiKey(keyId) {
    const current = Array.from(this.producerApiKeys.values()).find((key) => key.key_id === keyId);
    if (!current) {
      return null;
    }

    if (current.status !== "active") {
      return { error: "not_active", key: publicProducerApiKey(current) };
    }

    const now = nowIso();
    current.status = "revoked";
    current.revoked_at = now;
    current.updated_at = now;
    return { key: publicProducerApiKey(current) };
  }

  async authenticateProducerApiKey(apiKey) {
    const key = this.producerApiKeys.get(hashProducerApiKey(apiKey));
    if (!key || key.status !== "active") {
      return null;
    }
    return publicProducerApiKey(key);
  }

  async getEndpoint(endpointId) {
    return this.endpoints.get(endpointId) ?? null;
  }

  async createEndpoint({ ownerId, name, targetUrl, signingSecret, rateLimitPerMinute, rateLimitWindowSeconds }) {
    const endpoint = {
      endpoint_id: `endpoint_${crypto.randomUUID()}`,
      owner_id: ownerId,
      name,
      target_url: targetUrl,
      status: "active",
      signing_secret: signingSecret ?? `whsec_${crypto.randomBytes(18).toString("hex")}`,
      rate_limit_per_minute: rateLimitPerMinute ?? endpointRateLimitPerMinute,
      rate_limit_window_seconds: rateLimitWindowSeconds ?? endpointRateLimitWindowSeconds,
      created_at: nowIso(),
      updated_at: nowIso()
    };

    this.endpoints.set(endpoint.endpoint_id, endpoint);
    return publicEndpoint(endpoint);
  }

  async listEvents() {
    return sortNewest(Array.from(this.events.values()));
  }

  async listDeliveryViews(ownerId) {
    return sortNewest(Array.from(this.deliveryViews.values()).filter((view) => view.owner_id === ownerId)).map(publicDeliveryView);
  }

  async createDeliveryView({ ownerId, name, filters }) {
    const view = {
      view_id: `dview_${crypto.randomUUID()}`,
      owner_id: ownerId,
      name,
      filters,
      created_at: nowIso(),
      updated_at: nowIso()
    };
    this.deliveryViews.set(view.view_id, view);
    return publicDeliveryView(view);
  }

  async deleteDeliveryView({ ownerId, viewId }) {
    const view = this.deliveryViews.get(viewId);
    if (!view || view.owner_id !== ownerId) {
      return null;
    }

    this.deliveryViews.delete(viewId);
    return publicDeliveryView(view);
  }

  async listAlertRoutes(ownerId) {
    return sortNewest(Array.from(this.alertRoutes.values()).filter((route) => route.owner_id === ownerId)).map(publicAlertRoute);
  }

  async createAlertRoute({ ownerId, name, failureClass, deliveryStatus, targetType, target, enabled = true }) {
    const route = {
      route_id: `aroute_${crypto.randomUUID()}`,
      owner_id: ownerId,
      name,
      failure_class: failureClass,
      delivery_status: deliveryStatus,
      target_type: targetType,
      target,
      enabled,
      created_at: nowIso(),
      updated_at: nowIso()
    };
    this.alertRoutes.set(route.route_id, route);
    return publicAlertRoute(route);
  }

  async deleteAlertRoute({ ownerId, routeId }) {
    const route = this.alertRoutes.get(routeId);
    if (!route || route.owner_id !== ownerId) {
      return null;
    }

    this.alertRoutes.delete(routeId);
    return publicAlertRoute(route);
  }

  async listFailureAlerts(ownerId, { limit = 50 } = {}) {
    return sortNewest(Array.from(this.failureAlerts.values()).filter((alert) => alert.owner_id === ownerId))
      .slice(0, limit)
      .map(publicFailureAlert);
  }

  async acknowledgeFailureAlert({ ownerId, alertId, acknowledgedBy, note }) {
    const alert = this.failureAlerts.get(alertId);
    if (!alert || alert.owner_id !== ownerId) {
      return null;
    }

    if (alert.acknowledged_at) {
      return { error: "already_acknowledged", alert: publicFailureAlert(alert) };
    }

    alert.acknowledged_at = nowIso();
    alert.acknowledged_by = acknowledgedBy;
    alert.acknowledgement_note = note;
    this.failureAlerts.set(alert.alert_id, alert);
    return publicFailureAlert(alert);
  }

  async routeFailureAlert(delivery) {
    if (!delivery || !["failed", "dead_letter"].includes(delivery.status)) {
      return [];
    }

    const endpoint = this.endpoints.get(delivery.endpoint_id);
    if (!endpoint) {
      return [];
    }

    const alerts = Array.from(this.alertRoutes.values())
      .filter((route) => route.owner_id === endpoint.owner_id)
      .filter((route) => alertRouteMatches(route, delivery))
      .map((route) => buildFailureAlert({ route, delivery, endpoint }));

    for (const alert of alerts) {
      this.failureAlerts.set(alert.alert_id, alert);
    }

    return alerts.map(publicFailureAlert);
  }

  async getEvent(eventId) {
    return this.events.get(eventId) ?? null;
  }

  async listDeliveries(search = {}) {
    return applyDeliverySearch(Array.from(this.deliveries.values()), search);
  }

  async listDeliveryExport(search = {}) {
    const deliveries = Array.from(this.deliveries.values()).filter((delivery) => {
      if (!search.ownerId) {
        return true;
      }

      return this.endpoints.get(delivery.endpoint_id)?.owner_id === search.ownerId;
    });
    return applyDeliveryExportSearch(deliveries, search);
  }

  async getDelivery(deliveryId) {
    return this.deliveries.get(deliveryId) ?? null;
  }

  async getDeliveriesForEvent(eventId) {
    return Array.from(this.deliveries.values()).filter((delivery) => delivery.event_id === eventId);
  }

  async ingestEvent({ endpoint, eventType, idempotencyKey, payload }) {
    const indexKey = `${endpoint.endpoint_id}:${idempotencyKey}`;
    const existingEventId = this.idempotencyIndex.get(indexKey);
    if (existingEventId) {
      const existingEvent = this.events.get(existingEventId);
      return {
        duplicate: true,
        event: existingEvent,
        deliveries: await this.getDeliveriesForEvent(existingEvent.event_id)
      };
    }

    const event = {
      event_id: `event_${crypto.randomUUID()}`,
      endpoint_id: endpoint.endpoint_id,
      event_type: eventType,
      idempotency_key: idempotencyKey,
      payload,
      status: "accepted",
      created_at: nowIso(),
      updated_at: nowIso()
    };
    const delivery = buildDelivery({ endpoint, event, attemptNumber: 1, retryDelaysSeconds, retryJitterRatio });

    this.events.set(event.event_id, event);
    this.idempotencyIndex.set(indexKey, event.event_id);
    this.deliveries.set(delivery.delivery_id, delivery);

    return { duplicate: false, event, deliveries: [delivery] };
  }

  async createReplayDelivery({ endpoint, event, attemptNumber, replayedFrom, replayReason, replayRequestedBy }) {
    const delivery = buildDelivery({
      endpoint,
      event,
      attemptNumber,
      retryDelaysSeconds,
      retryJitterRatio,
      replayedFrom,
      replayReason,
      replayRequestedBy
    });
    this.deliveries.set(delivery.delivery_id, delivery);
    return delivery;
  }

  async updateDelivery(deliveryId, updates) {
    const current = this.deliveries.get(deliveryId);
    if (!current) {
      return null;
    }

    const next = { ...current, ...updates, updated_at: nowIso() };
    this.deliveries.set(deliveryId, next);
    return next;
  }
}

export class PostgresStore {
  constructor(databaseUrl) {
    this.mode = "postgres";
    this.pool = new Pool({ connectionString: databaseUrl });
  }

  async init() {
    await this.withStartupRetry(() => this.pool.query(`
      create table if not exists producer_api_keys (
        key_id text primary key,
        owner_id text not null,
        name text not null,
        role text not null default 'producer',
        key_hash text not null unique,
        key_preview text not null,
        status text not null default 'active',
        rotated_from_key_id text references producer_api_keys(key_id),
        revoked_at timestamptz,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );

      create table if not exists delivery_saved_views (
        view_id text primary key,
        owner_id text not null,
        name text not null,
        filters jsonb not null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );

      create table if not exists receiver_failure_alert_routes (
        route_id text primary key,
        owner_id text not null,
        name text not null,
        failure_class text,
        delivery_status text not null default 'dead_letter',
        target_type text not null default 'dashboard',
        target text not null,
        enabled boolean not null default true,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );

      create table if not exists receiver_failure_alerts (
        alert_id text primary key,
        route_id text not null references receiver_failure_alert_routes(route_id) on delete cascade,
        owner_id text not null,
        delivery_id text not null,
        endpoint_id text not null,
        event_id text not null,
        failure_class text,
        delivery_status text not null,
        target_type text not null,
        target text not null,
        message text not null,
        acknowledged_at timestamptz,
        acknowledged_by text,
        acknowledgement_note text,
        created_at timestamptz not null default now()
      );

      alter table producer_api_keys
        add column if not exists role text not null default 'producer',
        add column if not exists rotated_from_key_id text references producer_api_keys(key_id),
        add column if not exists revoked_at timestamptz;

      alter table receiver_failure_alerts
        add column if not exists acknowledged_at timestamptz,
        add column if not exists acknowledged_by text,
        add column if not exists acknowledgement_note text;

      alter table producer_api_keys
        drop constraint if exists producer_api_keys_role_check;

      alter table producer_api_keys
        add constraint producer_api_keys_role_check
        check (role in ('producer', 'operator', 'admin'));

      alter table producer_api_keys
        drop constraint if exists producer_api_keys_status_check;

      alter table producer_api_keys
        add constraint producer_api_keys_status_check
        check (status in ('active', 'disabled', 'rotated', 'revoked'));

      alter table webhook_endpoints
        add column if not exists owner_id text not null default 'owner_demo',
        add column if not exists rate_limit_per_minute integer not null default 60,
        add column if not exists rate_limit_window_seconds integer not null default 60;

      do $$
      begin
        if to_regclass('public.delivery_attempts') is not null then
          alter table delivery_attempts
            add column if not exists failure_class text;
        end if;
      end $$;

      create index if not exists idx_delivery_attempts_endpoint_created
        on delivery_attempts(endpoint_id, created_at desc, delivery_id desc);

      create index if not exists idx_delivery_attempts_failure_created
        on delivery_attempts(failure_class, created_at desc, delivery_id desc);

      create index if not exists idx_delivery_attempts_endpoint_cursor
        on delivery_attempts(endpoint_id, created_at desc, delivery_id desc);

      create index if not exists idx_delivery_attempts_failure_cursor
        on delivery_attempts(failure_class, created_at desc, delivery_id desc);

      create index if not exists idx_delivery_saved_views_owner_created
        on delivery_saved_views(owner_id, created_at desc);

      create index if not exists idx_failure_alert_routes_owner_created
        on receiver_failure_alert_routes(owner_id, created_at desc);

      create index if not exists idx_failure_alerts_owner_created
        on receiver_failure_alerts(owner_id, created_at desc);
    `));

    await this.withStartupRetry(() => this.pool.query(
      `insert into webhook_endpoints (
         endpoint_id, owner_id, name, target_url, status, signing_secret,
         rate_limit_per_minute, rate_limit_window_seconds
       )
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (endpoint_id) do nothing`,
      [
        "endpoint_demo",
        demoOwnerId,
        "Local billing listener",
        "https://example.test/webhooks/billing",
        "active",
        "whsec_demo_local_secret",
        endpointRateLimitPerMinute,
        endpointRateLimitWindowSeconds
      ]
    ));

    const demoKeyHash = hashProducerApiKey(demoProducerApiKey);
    await this.withStartupRetry(() => this.pool.query(
      `insert into producer_api_keys (key_id, owner_id, name, role, key_hash, key_preview, status)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (key_hash) do update
         set role = excluded.role,
             updated_at = now()`,
      [
        "pkey_demo",
        demoOwnerId,
        "Local demo producer",
        "admin",
        demoKeyHash,
        producerApiKeyPreview(demoProducerApiKey),
        "active"
      ]
    ));
  }

  async withStartupRetry(operation) {
    let lastError;
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
    throw lastError;
  }

  async close() {
    await this.pool.end();
  }

  async health() {
    await this.pool.query("select 1");
    return { storage_mode: this.mode, database_connected: true };
  }

  async listEndpoints() {
    const result = await this.pool.query(
      `select endpoint_id, owner_id, name, target_url, status, signing_secret,
              rate_limit_per_minute, rate_limit_window_seconds, created_at
       from webhook_endpoints
       order by created_at desc`
    );
    return result.rows.map((row) => publicEndpoint(normalizeRow(row)));
  }

  async listProducerApiKeys() {
    const result = await this.pool.query(
      `select key_id, owner_id, name, role, key_preview, status, rotated_from_key_id, revoked_at, created_at, updated_at
       from producer_api_keys
       order by created_at desc`
    );
    return result.rows.map((row) => publicProducerApiKey(normalizeRow(row)));
  }

  async createProducerApiKey({ ownerId, name, role = "producer" }) {
    const apiKey = generateProducerApiKey();
    const result = await this.pool.query(
      `insert into producer_api_keys (key_id, owner_id, name, role, key_hash, key_preview, status)
       values ($1, $2, $3, $4, $5, $6, $7)
       returning key_id, owner_id, name, role, key_preview, status, rotated_from_key_id, revoked_at, created_at, updated_at`,
      [
        `pkey_${crypto.randomUUID()}`,
        ownerId,
        name,
        role,
        hashProducerApiKey(apiKey),
        producerApiKeyPreview(apiKey),
        "active"
      ]
    );
    return { ...publicProducerApiKey(normalizeRow(result.rows[0])), api_key: apiKey };
  }

  async rotateProducerApiKey(keyId) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const currentResult = await client.query(
        `select key_id, owner_id, name, role, key_preview, status, rotated_from_key_id, revoked_at, created_at, updated_at
         from producer_api_keys
         where key_id = $1
         for update`,
        [keyId]
      );
      const current = normalizeRow(currentResult.rows[0]);
      if (!current) {
        await client.query("rollback");
        return null;
      }

      if (current.status !== "active") {
        await client.query("rollback");
        return { error: "not_active", key: publicProducerApiKey(current) };
      }

      const previousResult = await client.query(
        `update producer_api_keys
         set status = 'rotated', revoked_at = now(), updated_at = now()
         where key_id = $1
         returning key_id, owner_id, name, role, key_preview, status, rotated_from_key_id, revoked_at, created_at, updated_at`,
        [keyId]
      );
      const apiKey = generateProducerApiKey();
      const nextResult = await client.query(
        `insert into producer_api_keys (
           key_id, owner_id, name, role, key_hash, key_preview, status, rotated_from_key_id
         )
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         returning key_id, owner_id, name, role, key_preview, status, rotated_from_key_id, revoked_at, created_at, updated_at`,
        [
          `pkey_${crypto.randomUUID()}`,
          current.owner_id,
          current.name,
          current.role,
          hashProducerApiKey(apiKey),
          producerApiKeyPreview(apiKey),
          "active",
          current.key_id
        ]
      );
      await client.query("commit");
      return {
        previous: publicProducerApiKey(normalizeRow(previousResult.rows[0])),
        next: { ...publicProducerApiKey(normalizeRow(nextResult.rows[0])), api_key: apiKey }
      };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async revokeProducerApiKey(keyId) {
    const currentResult = await this.pool.query(
      `select key_id, owner_id, name, role, key_preview, status, rotated_from_key_id, revoked_at, created_at, updated_at
       from producer_api_keys
       where key_id = $1`,
      [keyId]
    );
    const current = normalizeRow(currentResult.rows[0]);
    if (!current) {
      return null;
    }

    if (current.status !== "active") {
      return { error: "not_active", key: publicProducerApiKey(current) };
    }

    const result = await this.pool.query(
      `update producer_api_keys
       set status = 'revoked', revoked_at = now(), updated_at = now()
       where key_id = $1
       returning key_id, owner_id, name, role, key_preview, status, rotated_from_key_id, revoked_at, created_at, updated_at`,
      [keyId]
    );
    return { key: publicProducerApiKey(normalizeRow(result.rows[0])) };
  }

  async authenticateProducerApiKey(apiKey) {
    const result = await this.pool.query(
      `select key_id, owner_id, name, role, key_preview, status, rotated_from_key_id, revoked_at, created_at, updated_at
       from producer_api_keys
       where key_hash = $1 and status = 'active'`,
      [hashProducerApiKey(apiKey)]
    );
    return result.rows[0] ? publicProducerApiKey(normalizeRow(result.rows[0])) : null;
  }

  async getEndpoint(endpointId) {
    const result = await this.pool.query("select * from webhook_endpoints where endpoint_id = $1", [endpointId]);
    return normalizeRow(result.rows[0]);
  }

  async createEndpoint({ ownerId, name, targetUrl, signingSecret, rateLimitPerMinute, rateLimitWindowSeconds }) {
    const result = await this.pool.query(
      `insert into webhook_endpoints (
         endpoint_id, owner_id, name, target_url, status, signing_secret,
         rate_limit_per_minute, rate_limit_window_seconds
       )
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       returning *`,
      [
        `endpoint_${crypto.randomUUID()}`,
        ownerId,
        name,
        targetUrl,
        "active",
        signingSecret ?? `whsec_${crypto.randomBytes(18).toString("hex")}`,
        rateLimitPerMinute,
        rateLimitWindowSeconds
      ]
    );
    return publicEndpoint(normalizeRow(result.rows[0]));
  }

  async listEvents() {
    const result = await this.pool.query("select * from webhook_events order by created_at desc");
    return result.rows.map(normalizeRow);
  }

  async listDeliveryViews(ownerId) {
    const result = await this.pool.query(
      `select view_id, owner_id, name, filters, created_at, updated_at
       from delivery_saved_views
       where owner_id = $1
       order by created_at desc`,
      [ownerId]
    );
    return result.rows.map((row) => publicDeliveryView(normalizeRow(row)));
  }

  async createDeliveryView({ ownerId, name, filters }) {
    const result = await this.pool.query(
      `insert into delivery_saved_views (view_id, owner_id, name, filters)
       values ($1, $2, $3, $4::jsonb)
       returning view_id, owner_id, name, filters, created_at, updated_at`,
      [`dview_${crypto.randomUUID()}`, ownerId, name, JSON.stringify(filters)]
    );
    return publicDeliveryView(normalizeRow(result.rows[0]));
  }

  async deleteDeliveryView({ ownerId, viewId }) {
    const result = await this.pool.query(
      `delete from delivery_saved_views
       where owner_id = $1 and view_id = $2
       returning view_id, owner_id, name, filters, created_at, updated_at`,
      [ownerId, viewId]
    );
    return result.rows[0] ? publicDeliveryView(normalizeRow(result.rows[0])) : null;
  }

  async listAlertRoutes(ownerId) {
    const result = await this.pool.query(
      `select route_id, owner_id, name, failure_class, delivery_status, target_type, target, enabled, created_at, updated_at
       from receiver_failure_alert_routes
       where owner_id = $1
       order by created_at desc`,
      [ownerId]
    );
    return result.rows.map((row) => publicAlertRoute(normalizeRow(row)));
  }

  async createAlertRoute({ ownerId, name, failureClass, deliveryStatus, targetType, target, enabled = true }) {
    const result = await this.pool.query(
      `insert into receiver_failure_alert_routes (
         route_id, owner_id, name, failure_class, delivery_status, target_type, target, enabled
       )
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       returning route_id, owner_id, name, failure_class, delivery_status, target_type, target, enabled, created_at, updated_at`,
      [`aroute_${crypto.randomUUID()}`, ownerId, name, failureClass, deliveryStatus, targetType, target, enabled]
    );
    return publicAlertRoute(normalizeRow(result.rows[0]));
  }

  async deleteAlertRoute({ ownerId, routeId }) {
    const result = await this.pool.query(
      `delete from receiver_failure_alert_routes
       where owner_id = $1 and route_id = $2
       returning route_id, owner_id, name, failure_class, delivery_status, target_type, target, enabled, created_at, updated_at`,
      [ownerId, routeId]
    );
    return result.rows[0] ? publicAlertRoute(normalizeRow(result.rows[0])) : null;
  }

  async listFailureAlerts(ownerId, { limit = 50 } = {}) {
    const boundedLimit = Math.min(Math.max(Number(limit), 1), 100);
    const result = await this.pool.query(
      `select alert_id, route_id, owner_id, delivery_id, endpoint_id, event_id, failure_class,
              delivery_status, target_type, target, message, acknowledged_at, acknowledged_by,
              acknowledgement_note, created_at
       from receiver_failure_alerts
       where owner_id = $1
       order by created_at desc
       limit $2`,
      [ownerId, boundedLimit]
    );
    return result.rows.map((row) => publicFailureAlert(normalizeRow(row)));
  }

  async acknowledgeFailureAlert({ ownerId, alertId, acknowledgedBy, note }) {
    const result = await this.pool.query(
      `update receiver_failure_alerts
       set acknowledged_at = now(), acknowledged_by = $3, acknowledgement_note = $4
       where owner_id = $1 and alert_id = $2 and acknowledged_at is null
       returning alert_id, route_id, owner_id, delivery_id, endpoint_id, event_id, failure_class,
                 delivery_status, target_type, target, message, acknowledged_at, acknowledged_by,
                 acknowledgement_note, created_at`,
      [ownerId, alertId, acknowledgedBy, note]
    );
    if (result.rows[0]) {
      return publicFailureAlert(normalizeRow(result.rows[0]));
    }

    const existing = await this.pool.query(
      `select alert_id, route_id, owner_id, delivery_id, endpoint_id, event_id, failure_class,
              delivery_status, target_type, target, message, acknowledged_at, acknowledged_by,
              acknowledgement_note, created_at
       from receiver_failure_alerts
       where owner_id = $1 and alert_id = $2`,
      [ownerId, alertId]
    );
    const alert = normalizeRow(existing.rows[0]);
    if (!alert) {
      return null;
    }

    return alert.acknowledged_at
      ? { error: "already_acknowledged", alert: publicFailureAlert(alert) }
      : null;
  }

  async routeFailureAlert(delivery) {
    if (!delivery || !["failed", "dead_letter"].includes(delivery.status)) {
      return [];
    }

    const endpoint = await this.getEndpoint(delivery.endpoint_id);
    if (!endpoint) {
      return [];
    }

    const routesResult = await this.pool.query(
      `select route_id, owner_id, name, failure_class, delivery_status, target_type, target, enabled, created_at, updated_at
       from receiver_failure_alert_routes
       where owner_id = $1 and enabled = true
         and (delivery_status = 'any' or delivery_status = $2)
         and (failure_class is null or failure_class = $3)
       order by created_at desc`,
      [endpoint.owner_id, delivery.status, delivery.failure_class]
    );

    const alerts = routesResult.rows
      .map((row) => normalizeRow(row))
      .filter((route) => alertRouteMatches(route, delivery))
      .map((route) => buildFailureAlert({ route, delivery, endpoint }));

    const savedAlerts = [];
    for (const alert of alerts) {
      const result = await this.pool.query(
        `insert into receiver_failure_alerts (
           alert_id, route_id, owner_id, delivery_id, endpoint_id, event_id, failure_class,
           delivery_status, target_type, target, message
         )
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         returning alert_id, route_id, owner_id, delivery_id, endpoint_id, event_id, failure_class,
                   delivery_status, target_type, target, message, acknowledged_at, acknowledged_by,
                   acknowledgement_note, created_at`,
        [
          alert.alert_id,
          alert.route_id,
          alert.owner_id,
          alert.delivery_id,
          alert.endpoint_id,
          alert.event_id,
          alert.failure_class,
          alert.delivery_status,
          alert.target_type,
          alert.target,
          alert.message
        ]
      );
      savedAlerts.push(publicFailureAlert(normalizeRow(result.rows[0])));
    }

    return savedAlerts;
  }

  async getEvent(eventId) {
    const result = await this.pool.query("select * from webhook_events where event_id = $1", [eventId]);
    return normalizeRow(result.rows[0]);
  }

  async listDeliveries(search = {}) {
    const filters = normalizeDeliverySearch(search);
    const where = [];
    const values = [];

    if (filters.status) {
      values.push(filters.status);
      where.push(`status = $${values.length}`);
    }

    if (filters.failureClass) {
      if (filters.failureClass === "none") {
        where.push("failure_class is null");
      } else {
        values.push(filters.failureClass);
        where.push(`failure_class = $${values.length}`);
      }
    }

    if (filters.endpointId) {
      values.push(filters.endpointId);
      where.push(`endpoint_id = $${values.length}`);
    }

    if (filters.eventId) {
      values.push(filters.eventId);
      where.push(`event_id = $${values.length}`);
    }

    if (filters.text) {
      values.push(`%${filters.text}%`);
      where.push(`concat_ws(' ',
        delivery_id,
        event_id,
        endpoint_id,
        target_url,
        status,
        response_status::text,
        failure_class,
        error,
        replay_reason,
        replay_requested_by,
        replayed_from_delivery_id
      ) ilike $${values.length}`);
    }

    if (filters.cursor) {
      values.push(filters.cursor.created_at);
      values.push(filters.cursor.delivery_id);
      where.push(`(created_at, delivery_id) < ($${values.length - 1}::timestamptz, $${values.length})`);
    }

    values.push(filters.limit + 1);
    const result = await this.pool.query(
      `select * from delivery_attempts
       ${where.length ? `where ${where.join(" and ")}` : ""}
       order by created_at desc, delivery_id desc
       limit $${values.length}`,
      values
    );
    return buildDeliveryPage(result.rows.map(normalizeRow), filters);
  }

  async listDeliveryExport(search = {}) {
    const filters = normalizeDeliverySearch({ ...search, cursor: null }, { maxLimit: 1000 });
    const where = [];
    const values = [];

    if (filters.ownerId) {
      values.push(filters.ownerId);
      where.push(`e.owner_id = $${values.length}`);
    }

    if (filters.status) {
      values.push(filters.status);
      where.push(`d.status = $${values.length}`);
    }

    if (filters.failureClass) {
      if (filters.failureClass === "none") {
        where.push("d.failure_class is null");
      } else {
        values.push(filters.failureClass);
        where.push(`d.failure_class = $${values.length}`);
      }
    }

    if (filters.endpointId) {
      values.push(filters.endpointId);
      where.push(`d.endpoint_id = $${values.length}`);
    }

    if (filters.eventId) {
      values.push(filters.eventId);
      where.push(`d.event_id = $${values.length}`);
    }

    if (filters.text) {
      values.push(`%${filters.text}%`);
      where.push(`concat_ws(' ',
        d.delivery_id,
        d.event_id,
        d.endpoint_id,
        d.target_url,
        d.status,
        d.response_status::text,
        d.failure_class,
        d.error,
        d.replay_reason,
        d.replay_requested_by,
        d.replayed_from_delivery_id
      ) ilike $${values.length}`);
    }

    values.push(filters.limit);
    const result = await this.pool.query(
      `select d.* from delivery_attempts d
       join webhook_endpoints e on e.endpoint_id = d.endpoint_id
       ${where.length ? `where ${where.join(" and ")}` : ""}
       order by d.created_at desc, d.delivery_id desc
       limit $${values.length}`,
      values
    );
    return result.rows.map(normalizeRow);
  }

  async getDelivery(deliveryId) {
    const result = await this.pool.query("select * from delivery_attempts where delivery_id = $1", [deliveryId]);
    return normalizeRow(result.rows[0]);
  }

  async getDeliveriesForEvent(eventId, client = this.pool) {
    const result = await client.query("select * from delivery_attempts where event_id = $1 order by created_at desc", [eventId]);
    return result.rows.map(normalizeRow);
  }

  async ingestEvent({ endpoint, eventType, idempotencyKey, payload }) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");

      const event = {
        event_id: `event_${crypto.randomUUID()}`,
        endpoint_id: endpoint.endpoint_id,
        event_type: eventType,
        idempotency_key: idempotencyKey,
        payload,
        status: "accepted"
      };

      const insertedEvent = await client.query(
        `insert into webhook_events (event_id, endpoint_id, event_type, idempotency_key, payload, status)
         values ($1, $2, $3, $4, $5::jsonb, $6)
         on conflict (endpoint_id, idempotency_key) do nothing
         returning *`,
        [event.event_id, event.endpoint_id, event.event_type, event.idempotency_key, JSON.stringify(event.payload), event.status]
      );

      if (insertedEvent.rowCount === 0) {
        const existing = await client.query(
          `select * from webhook_events
           where endpoint_id = $1 and idempotency_key = $2`,
          [endpoint.endpoint_id, idempotencyKey]
        );
        const existingEvent = normalizeRow(existing.rows[0]);
        const existingDeliveries = await this.getDeliveriesForEvent(existingEvent.event_id, client);
        await client.query("commit");
        return { duplicate: true, event: existingEvent, deliveries: existingDeliveries };
      }

      const savedEvent = normalizeRow(insertedEvent.rows[0]);
      const delivery = buildDelivery({ endpoint, event: savedEvent, attemptNumber: 1, retryDelaysSeconds, retryJitterRatio });
      const savedDelivery = await this.insertDelivery(client, delivery);

      await client.query("commit");
      return { duplicate: false, event: savedEvent, deliveries: [savedDelivery] };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async createReplayDelivery({ endpoint, event, attemptNumber, replayedFrom, replayReason, replayRequestedBy }) {
    const delivery = buildDelivery({
      endpoint,
      event,
      attemptNumber,
      retryDelaysSeconds,
      retryJitterRatio,
      replayedFrom,
      replayReason,
      replayRequestedBy
    });
    return this.insertDelivery(this.pool, delivery);
  }

  async insertDelivery(client, delivery) {
    const result = await client.query(
      `insert into delivery_attempts (
         delivery_id, event_id, endpoint_id, target_url, status, attempt_number,
         next_attempt_at, base_delay_seconds, jitter_seconds, scheduled_delay_seconds,
         response_status, failure_class, error, replayed_from_delivery_id,
         replay_reason, replay_requested_by, signature_headers
       )
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb)
       returning *`,
      [
        delivery.delivery_id,
        delivery.event_id,
        delivery.endpoint_id,
        delivery.target_url,
        delivery.status,
        delivery.attempt_number,
        delivery.next_attempt_at,
        delivery.base_delay_seconds,
        delivery.jitter_seconds,
        delivery.scheduled_delay_seconds,
        delivery.response_status,
        delivery.failure_class,
        delivery.error,
        delivery.replayed_from_delivery_id,
        delivery.replay_reason,
        delivery.replay_requested_by,
        JSON.stringify(delivery.signature_headers)
      ]
    );
    return normalizeRow(result.rows[0]);
  }

  async updateDelivery(deliveryId, updates) {
    const allowed = ["status", "response_status", "failure_class", "error", "next_attempt_at"];
    const entries = Object.entries(updates).filter(([key]) => allowed.includes(key));
    if (entries.length === 0) {
      return this.getDelivery(deliveryId);
    }

    const assignments = entries.map(([key], index) => `${key} = $${index + 2}`);
    const values = entries.map(([, value]) => value);
    const result = await this.pool.query(
      `update delivery_attempts
       set ${assignments.join(", ")}, updated_at = now()
       where delivery_id = $1
       returning *`,
      [deliveryId, ...values]
    );
    return normalizeRow(result.rows[0]);
  }
}

export async function createStore() {
  const databaseUrl = process.env.DATABASE_URL;
  const store = databaseUrl ? new PostgresStore(databaseUrl) : new MemoryStore();
  await store.init();
  return store;
}

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
  return items.sort((left, right) => right.created_at.localeCompare(left.created_at));
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
    next_attempt_at: row.next_attempt_at instanceof Date ? row.next_attempt_at.toISOString() : row.next_attempt_at
  };
}

export class MemoryStore {
  constructor() {
    this.mode = "in_memory_scaffold";
    this.endpoints = new Map();
    this.events = new Map();
    this.deliveries = new Map();
    this.producerApiKeys = new Map();
    this.idempotencyIndex = new Map();
  }

  async init() {
    const demoKey = this.createProducerApiKeyRecord({
      apiKey: demoProducerApiKey,
      ownerId: demoOwnerId,
      name: "Local demo producer"
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

  createProducerApiKeyRecord({ apiKey, ownerId, name, rotatedFromKeyId = null }) {
    return {
      key_id: `pkey_${crypto.randomUUID()}`,
      owner_id: ownerId,
      name,
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

  async createProducerApiKey({ ownerId, name }) {
    const apiKey = generateProducerApiKey();
    const key = this.createProducerApiKeyRecord({ apiKey, ownerId, name });
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

  async getEvent(eventId) {
    return this.events.get(eventId) ?? null;
  }

  async listDeliveries() {
    return sortNewest(Array.from(this.deliveries.values()));
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
        key_hash text not null unique,
        key_preview text not null,
        status text not null default 'active',
        rotated_from_key_id text references producer_api_keys(key_id),
        revoked_at timestamptz,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );

      alter table producer_api_keys
        add column if not exists rotated_from_key_id text references producer_api_keys(key_id),
        add column if not exists revoked_at timestamptz;

      alter table producer_api_keys
        drop constraint if exists producer_api_keys_status_check;

      alter table producer_api_keys
        add constraint producer_api_keys_status_check
        check (status in ('active', 'disabled', 'rotated', 'revoked'));

      alter table webhook_endpoints
        add column if not exists owner_id text not null default 'owner_demo',
        add column if not exists rate_limit_per_minute integer not null default 60,
        add column if not exists rate_limit_window_seconds integer not null default 60;
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
      `insert into producer_api_keys (key_id, owner_id, name, key_hash, key_preview, status)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (key_hash) do nothing`,
      [
        "pkey_demo",
        demoOwnerId,
        "Local demo producer",
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
      `select key_id, owner_id, name, key_preview, status, rotated_from_key_id, revoked_at, created_at, updated_at
       from producer_api_keys
       order by created_at desc`
    );
    return result.rows.map((row) => publicProducerApiKey(normalizeRow(row)));
  }

  async createProducerApiKey({ ownerId, name }) {
    const apiKey = generateProducerApiKey();
    const result = await this.pool.query(
      `insert into producer_api_keys (key_id, owner_id, name, key_hash, key_preview, status)
       values ($1, $2, $3, $4, $5, $6)
       returning key_id, owner_id, name, key_preview, status, rotated_from_key_id, revoked_at, created_at, updated_at`,
      [
        `pkey_${crypto.randomUUID()}`,
        ownerId,
        name,
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
        `select key_id, owner_id, name, key_preview, status, rotated_from_key_id, revoked_at, created_at, updated_at
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
         returning key_id, owner_id, name, key_preview, status, rotated_from_key_id, revoked_at, created_at, updated_at`,
        [keyId]
      );
      const apiKey = generateProducerApiKey();
      const nextResult = await client.query(
        `insert into producer_api_keys (
           key_id, owner_id, name, key_hash, key_preview, status, rotated_from_key_id
         )
         values ($1, $2, $3, $4, $5, $6, $7)
         returning key_id, owner_id, name, key_preview, status, rotated_from_key_id, revoked_at, created_at, updated_at`,
        [
          `pkey_${crypto.randomUUID()}`,
          current.owner_id,
          current.name,
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
      `select key_id, owner_id, name, key_preview, status, rotated_from_key_id, revoked_at, created_at, updated_at
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
       returning key_id, owner_id, name, key_preview, status, rotated_from_key_id, revoked_at, created_at, updated_at`,
      [keyId]
    );
    return { key: publicProducerApiKey(normalizeRow(result.rows[0])) };
  }

  async authenticateProducerApiKey(apiKey) {
    const result = await this.pool.query(
      `select key_id, owner_id, name, key_preview, status, rotated_from_key_id, revoked_at, created_at, updated_at
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

  async getEvent(eventId) {
    const result = await this.pool.query("select * from webhook_events where event_id = $1", [eventId]);
    return normalizeRow(result.rows[0]);
  }

  async listDeliveries() {
    const result = await this.pool.query("select * from delivery_attempts order by created_at desc");
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
         response_status, error, replayed_from_delivery_id, replay_reason,
         replay_requested_by, signature_headers
       )
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb)
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
    const allowed = ["status", "response_status", "error", "next_attempt_at"];
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

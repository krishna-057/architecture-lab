import crypto from "node:crypto";
import pg from "pg";

const { Pool } = pg;

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function normalizeRow(row) {
  if (!row) {
    return null;
  }

  return {
    ...row,
    started_at: row.started_at instanceof Date ? row.started_at.toISOString() : row.started_at,
    ended_at: row.ended_at instanceof Date ? row.ended_at.toISOString() : row.ended_at
  };
}

export function createTraceId() {
  return crypto.randomBytes(16).toString("hex");
}

export function createSpanId() {
  return crypto.randomBytes(8).toString("hex");
}

export class ObservabilitySpanLog {
  constructor({ databaseUrl = null, maxSpans = Number(process.env.OBSERVABILITY_SPAN_LOG_LIMIT ?? 200) } = {}) {
    this.mode = databaseUrl ? "postgres_span_log" : "in_memory_span_log";
    this.maxSpans = maxSpans;
    this.spans = [];
    this.pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;
  }

  async init() {
    if (!this.pool) {
      return;
    }

    await this.pool.query(`
      create table if not exists delivery_observability_spans (
        span_id text primary key,
        trace_id text not null,
        parent_span_id text,
        name text not null,
        delivery_id text,
        event_id text,
        endpoint_id text,
        status text not null,
        started_at timestamptz not null,
        ended_at timestamptz not null,
        duration_ms integer not null,
        attributes jsonb not null default '{}'::jsonb,
        error text
      )
    `);
  }

  async close() {
    await this.pool?.end();
  }

  startSpan({
    name,
    traceId = createTraceId(),
    parentSpanId = null,
    deliveryId = null,
    eventId = null,
    endpointId = null,
    attributes = {}
  }) {
    const recorder = this;
    const startedAtMs = Date.now();
    const span = {
      span_id: createSpanId(),
      trace_id: traceId,
      parent_span_id: parentSpanId,
      name,
      delivery_id: deliveryId,
      event_id: eventId,
      endpoint_id: endpointId,
      started_at: new Date(startedAtMs).toISOString(),
      attributes: { ...attributes }
    };

    return {
      ...span,
      async finish({ status = "ok", attributes: finishAttributes = {}, error = null } = {}) {
        const endedAtMs = Date.now();
        await recorder.recordSpan({
          ...span,
          status,
          ended_at: new Date(endedAtMs).toISOString(),
          duration_ms: Math.max(0, endedAtMs - startedAtMs),
          attributes: { ...span.attributes, ...finishAttributes },
          error: error ? errorMessage(error) : null
        });
      }
    };
  }

  async traceSpan(options, operation) {
    const span = this.startSpan(options);

    try {
      const result = await operation(span);
      await span.finish();
      return result;
    } catch (error) {
      await span.finish({ status: "error", error });
      throw error;
    }
  }

  async recordSpan(span) {
    this.spans.unshift(span);
    this.spans = this.spans.slice(0, this.maxSpans);

    if (!this.pool) {
      return span;
    }

    try {
      await this.pool.query(
        `insert into delivery_observability_spans (
           span_id, trace_id, parent_span_id, name, delivery_id, event_id,
           endpoint_id, status, started_at, ended_at, duration_ms, attributes, error
         )
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13)
         on conflict (span_id) do nothing`,
        [
          span.span_id,
          span.trace_id,
          span.parent_span_id,
          span.name,
          span.delivery_id,
          span.event_id,
          span.endpoint_id,
          span.status,
          span.started_at,
          span.ended_at,
          span.duration_ms,
          JSON.stringify(span.attributes ?? {}),
          span.error
        ]
      );
    } catch (error) {
      console.warn(`HookRelay span persistence failed: ${errorMessage(error)}`);
    }

    return span;
  }

  async listSpans({ limit = 50 } = {}) {
    if (!this.pool) {
      return this.spans.slice(0, limit);
    }

    try {
      const result = await this.pool.query(
        `select *
         from delivery_observability_spans
         order by started_at desc
         limit $1`,
        [limit]
      );
      return result.rows.map(normalizeRow);
    } catch (error) {
      console.warn(`HookRelay span query failed: ${errorMessage(error)}`);
      return this.spans.slice(0, limit);
    }
  }
}

export class NoopObservability {
  constructor() {
    this.mode = "disabled";
  }

  async init() {}

  async close() {}

  startSpan() {
    return {
      span_id: "noop",
      trace_id: "noop",
      attributes: {},
      async finish() {}
    };
  }

  async traceSpan(_options, operation) {
    return operation(this.startSpan());
  }

  async listSpans() {
    return [];
  }
}

export async function createObservability() {
  const observability = new ObservabilitySpanLog({ databaseUrl: process.env.DATABASE_URL });
  await observability.init();
  return observability;
}

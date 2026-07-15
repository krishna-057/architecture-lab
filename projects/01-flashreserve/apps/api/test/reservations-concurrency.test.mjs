import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import Redis from "ioredis";
import pg from "pg";

const { Pool } = pg;

const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const projectDir = resolve(apiDir, "..", "..");
const schemaPath = resolve(projectDir, "db", "schema.sql");
const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://flashreserve:flashreserve@localhost:5432/flashreserve";
const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
const apiPort = Number(process.env.FLASHRESERVE_TEST_API_PORT ?? 3101);
const apiBaseUrl = `http://127.0.0.1:${apiPort}/api`;

test(
  "POST /api/reservations allows only available stock under concurrent attempts",
  { timeout: 45_000 },
  async (t) => {
    const pool = new Pool({ connectionString: databaseUrl });
    const redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
    redis.on("error", () => undefined);
    let apiProcess;

    const runId = randomUUID();
    const productId = randomUUID();
    const userIds = Array.from({ length: 10 }, () => randomUUID());
    const stockKey = `flashreserve:stock:${productId}`;
    const initialStock = 3;
    let infrastructureReady = false;

    try {
      const infrastructureError = await checkInfrastructure(pool, redis);
      if (infrastructureError) {
        t.skip(
          `PostgreSQL and Redis must be running for this integration test: ${infrastructureError.message}`
        );
        return;
      }
      infrastructureReady = true;

      await applySchema(pool);
      await seedDrop(pool, {
        runId,
        productId,
        userIds,
        initialStock
      });
      await redis.set(stockKey, initialStock);

      apiProcess = await startApiServer();

      const responses = await Promise.all(
        userIds.map((userId) =>
          fetch(`${apiBaseUrl}/reservations`, {
            method: "POST",
            headers: {
              "content-type": "application/json"
            },
            body: JSON.stringify({
              userId,
              productId,
              quantity: 1
            })
          })
        )
      );

      const responseBodies = await Promise.all(
        responses.map(async (response) => ({
          status: response.status,
          body: await response.json()
        }))
      );

      const successes = responseBodies.filter(({ status }) => status === 201);
      const conflicts = responseBodies.filter(({ status }) => status === 409);

      assert.equal(successes.length, initialStock);
      assert.equal(conflicts.length, userIds.length - initialStock);
      assert.equal(
        new Set(successes.map(({ body }) => body.reservationId)).size,
        initialStock
      );
      assert.deepEqual(
        successes.map(({ body }) => body.remainingStock).sort((a, b) => a - b),
        [0, 1, 2]
      );
      assert.ok(
        conflicts.every(
          ({ body }) => body.message === "Not enough stock is available."
        )
      );

      const inventory = await pool.query(
        `
          SELECT total_quantity, reserved_quantity, sold_quantity
          FROM inventory
          WHERE product_id = $1
        `,
        [productId]
      );
      assert.deepEqual(inventory.rows[0], {
        total_quantity: initialStock,
        reserved_quantity: initialStock,
        sold_quantity: 0
      });

      const reservations = await pool.query(
        `
          SELECT status, count(*)::int AS count
          FROM reservations
          WHERE product_id = $1
          GROUP BY status
        `,
        [productId]
      );
      assert.deepEqual(reservations.rows, [
        {
          status: "pending",
          count: initialStock
        }
      ]);

      assert.equal(Number(await redis.get(stockKey)), 0);
    } finally {
      if (apiProcess) {
        apiProcess.kill();
        await new Promise((resolveProcess) =>
          apiProcess.once("exit", resolveProcess)
        );
      }
      if (infrastructureReady) {
        await redis.del(stockKey);
        await cleanupDrop(pool, productId, userIds);
      }
      redis.disconnect();
      await pool.end();
    }
  }
);

async function checkInfrastructure(pool, redis) {
  try {
    await pool.query("SELECT 1");
    await redis.ping();
    return null;
  } catch (error) {
    if (process.env.FLASHRESERVE_REQUIRE_INTEGRATION === "1") {
      throw error;
    }

    return error instanceof Error ? error : new Error(String(error));
  }
}

async function applySchema(pool) {
  await pool.query(await readFile(schemaPath, "utf8"));
}

async function seedDrop(pool, { runId, productId, userIds, initialStock }) {
  await pool.query(
    `
      INSERT INTO products (
        id,
        slug,
        name,
        status,
        unit_price_cents,
        drop_starts_at,
        drop_ends_at
      )
      VALUES ($1, $2, $3, 'live', 12999, NOW() - INTERVAL '1 minute', NOW() + INTERVAL '1 hour')
    `,
    [productId, `concurrency-${runId}`, "Concurrency Test Drop"]
  );
  await pool.query(
    `
      INSERT INTO inventory (product_id, total_quantity)
      VALUES ($1, $2)
    `,
    [productId, initialStock]
  );

  for (const [index, userId] of userIds.entries()) {
    await pool.query(
      `
        INSERT INTO users (id, email, display_name)
        VALUES ($1, $2, $3)
      `,
      [userId, `concurrency-${runId}-${index}@example.test`, `Buyer ${index}`]
    );
  }
}

async function cleanupDrop(pool, productId, userIds) {
  await pool.query("DELETE FROM order_items WHERE product_id = $1", [productId]);
  await pool.query(
    `
      DELETE FROM orders
      WHERE reservation_id IN (
        SELECT id
        FROM reservations
        WHERE product_id = $1
      )
    `,
    [productId]
  );
  await pool.query("DELETE FROM reservations WHERE product_id = $1", [productId]);
  await pool.query("DELETE FROM inventory WHERE product_id = $1", [productId]);
  await pool.query("DELETE FROM products WHERE id = $1", [productId]);
  await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [userIds]);
}

async function startApiServer() {
  const child = spawn(process.execPath, ["dist/main.js"], {
    cwd: apiDir,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      REDIS_URL: redisUrl,
      PORT: String(apiPort),
      RESERVATION_CHECKOUT_WINDOW_MS: "60000"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });

  const started = Date.now();
  while (Date.now() - started < 15_000) {
    if (child.exitCode !== null) {
      throw new Error(`API exited before startup:\n${output}`);
    }

    try {
      const response = await fetch(`${apiBaseUrl}/health`);
      if (response.ok) {
        return child;
      }
    } catch {
      await delay(250);
    }
  }

  child.kill();
  throw new Error(`API did not become healthy:\n${output}`);
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

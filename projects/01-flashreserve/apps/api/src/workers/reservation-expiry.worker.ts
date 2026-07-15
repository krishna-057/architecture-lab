import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Job, Worker } from "bullmq";
import Redis from "ioredis";
import { DatabaseService } from "../database/database.service";
import { buildRedisConnectionOptions } from "../redis/redis-connection";
import { RealtimeStockPublisher } from "../realtime/realtime-stock.publisher";
import {
  expireReservationJobName,
  reservationExpiryQueueName,
  reservationKey,
  reservationReleaseMarkerKey,
  stockCounterKey
} from "../reservations/reservation-keys";

interface ReservationExpiryJob {
  reservationId: string;
}

interface ReservationExpiryRow {
  id: string;
  product_id: string;
  quantity: number;
  status: string;
  checkout_expires_at: Date;
}

interface RedisStockReleaseResult {
  status: "released" | "already_released";
  availableStock: number | null;
}

const releaseExpiredReservationStockScript = `
if redis.call("EXISTS", KEYS[2]) == 0 then
  return {-1, -1}
end

local marked = redis.call("SET", KEYS[3], "released", "NX", "PX", ARGV[2])
if not marked then
  return {0, tonumber(redis.call("GET", KEYS[2])) or -1}
end

local availableStock = redis.call("INCRBY", KEYS[2], ARGV[1])
redis.call("DEL", KEYS[1])
return {1, availableStock}
`;

@Injectable()
export class ReservationExpiryWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReservationExpiryWorker.name);
  private readonly redis: Redis;
  private readonly worker: Worker<ReservationExpiryJob>;
  private readonly releaseMarkerTtlMs: number;

  constructor(
    private readonly database: DatabaseService,
    private readonly realtimeStockPublisher: RealtimeStockPublisher,
    config: ConfigService
  ) {
    const redisUrl = config.get<string>("REDIS_URL") ?? "redis://localhost:6379";
    const concurrency = Number(
      config.get<string>("RESERVATION_EXPIRY_WORKER_CONCURRENCY") ?? 5
    );

    this.redis = new Redis(redisUrl, {
      maxRetriesPerRequest: null
    });
    this.worker = new Worker<ReservationExpiryJob>(
      reservationExpiryQueueName,
      (job) => this.process(job),
      {
        autorun: false,
        concurrency,
        connection: buildRedisConnectionOptions(redisUrl)
      }
    );
    this.releaseMarkerTtlMs = Number(
      config.get<string>("RESERVATION_REDIS_RELEASE_MARKER_TTL_MS") ??
        24 * 60 * 60 * 1000
    );
  }

  onModuleInit() {
    this.worker.on("failed", (job, error) => {
      this.logger.warn(
        `Reservation expiry job ${job?.id ?? "unknown"} failed: ${error.message}`
      );
    });
    this.worker.run();
  }

  async onModuleDestroy() {
    await this.worker.close();
    this.redis.disconnect();
  }

  private async process(job: Job<ReservationExpiryJob>) {
    if (job.name !== expireReservationJobName) {
      return { status: "ignored", reason: "unknown_job_name" };
    }

    if (!job.data.reservationId) {
      throw new Error("Reservation expiry job is missing reservationId.");
    }

    const reservation = await this.loadReservation(job.data.reservationId);

    if (!reservation) {
      return { status: "ignored", reason: "reservation_not_found" };
    }

    if (reservation.status === "pending") {
      if (reservation.checkout_expires_at.getTime() > Date.now()) {
        return { status: "ignored", reason: "reservation_not_due" };
      }

      const expiredReservation = await this.expireDurableReservation(
        reservation.id
      );

      if (expiredReservation) {
        const redisRelease = await this.releaseRedisStock(expiredReservation);
        this.publishExpiryStockUpdate(expiredReservation, redisRelease);
        return { status: "expired", redisRelease: redisRelease.status };
      }

      const latestReservation = await this.loadReservation(reservation.id);
      if (latestReservation?.status === "expired") {
        const redisRelease = await this.releaseRedisStock(latestReservation);
        this.publishExpiryStockUpdate(latestReservation, redisRelease);
        return { status: "already_expired", redisRelease: redisRelease.status };
      }

      return { status: "ignored", reason: "reservation_changed" };
    }

    if (reservation.status === "expired") {
      const redisRelease = await this.releaseRedisStock(reservation);
      this.publishExpiryStockUpdate(reservation, redisRelease);
      return { status: "already_expired", redisRelease: redisRelease.status };
    }

    return { status: "ignored", reason: `reservation_${reservation.status}` };
  }

  private async loadReservation(reservationId: string) {
    const result = await this.database.query<ReservationExpiryRow>(
      `
        SELECT id, product_id, quantity, status, checkout_expires_at
        FROM reservations
        WHERE id = $1
      `,
      [reservationId]
    );

    return result.rows[0] ?? null;
  }

  private async expireDurableReservation(reservationId: string) {
    return this.database.transaction(async (client) => {
      const reservationResult = await client.query<ReservationExpiryRow>(
        `
          UPDATE reservations
          SET status = 'expired',
              expired_at = COALESCE(expired_at, NOW())
          WHERE id = $1
            AND status = 'pending'
            AND checkout_expires_at <= NOW()
          RETURNING id, product_id, quantity, status, checkout_expires_at
        `,
        [reservationId]
      );

      const reservation = reservationResult.rows[0];
      if (!reservation) {
        return null;
      }

      const inventoryResult = await client.query(
        `
          UPDATE inventory
          SET reserved_quantity = reserved_quantity - $2,
              version = version + 1,
              last_reconciled_at = NOW()
          WHERE product_id = $1
            AND reserved_quantity >= $2
        `,
        [reservation.product_id, reservation.quantity]
      );

      if (inventoryResult.rowCount !== 1) {
        throw new Error("Expired reservation could not release durable stock.");
      }

      return reservation;
    });
  }

  private async releaseRedisStock(
    reservation: ReservationExpiryRow
  ): Promise<RedisStockReleaseResult> {
    const result = await this.redis.eval(
      releaseExpiredReservationStockScript,
      3,
      reservationKey(reservation.id),
      stockCounterKey(reservation.product_id),
      reservationReleaseMarkerKey(reservation.id),
      reservation.quantity,
      this.releaseMarkerTtlMs
    );

    const [releaseCode, availableStock] = parseRedisReleaseResult(result);

    if (releaseCode === -1) {
      throw new Error("Redis stock counter is unavailable for expiry release.");
    }

    return {
      status: releaseCode === 1 ? "released" : "already_released",
      availableStock: availableStock >= 0 ? availableStock : null
    };
  }

  private publishExpiryStockUpdate(
    reservation: ReservationExpiryRow,
    redisRelease: RedisStockReleaseResult
  ) {
    if (
      redisRelease.status !== "released" ||
      redisRelease.availableStock === null
    ) {
      return;
    }

    this.realtimeStockPublisher.publishStockUpdated({
      productId: reservation.product_id,
      availableStock: redisRelease.availableStock,
      source: "reservation_expired",
      reservationId: reservation.id
    });
  }
}

function parseRedisReleaseResult(result: unknown): [number, number] {
  if (!Array.isArray(result)) {
    return [Number(result), -1];
  }

  return [Number(result[0]), Number(result[1])];
}

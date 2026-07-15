import {
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  ServiceUnavailableException,
  UnprocessableEntityException
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Queue } from "bullmq";
import Redis from "ioredis";
import { DatabaseService } from "../database/database.service";
import { buildRedisConnectionOptions } from "../redis/redis-connection";
import { CreateReservationCommand } from "./create-reservation.dto";
import {
  expireReservationJobName,
  reservationExpiryQueueName,
  reservationKey,
  stockCounterKey
} from "./reservation-keys";

interface ProductDropRow {
  id: string;
  status: string;
  drop_starts_at: Date | null;
  drop_ends_at: Date | null;
}

interface ReservationRow {
  id: string;
  user_id: string;
  product_id: string;
  quantity: number;
  status: string;
  checkout_expires_at: Date;
}

const reserveStockScript = `
local stock = redis.call("GET", KEYS[1])
if not stock then
  return -1
end
local requested = tonumber(ARGV[1])
if tonumber(stock) < requested then
  return -2
end
return redis.call("DECRBY", KEYS[1], requested)
`;

@Injectable()
export class ReservationsService implements OnModuleDestroy {
  private readonly redis: Redis;
  private readonly expiryQueue: Queue;
  private readonly checkoutWindowMs: number;

  constructor(
    private readonly database: DatabaseService,
    config: ConfigService
  ) {
    const redisUrl = config.get<string>("REDIS_URL") ?? "redis://localhost:6379";

    this.redis = new Redis(redisUrl, {
      maxRetriesPerRequest: null
    });
    this.expiryQueue = new Queue(reservationExpiryQueueName, {
      connection: buildRedisConnectionOptions(redisUrl)
    });
    this.checkoutWindowMs = Number(
      config.get<string>("RESERVATION_CHECKOUT_WINDOW_MS") ?? 5 * 60 * 1000
    );
  }

  async create(command: CreateReservationCommand) {
    const product = await this.loadReservableProduct(command.productId);
    assertDropIsOpen(product);

    const stockKey = stockCounterKey(command.productId);
    const remainingStock = await this.reserveStock(stockKey, command.quantity);

    const expiresAt = new Date(Date.now() + this.checkoutWindowMs);

    let reservation: ReservationRow;

    try {
      reservation = await this.createDurableReservation(command, expiresAt);
    } catch (error) {
      await this.releaseStock(stockKey, command.quantity);

      if (isUniquePendingReservationError(error)) {
        throw new ConflictException(
          "User already has a pending reservation for this product."
        );
      }

      throw error;
    }

    try {
      await this.storeReservationMetadata(reservation);
      await this.enqueueExpiry(reservation);
    } catch {
      await this.cancelDurableReservation(reservation);
      await this.redis.del(reservationKey(reservation.id));
      await this.releaseStock(stockKey, command.quantity);
      throw new ServiceUnavailableException(
        "Reservation expiry scheduling is unavailable."
      );
    }

    return {
      reservationId: reservation.id,
      productId: reservation.product_id,
      userId: reservation.user_id,
      quantity: reservation.quantity,
      status: reservation.status,
      checkoutExpiresAt: reservation.checkout_expires_at.toISOString(),
      remainingStock
    };
  }

  async onModuleDestroy() {
    await this.expiryQueue.close();
    this.redis.disconnect();
  }

  private async loadReservableProduct(productId: string) {
    const result = await this.database.query<ProductDropRow>(
      `
        SELECT id, status, drop_starts_at, drop_ends_at
        FROM products
        WHERE id = $1
      `,
      [productId]
    );

    const product = result.rows[0];

    if (!product) {
      throw new NotFoundException("Product was not found.");
    }

    return product;
  }

  private async reserveStock(stockKey: string, quantity: number) {
    let result: unknown;

    try {
      result = await this.redis.eval(reserveStockScript, 1, stockKey, quantity);
    } catch {
      throw new ServiceUnavailableException(
        "Reservation stock counter is unavailable."
      );
    }

    const remainingStock = Number(result);

    if (remainingStock === -1) {
      throw new ServiceUnavailableException(
        "Reservation stock counter has not been warmed."
      );
    }

    if (remainingStock === -2) {
      throw new ConflictException("Not enough stock is available.");
    }

    return remainingStock;
  }

  private async createDurableReservation(
    command: CreateReservationCommand,
    expiresAt: Date
  ) {
    return this.database.transaction(async (client) => {
      const inventoryResult = await client.query(
        `
          UPDATE inventory
          SET reserved_quantity = reserved_quantity + $2,
              version = version + 1,
              last_reconciled_at = NOW()
          WHERE product_id = $1
            AND total_quantity >= reserved_quantity + sold_quantity + $2
        `,
        [command.productId, command.quantity]
      );

      if (inventoryResult.rowCount !== 1) {
        throw new ConflictException("Not enough durable inventory is available.");
      }

      const result = await client.query<ReservationRow>(
        `
          INSERT INTO reservations (
            user_id,
            product_id,
            quantity,
            status,
            checkout_expires_at
          )
          VALUES ($1, $2, $3, 'pending', $4)
          RETURNING
            id,
            user_id,
            product_id,
            quantity,
            status,
            checkout_expires_at
        `,
        [command.userId, command.productId, command.quantity, expiresAt]
      );

      return result.rows[0];
    });
  }

  private async cancelDurableReservation(reservation: ReservationRow) {
    await this.database.transaction(async (client) => {
      await client.query(
        `
          UPDATE reservations
          SET status = 'cancelled',
              cancelled_at = NOW()
          WHERE id = $1
            AND status = 'pending'
        `,
        [reservation.id]
      );

      await client.query(
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
    });
  }

  private async storeReservationMetadata(reservation: ReservationRow) {
    const ttlMs = Math.max(
      reservation.checkout_expires_at.getTime() - Date.now(),
      1000
    );

    await this.redis
      .multi()
      .hset(reservationKey(reservation.id), {
        productId: reservation.product_id,
        userId: reservation.user_id,
        quantity: String(reservation.quantity),
        expiresAt: reservation.checkout_expires_at.toISOString()
      })
      .pexpire(reservationKey(reservation.id), ttlMs)
      .exec();
  }

  private async enqueueExpiry(reservation: ReservationRow) {
    const delay = Math.max(
      reservation.checkout_expires_at.getTime() - Date.now(),
      0
    );

    await this.expiryQueue.add(
      expireReservationJobName,
      { reservationId: reservation.id },
      {
        delay,
        jobId: reservation.id,
        removeOnComplete: true,
        removeOnFail: 100
      }
    );
  }

  private async releaseStock(stockKey: string, quantity: number) {
    try {
      await this.redis.incrby(stockKey, quantity);
    } catch {
      throw new ServiceUnavailableException(
        "Reservation failed and Redis stock could not be restored."
      );
    }
  }
}

function assertDropIsOpen(product: ProductDropRow) {
  const now = Date.now();

  if (product.status !== "live") {
    throw new UnprocessableEntityException("Product drop is not live.");
  }

  if (product.drop_starts_at && product.drop_starts_at.getTime() > now) {
    throw new UnprocessableEntityException("Product drop has not started.");
  }

  if (product.drop_ends_at && product.drop_ends_at.getTime() <= now) {
    throw new UnprocessableEntityException("Product drop has ended.");
  }
}

function isUniquePendingReservationError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}

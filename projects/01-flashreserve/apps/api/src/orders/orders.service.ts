import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException
} from "@nestjs/common";
import { PoolClient } from "pg";
import { DatabaseService } from "../database/database.service";
import { ConfirmOrderCommand } from "./confirm-order.dto";

interface ReservationForConfirmationRow {
  id: string;
  user_id: string;
  product_id: string;
  quantity: number;
  status: string;
  checkout_expires_at: Date;
  unit_price_cents: number;
  currency_code: string;
}

interface ConfirmedOrderRow {
  id: string;
  order_number: string;
  reservation_id: string;
  user_id: string;
  status: string;
  subtotal_amount_cents: number;
  currency_code: string;
  confirmed_at: Date;
  product_id: string;
  quantity: number;
  unit_price_cents: number;
}

@Injectable()
export class OrdersService {
  constructor(private readonly database: DatabaseService) {}

  async confirm(command: ConfirmOrderCommand) {
    const order = await this.database.transaction(async (client) => {
      const reservation = await this.loadReservationForUpdate(
        client,
        command.reservationId
      );

      if (!reservation) {
        throw new NotFoundException("Reservation was not found.");
      }

      if (reservation.user_id !== command.userId) {
        throw new ForbiddenException("Reservation belongs to a different user.");
      }

      if (reservation.status === "confirmed") {
        const existingOrder = await this.loadConfirmedOrder(
          client,
          reservation.id
        );

        if (!existingOrder) {
          throw new ServiceUnavailableException(
            "Confirmed reservation is missing its order."
          );
        }

        return existingOrder;
      }

      if (reservation.status !== "pending") {
        throw new ConflictException(
          `Reservation cannot be confirmed from ${reservation.status} status.`
        );
      }

      if (reservation.checkout_expires_at.getTime() <= Date.now()) {
        throw new ConflictException("Reservation has expired.");
      }

      await this.markReservationConfirmed(client, reservation.id);
      await this.moveInventoryToSold(client, reservation);
      await this.createConfirmedOrder(client, reservation);

      const confirmedOrder = await this.loadConfirmedOrder(
        client,
        reservation.id
      );

      if (!confirmedOrder) {
        throw new ServiceUnavailableException("Confirmed order was not saved.");
      }

      return confirmedOrder;
    });

    return formatConfirmedOrder(order);
  }

  private async loadReservationForUpdate(
    client: PoolClient,
    reservationId: string
  ) {
    const result = await client.query<ReservationForConfirmationRow>(
      `
        SELECT
          r.id,
          r.user_id,
          r.product_id,
          r.quantity,
          r.status,
          r.checkout_expires_at,
          p.unit_price_cents,
          p.currency_code
        FROM reservations r
        JOIN products p ON p.id = r.product_id
        WHERE r.id = $1
        FOR UPDATE OF r
      `,
      [reservationId]
    );

    return result.rows[0] ?? null;
  }

  private async loadConfirmedOrder(client: PoolClient, reservationId: string) {
    const result = await client.query<ConfirmedOrderRow>(
      `
        SELECT
          o.id,
          o.order_number::text,
          o.reservation_id,
          o.user_id,
          o.status,
          o.subtotal_amount_cents,
          o.currency_code,
          o.confirmed_at,
          oi.product_id,
          oi.quantity,
          oi.unit_price_cents
        FROM orders o
        JOIN order_items oi ON oi.order_id = o.id
        WHERE o.reservation_id = $1
      `,
      [reservationId]
    );

    return result.rows[0] ?? null;
  }

  private async markReservationConfirmed(
    client: PoolClient,
    reservationId: string
  ) {
    const result = await client.query(
      `
        UPDATE reservations
        SET status = 'confirmed',
            confirmed_at = COALESCE(confirmed_at, NOW())
        WHERE id = $1
          AND status = 'pending'
      `,
      [reservationId]
    );

    if (result.rowCount !== 1) {
      throw new ConflictException("Reservation could not be confirmed.");
    }
  }

  private async moveInventoryToSold(
    client: PoolClient,
    reservation: ReservationForConfirmationRow
  ) {
    const result = await client.query(
      `
        UPDATE inventory
        SET reserved_quantity = reserved_quantity - $2,
            sold_quantity = sold_quantity + $2,
            version = version + 1,
            last_reconciled_at = NOW()
        WHERE product_id = $1
          AND reserved_quantity >= $2
      `,
      [reservation.product_id, reservation.quantity]
    );

    if (result.rowCount !== 1) {
      throw new ConflictException("Reserved inventory could not be sold.");
    }
  }

  private async createConfirmedOrder(
    client: PoolClient,
    reservation: ReservationForConfirmationRow
  ) {
    const subtotalAmountCents =
      reservation.quantity * reservation.unit_price_cents;

    const orderResult = await client.query<{ id: string }>(
      `
        INSERT INTO orders (
          reservation_id,
          user_id,
          status,
          subtotal_amount_cents,
          currency_code,
          confirmed_at
        )
        VALUES ($1, $2, 'confirmed', $3, $4, NOW())
        RETURNING id
      `,
      [
        reservation.id,
        reservation.user_id,
        subtotalAmountCents,
        reservation.currency_code
      ]
    );

    await client.query(
      `
        INSERT INTO order_items (
          order_id,
          product_id,
          quantity,
          unit_price_cents
        )
        VALUES ($1, $2, $3, $4)
      `,
      [
        orderResult.rows[0].id,
        reservation.product_id,
        reservation.quantity,
        reservation.unit_price_cents
      ]
    );
  }
}

function formatConfirmedOrder(order: ConfirmedOrderRow) {
  return {
    orderId: order.id,
    orderNumber: order.order_number,
    reservationId: order.reservation_id,
    userId: order.user_id,
    status: order.status,
    subtotalAmountCents: order.subtotal_amount_cents,
    currencyCode: order.currency_code,
    confirmedAt: order.confirmed_at.toISOString(),
    items: [
      {
        productId: order.product_id,
        quantity: order.quantity,
        unitPriceCents: order.unit_price_cents
      }
    ]
  };
}

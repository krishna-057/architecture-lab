import { Injectable, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";

interface ProductInventoryRow {
  product_id: string;
  slug: string;
  name: string;
  status: string;
  unit_price_cents: number;
  currency_code: string;
  drop_starts_at: Date | null;
  drop_ends_at: Date | null;
  total_quantity: number | null;
  reserved_quantity: number | null;
  sold_quantity: number | null;
  version: number | null;
  last_reconciled_at: Date | null;
  inventory_updated_at: Date | null;
}

interface ReservationCountRow {
  total_count: number;
  pending_count: number;
  confirmed_count: number;
  expired_count: number;
  cancelled_count: number;
}

interface RecentReservationRow {
  id: string;
  user_id: string;
  quantity: number;
  status: string;
  checkout_expires_at: Date;
  created_at: Date;
  confirmed_at: Date | null;
  expired_at: Date | null;
  cancelled_at: Date | null;
}

@Injectable()
export class InventoryService {
  constructor(private readonly database: DatabaseService) {}

  async getProductInventory(productId: string) {
    const product = await this.loadProductInventory(productId);

    if (!product) {
      throw new NotFoundException("Product was not found.");
    }

    const [reservationCounts, recentReservations] = await Promise.all([
      this.loadReservationCounts(productId),
      this.loadRecentReservations(productId)
    ]);

    return {
      product: {
        id: product.product_id,
        slug: product.slug,
        name: product.name,
        status: product.status,
        unitPriceCents: product.unit_price_cents,
        currencyCode: product.currency_code,
        dropStartsAt: product.drop_starts_at?.toISOString() ?? null,
        dropEndsAt: product.drop_ends_at?.toISOString() ?? null
      },
      inventory: formatInventory(product),
      reservations: {
        counts: {
          total: reservationCounts.total_count,
          pending: reservationCounts.pending_count,
          confirmed: reservationCounts.confirmed_count,
          expired: reservationCounts.expired_count,
          cancelled: reservationCounts.cancelled_count
        },
        recent: recentReservations.map(formatRecentReservation)
      }
    };
  }

  private async loadProductInventory(productId: string) {
    const result = await this.database.query<ProductInventoryRow>(
      `
        SELECT
          p.id AS product_id,
          p.slug,
          p.name,
          p.status,
          p.unit_price_cents,
          p.currency_code,
          p.drop_starts_at,
          p.drop_ends_at,
          i.total_quantity,
          i.reserved_quantity,
          i.sold_quantity,
          i.version,
          i.last_reconciled_at,
          i.updated_at AS inventory_updated_at
        FROM products p
        LEFT JOIN inventory i ON i.product_id = p.id
        WHERE p.id = $1
      `,
      [productId]
    );

    return result.rows[0] ?? null;
  }

  private async loadReservationCounts(productId: string) {
    const result = await this.database.query<ReservationCountRow>(
      `
        SELECT
          COUNT(*)::int AS total_count,
          (COUNT(*) FILTER (WHERE status = 'pending'))::int AS pending_count,
          (COUNT(*) FILTER (WHERE status = 'confirmed'))::int AS confirmed_count,
          (COUNT(*) FILTER (WHERE status = 'expired'))::int AS expired_count,
          (COUNT(*) FILTER (WHERE status = 'cancelled'))::int AS cancelled_count
        FROM reservations
        WHERE product_id = $1
      `,
      [productId]
    );

    return result.rows[0];
  }

  private async loadRecentReservations(productId: string) {
    const result = await this.database.query<RecentReservationRow>(
      `
        SELECT
          id,
          user_id,
          quantity,
          status,
          checkout_expires_at,
          created_at,
          confirmed_at,
          expired_at,
          cancelled_at
        FROM reservations
        WHERE product_id = $1
        ORDER BY created_at DESC
        LIMIT 10
      `,
      [productId]
    );

    return result.rows;
  }
}

function formatInventory(product: ProductInventoryRow) {
  if (product.total_quantity === null) {
    return null;
  }

  const reservedQuantity = product.reserved_quantity ?? 0;
  const soldQuantity = product.sold_quantity ?? 0;

  return {
    totalQuantity: product.total_quantity,
    reservedQuantity,
    soldQuantity,
    availableQuantity: product.total_quantity - reservedQuantity - soldQuantity,
    version: product.version ?? 0,
    lastReconciledAt: product.last_reconciled_at?.toISOString() ?? null,
    updatedAt: product.inventory_updated_at?.toISOString() ?? null
  };
}

function formatRecentReservation(reservation: RecentReservationRow) {
  return {
    id: reservation.id,
    userId: reservation.user_id,
    quantity: reservation.quantity,
    status: reservation.status,
    checkoutExpiresAt: reservation.checkout_expires_at.toISOString(),
    createdAt: reservation.created_at.toISOString(),
    confirmedAt: reservation.confirmed_at?.toISOString() ?? null,
    expiredAt: reservation.expired_at?.toISOString() ?? null,
    cancelledAt: reservation.cancelled_at?.toISOString() ?? null
  };
}

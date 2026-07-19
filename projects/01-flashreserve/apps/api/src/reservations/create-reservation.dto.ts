export interface CreateReservationRequest {
  userId?: unknown;
  productId?: unknown;
  quantity?: unknown;
}

export interface CreateReservationCommand {
  userId: string;
  productId: string;
  quantity: number;
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseCreateReservationRequest(
  body: CreateReservationRequest
): CreateReservationCommand {
  if (!body || typeof body !== "object") {
    throw new Error("Request body is required.");
  }

  if (typeof body.userId !== "string" || !uuidPattern.test(body.userId)) {
    throw new Error("userId must be a UUID.");
  }

  if (typeof body.productId !== "string" || !uuidPattern.test(body.productId)) {
    throw new Error("productId must be a UUID.");
  }

  const quantity = body.quantity === undefined ? 1 : body.quantity;

  if (!Number.isInteger(quantity) || Number(quantity) < 1) {
    throw new Error("quantity must be a positive integer.");
  }

  return {
    userId: body.userId,
    productId: body.productId,
    quantity: Number(quantity)
  };
}

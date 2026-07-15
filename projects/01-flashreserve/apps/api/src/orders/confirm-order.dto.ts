export interface ConfirmOrderRequest {
  userId?: unknown;
  reservationId?: unknown;
}

export interface ConfirmOrderCommand {
  userId: string;
  reservationId: string;
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseConfirmOrderRequest(
  body: ConfirmOrderRequest
): ConfirmOrderCommand {
  if (!body || typeof body !== "object") {
    throw new Error("Request body is required.");
  }

  if (typeof body.userId !== "string" || !uuidPattern.test(body.userId)) {
    throw new Error("userId must be a UUID.");
  }

  if (
    typeof body.reservationId !== "string" ||
    !uuidPattern.test(body.reservationId)
  ) {
    throw new Error("reservationId must be a UUID.");
  }

  return {
    userId: body.userId,
    reservationId: body.reservationId
  };
}

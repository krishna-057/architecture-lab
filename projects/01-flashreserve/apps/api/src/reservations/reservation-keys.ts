export const reservationExpiryQueueName = "reservation-expiry";
export const expireReservationJobName = "expire-reservation";

export function stockCounterKey(productId: string) {
  return `flashreserve:stock:${productId}`;
}

export function reservationKey(reservationId: string) {
  return `flashreserve:reservation:${reservationId}`;
}

export function reservationReleaseMarkerKey(reservationId: string) {
  return `flashreserve:reservation-release:${reservationId}`;
}

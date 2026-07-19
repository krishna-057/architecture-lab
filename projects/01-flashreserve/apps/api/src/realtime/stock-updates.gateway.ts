import { ConnectedSocket, MessageBody, SubscribeMessage, WebSocketGateway, WebSocketServer } from "@nestjs/websockets";
import { Server, Socket } from "socket.io";

export interface StockUpdatedEvent {
  productId: string;
  availableStock: number;
  source: "reservation_created" | "reservation_expired";
  occurredAt: string;
  reservationId?: string;
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@WebSocketGateway({
  namespace: "/stock",
  cors: {
    origin: true
  }
})
export class StockUpdatesGateway {
  @WebSocketServer()
  private server?: Server;

  @SubscribeMessage("stock.subscribe")
  async subscribeToProduct(
    @MessageBody() body: unknown,
    @ConnectedSocket() client: Socket
  ) {
    const productId = parseProductId(body);

    if (!productId) {
      client.emit("stock.error", {
        message: "A valid productId is required."
      });
      return;
    }

    await client.join(productStockRoom(productId));
    client.emit("stock.subscribed", { productId });
  }

  @SubscribeMessage("stock.unsubscribe")
  async unsubscribeFromProduct(
    @MessageBody() body: unknown,
    @ConnectedSocket() client: Socket
  ) {
    const productId = parseProductId(body);

    if (!productId) {
      client.emit("stock.error", {
        message: "A valid productId is required."
      });
      return;
    }

    await client.leave(productStockRoom(productId));
    client.emit("stock.unsubscribed", { productId });
  }

  emitStockUpdated(event: StockUpdatedEvent) {
    this.server
      ?.to(productStockRoom(event.productId))
      .emit("stock.updated", event);
  }
}

function parseProductId(body: unknown) {
  if (
    typeof body === "object" &&
    body !== null &&
    "productId" in body &&
    typeof body.productId === "string" &&
    uuidPattern.test(body.productId)
  ) {
    return body.productId;
  }

  return null;
}

function productStockRoom(productId: string) {
  return `product:${productId}`;
}

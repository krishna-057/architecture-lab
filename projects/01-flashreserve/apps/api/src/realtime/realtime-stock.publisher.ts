import { Injectable } from "@nestjs/common";
import {
  StockUpdatedEvent,
  StockUpdatesGateway
} from "./stock-updates.gateway";

type StockUpdateInput = Omit<StockUpdatedEvent, "occurredAt">;

@Injectable()
export class RealtimeStockPublisher {
  constructor(private readonly stockUpdatesGateway: StockUpdatesGateway) {}

  publishStockUpdated(input: StockUpdateInput) {
    this.stockUpdatesGateway.emitStockUpdated({
      ...input,
      occurredAt: new Date().toISOString()
    });
  }
}

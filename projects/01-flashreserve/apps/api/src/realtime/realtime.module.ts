import { Module } from "@nestjs/common";
import { RealtimeStockPublisher } from "./realtime-stock.publisher";
import { StockUpdatesGateway } from "./stock-updates.gateway";

@Module({
  providers: [RealtimeStockPublisher, StockUpdatesGateway],
  exports: [RealtimeStockPublisher]
})
export class RealtimeModule {}

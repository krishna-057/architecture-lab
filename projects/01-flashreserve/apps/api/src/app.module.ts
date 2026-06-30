import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { HealthController } from "./health.controller";
import { InventoryModule } from "./inventory/inventory.module";
import { OrdersModule } from "./orders/orders.module";
import { ProductsModule } from "./products/products.module";
import { RealtimeModule } from "./realtime/realtime.module";
import { ReservationsModule } from "./reservations/reservations.module";
import { WorkersModule } from "./workers/workers.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ProductsModule,
    InventoryModule,
    ReservationsModule,
    OrdersModule,
    RealtimeModule,
    WorkersModule
  ],
  controllers: [HealthController]
})
export class AppModule {}

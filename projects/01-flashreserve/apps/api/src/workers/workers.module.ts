import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { RealtimeModule } from "../realtime/realtime.module";
import { ReservationExpiryWorker } from "./reservation-expiry.worker";

@Module({
  imports: [DatabaseModule, RealtimeModule],
  providers: [ReservationExpiryWorker]
})
export class WorkersModule {}

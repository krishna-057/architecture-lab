import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { ReservationExpiryWorker } from "./reservation-expiry.worker";

@Module({
  imports: [DatabaseModule],
  providers: [ReservationExpiryWorker]
})
export class WorkersModule {}

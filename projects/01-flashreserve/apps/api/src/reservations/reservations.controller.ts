import { BadRequestException, Body, Controller, Post } from "@nestjs/common";
import {
  CreateReservationRequest,
  parseCreateReservationRequest
} from "./create-reservation.dto";
import { ReservationsService } from "./reservations.service";

@Controller("reservations")
export class ReservationsController {
  constructor(private readonly reservationsService: ReservationsService) {}

  @Post()
  async create(@Body() body: CreateReservationRequest) {
    let command;

    try {
      command = parseCreateReservationRequest(body);
    } catch (error) {
      if (error instanceof Error) {
        throw new BadRequestException(error.message);
      }

      throw error;
    }

    return this.reservationsService.create(command);
  }
}

import { BadRequestException, Body, Controller, Post } from "@nestjs/common";
import {
  ConfirmOrderRequest,
  parseConfirmOrderRequest
} from "./confirm-order.dto";
import { OrdersService } from "./orders.service";

@Controller("orders")
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post("confirm")
  async confirm(@Body() body: ConfirmOrderRequest) {
    let command;

    try {
      command = parseConfirmOrderRequest(body);
    } catch (error) {
      if (error instanceof Error) {
        throw new BadRequestException(error.message);
      }

      throw error;
    }

    return this.ordersService.confirm(command);
  }
}

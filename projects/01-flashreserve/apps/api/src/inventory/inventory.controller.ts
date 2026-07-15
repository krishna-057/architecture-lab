import { BadRequestException, Controller, Get, Param } from "@nestjs/common";
import { InventoryService } from "./inventory.service";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Controller("admin/products/:productId/inventory")
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get()
  async getProductInventory(@Param("productId") productId: string) {
    if (!uuidPattern.test(productId)) {
      throw new BadRequestException("A valid productId is required.");
    }

    return this.inventoryService.getProductInventory(productId);
  }
}

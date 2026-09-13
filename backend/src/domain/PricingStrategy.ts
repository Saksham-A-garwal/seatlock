import { Seat } from "./Seat";

export interface PricingStrategy {
  priceFor(seat: Seat): number;
}

export class BaseFarePricing implements PricingStrategy {
  priceFor(seat: Seat): number {
    return seat.price;
  }
}

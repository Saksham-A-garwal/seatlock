import { describe, expect, it } from "vitest";
import { SeatStatus } from "@prisma/client";
import { BaseFarePricing } from "./PricingStrategy";
import { Seat } from "./Seat";

describe("BaseFarePricing", () => {
  it("prices a seat at its own base fare", () => {
    const seat = new Seat({
      id: 1,
      showId: 1,
      status: SeatStatus.AVAILABLE,
      heldById: null,
      holdExpiresAt: null,
      price: 350,
    });

    expect(new BaseFarePricing().priceFor(seat)).toBe(350);
  });
});

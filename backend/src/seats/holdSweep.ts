import { SeatRepository } from "./SeatRepository";

// FR-5: correctness never depends on this running (Seat.isAvailable already
// treats an expired HELD row as available). This just keeps the `status`
// column itself honest for anything reading it directly.
export function startHoldExpirySweep(seatRepository: SeatRepository, intervalSeconds: number): NodeJS.Timeout {
  return setInterval(() => {
    seatRepository.sweepExpiredHolds().catch((error: unknown) => {
      console.error("Hold-expiry sweep failed:", error);
    });
  }, intervalSeconds * 1000);
}

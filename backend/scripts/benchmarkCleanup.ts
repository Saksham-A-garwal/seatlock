// Phase 3 of the k6 concurrency benchmark: removes everything
// benchmarkSetup.ts created. Deletes by id range (the watermarks recorded
// in the fixture), not by collecting every user id into an IN(...) list --
// the same reason bulk creation used a watermark instead of reading back by
// an N-item email list. At 10k-30k rows, a range delete is one indexed scan;
// an IN-list that size is a query the size of the whole benchmark.
import fs from "fs";
import path from "path";
import { prisma } from "../src/db/prisma";

const FIXTURE_PATH = path.join(__dirname, "k6", "fixture.json");

async function main() {
  if (!fs.existsSync(FIXTURE_PATH)) {
    console.log("No fixture found at " + FIXTURE_PATH + " -- nothing to clean up.");
    return;
  }

  const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8")) as {
    runId: string;
    showId: number;
    userWatermarkBefore: number;
    userWatermarkAfter: number;
  };

  console.log(`Cleaning up benchmark run ${fixture.runId} (show ${fixture.showId})...`);

  // Seats must go before users: Seat.heldById can still point at a
  // benchmark user for whichever seat that user's request actually won.
  await prisma.bookingSeat.deleteMany({ where: { seat: { showId: fixture.showId } } });
  await prisma.booking.deleteMany({ where: { showId: fixture.showId } });
  await prisma.seat.deleteMany({ where: { showId: fixture.showId } });
  await prisma.show.delete({ where: { id: fixture.showId } });

  const deleted = await prisma.user.deleteMany({
    where: { id: { gt: fixture.userWatermarkBefore, lte: fixture.userWatermarkAfter } },
  });

  fs.unlinkSync(FIXTURE_PATH);
  console.log(`Cleanup complete: show deleted, ${deleted.count} benchmark users deleted.`);
}

main()
  .catch((err) => {
    console.error("CLEANUP FAILED:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

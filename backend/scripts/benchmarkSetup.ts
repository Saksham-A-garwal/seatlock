// Phase 1 of the k6 concurrency benchmark. k6 scripts run in their own
// sandboxed JS runtime -- no Node module resolution, no Prisma, no DB
// access -- so anything that needs the database has to happen here first,
// written out to a fixture k6 can read with plain JSON.parse(open(...)).
//
// Usage:
//   BENCHMARK_A_N=10000 BENCHMARK_B_N=10000 BENCHMARK_C_SEATS=100 BENCHMARK_C_RACERS=100 \
//     npx tsx scripts/benchmarkSetup.ts
import fs from "fs";
import path from "path";
import { Role } from "@prisma/client";
import { prisma } from "../src/db/prisma";
import { signAccessToken } from "../src/auth/tokens";

const RUN_ID = Date.now().toString(36);
const A_N = Number(process.env.BENCHMARK_A_N ?? 50);
const B_N = Number(process.env.BENCHMARK_B_N ?? 50);
const C_SEATS = Number(process.env.BENCHMARK_C_SEATS ?? 10);
const C_RACERS = Number(process.env.BENCHMARK_C_RACERS ?? 10);

const FIXTURE_PATH = path.join(__dirname, "k6", "fixture.json");

interface RacerToken {
  id: number;
  accessToken: string;
}

// Bulk-inserts N users in one statement, then reads them back by id
// watermark rather than by an N-item email IN(...) list -- the same
// technique used for cleanup below, and the only one of the two approaches
// that stays fast at 10k+ rows. No refresh tokens are minted: the benchmark
// only ever needs a valid access token to call the hold endpoint, and
// skipping RefreshToken rows entirely means N fewer writes and nothing
// extra to clean up afterward.
async function bulkCreateRacers(n: number, tag: string): Promise<RacerToken[]> {
  if (n === 0) return [];
  const watermark = (await prisma.user.aggregate({ _max: { id: true } }))._max.id ?? 0;

  await prisma.user.createMany({
    data: Array.from({ length: n }, (_, i) => ({
      email: `benchmark-${RUN_ID}-${tag}-${i}@example.com`,
      emailVerified: true,
      role: Role.USER,
    })),
  });

  const rows = await prisma.user.findMany({
    where: { id: { gt: watermark } },
    select: { id: true, role: true },
    orderBy: { id: "asc" },
  });
  return rows.map((u) => ({ id: u.id, accessToken: signAccessToken(u.id, u.role) }));
}

async function bulkCreateSeats(showId: number, rowLabel: string, n: number): Promise<number[]> {
  const watermark = (await prisma.seat.aggregate({ _max: { id: true } }))._max.id ?? 0;
  await prisma.seat.createMany({
    data: Array.from({ length: n }, (_, i) => ({ showId, rowLabel, seatNumber: i + 1, price: 250 })),
  });
  const rows = await prisma.seat.findMany({ where: { id: { gt: watermark } }, select: { id: true }, orderBy: { id: "asc" } });
  return rows.map((s) => s.id);
}

async function main() {
  console.log(`Benchmark setup (run ${RUN_ID}): A=${A_N} racers on 1 seat, B=${B_N} racers on ${B_N} seats, C=${C_SEATS} seats x ${C_RACERS} racers`);

  const userWatermarkBefore = (await prisma.user.aggregate({ _max: { id: true } }))._max.id ?? 0;

  const show = await prisma.show.create({
    data: { movieName: "Benchmark Show", venue: "Benchmark Venue", showtime: new Date(Date.now() + 24 * 60 * 60 * 1000), rows: 1, columns: 1 },
  });

  const [aSeatId] = await bulkCreateSeats(show.id, "A", 1);
  const aUsers = await bulkCreateRacers(A_N, "a");

  const bSeatIds = B_N > 0 ? await bulkCreateSeats(show.id, "B", B_N) : [];
  const bUsers = await bulkCreateRacers(B_N, "b");

  const cSeatIds = C_SEATS > 0 ? await bulkCreateSeats(show.id, "C", C_SEATS) : [];
  const cUsers = C_SEATS > 0 && C_RACERS > 0 ? await bulkCreateRacers(C_SEATS * C_RACERS, "c") : [];

  const userWatermarkAfter = (await prisma.user.aggregate({ _max: { id: true } }))._max.id ?? 0;

  const fixture = {
    runId: RUN_ID,
    showId: show.id,
    userWatermarkBefore,
    userWatermarkAfter,
    a: { seatId: aSeatId, users: aUsers },
    b: { seatIds: bSeatIds, users: bUsers },
    c: { seatIds: cSeatIds, racersPerSeat: C_RACERS, users: cUsers },
  };

  fs.mkdirSync(path.dirname(FIXTURE_PATH), { recursive: true });
  fs.writeFileSync(FIXTURE_PATH, JSON.stringify(fixture));

  const totalUsers = aUsers.length + bUsers.length + cUsers.length;
  const totalRequests = aUsers.length + bUsers.length + cUsers.length;
  console.log(`Fixture written: ${FIXTURE_PATH}`);
  console.log(`Total racers created: ${totalUsers} (will fire ${totalRequests} hold requests across A+B+C)`);
}

main()
  .catch((err) => {
    console.error("SETUP FAILED:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

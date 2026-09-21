// Phase 2 of the concurrency benchmark -- the actual load. Run once per
// scenario (set via --env SCENARIO=a|b|c); benchmarkSetup.ts must have
// already written fixture.json in this same directory.
//
//   k6 run scripts/k6/concurrencyLoad.js --env SCENARIO=a
//
// vus equals iterations for every scenario here on purpose: with k6's
// shared-iterations executor, vus === iterations means every virtual user
// gets exactly one iteration, so k6 starts all of them at once instead of
// cycling a smaller pool through a queue -- the same "genuinely concurrent,
// not just high-volume" requirement the Node/Promise.all version of this
// benchmark had, just handled by a runtime built for it instead of one
// process's fetch calls.
import http from "k6/http";
import { check } from "k6";
import { Counter } from "k6/metrics";
import exec from "k6/execution";

const fixture = JSON.parse(open("./fixture.json"));
const BASE_URL = __ENV.BENCHMARK_BASE_URL || "http://localhost:3000";
const SCENARIO = __ENV.SCENARIO;

const wins = new Counter("wins");
const conflicts = new Counter("conflicts");
const otherStatus = new Counter("other_status");

function pickCase() {
  if (SCENARIO === "a") {
    return { users: fixture.a.users, expectedWins: 1, seatFor: () => fixture.a.seatId };
  }
  if (SCENARIO === "b") {
    return { users: fixture.b.users, expectedWins: fixture.b.seatIds.length, seatFor: (i) => fixture.b.seatIds[i] };
  }
  if (SCENARIO === "c") {
    const racersPerSeat = fixture.c.racersPerSeat;
    return {
      users: fixture.c.users,
      expectedWins: fixture.c.seatIds.length,
      seatFor: (i) => fixture.c.seatIds[Math.floor(i / racersPerSeat)],
    };
  }
  throw new Error(`--env SCENARIO must be a, b, or c (got "${SCENARIO}")`);
}

const kase = pickCase();
const N = kase.users.length;

export const options = {
  scenarios: {
    load: {
      executor: "shared-iterations",
      vus: N,
      iterations: N,
      maxDuration: "10m",
    },
  },
  thresholds: {
    // The actual correctness claim, enforced by k6 itself: exactly the
    // right number of winners, not "most requests looked fine."
    wins: [`count==${kase.expectedWins}`],
  },
};

export default function () {
  const i = exec.scenario.iterationInTest;
  const user = kase.users[i];
  const seatId = kase.seatFor(i);

  const res = http.post(
    `${BASE_URL}/shows/${fixture.showId}/hold`,
    JSON.stringify({ seatIds: [seatId] }),
    { headers: { "Content-Type": "application/json", Authorization: `Bearer ${user.accessToken}` } }
  );

  if (res.status === 200) wins.add(1);
  else if (res.status === 409) conflicts.add(1);
  else otherStatus.add(1);

  check(res, { "status is 200 or 409": (r) => r.status === 200 || r.status === 409 });
}

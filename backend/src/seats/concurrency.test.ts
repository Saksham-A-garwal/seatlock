import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { SeatStatus, Show } from "@prisma/client";
import { createApp } from "../app";
import { FakeEmailSender } from "../auth/FakeEmailSender";
import { issueTokenPair } from "../auth/tokens";
import { prisma } from "../db/prisma";
import { cleanupShow, cleanupUsers, createTestSeat, createTestShow, createTestUser } from "./testHelpers";

// These tests fire genuinely concurrent HTTP requests via Promise.all (never
// sequential awaits) through the real Express route, so the thing actually
// being exercised is Postgres's row-level locking under SELECT ... FOR
// UPDATE, not a simulation of it.
describe("concurrent hold requests", () => {
  let show: Show | undefined;
  let userIds: number[] = [];

  afterEach(async () => {
    if (show) await cleanupShow(show.id);
    show = undefined;
    await cleanupUsers(userIds);
    userIds = [];
  });

  it(
    "exactly one of N simultaneous requests for the same seat succeeds",
    async () => {
      show = await createTestShow();
      const showId = show.id;
      const seat = await createTestSeat(showId);

      const N = 10;
      const users = await Promise.all(Array.from({ length: N }, () => createTestUser()));
      userIds = users.map((u) => u.id);
      const tokenPairs = await Promise.all(users.map((u) => issueTokenPair(u.id, u.role)));

      const app = createApp({ emailSender: new FakeEmailSender() });

      const responses = await Promise.all(
        tokenPairs.map(({ accessToken }) =>
          request(app)
            .post(`/shows/${showId}/hold`)
            .set("Authorization", `Bearer ${accessToken}`)
            .send({ seatIds: [seat.id] })
        )
      );

      const successIndexes = responses.map((r, i) => (r.status === 200 ? i : -1)).filter((i) => i !== -1);
      const conflictCount = responses.filter((r) => r.status === 409).length;

      expect(successIndexes).toHaveLength(1);
      expect(conflictCount).toBe(N - 1);

      const finalSeat = await prisma.seat.findUnique({ where: { id: seat.id } });
      expect(finalSeat?.status).toBe(SeatStatus.HELD);
      // The DB's recorded holder must be the exact user whose request got the 200.
      const winnerUserId = users[successIndexes[0]].id;
      expect(finalSeat?.heldById).toBe(winnerUserId);
    },
    20_000
  );

  it(
    "does not deadlock when two requests hold overlapping seats in reverse order",
    async () => {
      show = await createTestShow();
      const showId = show.id;
      const seatA = await createTestSeat(showId, { seatNumber: 1 });
      const seatB = await createTestSeat(showId, { seatNumber: 2 });

      const [userA, userB] = await Promise.all([createTestUser(), createTestUser()]);
      userIds = [userA.id, userB.id];
      const [tokensA, tokensB] = await Promise.all([
        issueTokenPair(userA.id, userA.role),
        issueTokenPair(userB.id, userB.role),
      ]);

      const app = createApp({ emailSender: new FakeEmailSender() });

      // A requests [seatA, seatB]; B requests the same two seats in reverse
      // order, at the same time. Without a consistent lock-acquisition
      // order this is the textbook cross-wait deadlock shape.
      const [resA, resB] = await Promise.all([
        request(app)
          .post(`/shows/${showId}/hold`)
          .set("Authorization", `Bearer ${tokensA.accessToken}`)
          .send({ seatIds: [seatA.id, seatB.id] }),
        request(app)
          .post(`/shows/${showId}/hold`)
          .set("Authorization", `Bearer ${tokensB.accessToken}`)
          .send({ seatIds: [seatB.id, seatA.id] }),
      ]);

      // Neither request may come back as an unhandled 500 (a raw Postgres
      // "deadlock detected" error) -- exactly one clean win, one clean 409.
      const statuses = [resA.status, resB.status].sort();
      expect(statuses).toEqual([200, 409]);
    },
    20_000
  );
});

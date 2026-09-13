import { Show } from "@prisma/client";
import { prisma } from "../db/prisma";
import { config } from "../config";
import { isRetryableDbError } from "../resilience/isRetryableDbError";
import { withRetry } from "../resilience/withRetry";
import { InvalidShowInputError } from "./errors";

const MAX_ROWS = 26; // letter-labeled rows (A-Z) -- realistic for a cinema
const MAX_COLUMNS = 50;

export interface CreateShowInput {
  movieName: string;
  venue: string;
  showtime: Date;
  rows: number;
  columns: number;
  basePrice: number;
  posterUrl?: string | null;
}

function rowLabelFor(rowIndex: number): string {
  return String.fromCharCode("A".charCodeAt(0) + rowIndex);
}

function validate(input: CreateShowInput, now: Date): void {
  if (!input.movieName.trim()) {
    throw new InvalidShowInputError("movieName is required");
  }
  if (!input.venue.trim()) {
    throw new InvalidShowInputError("venue is required");
  }
  if (Number.isNaN(input.showtime.getTime()) || input.showtime.getTime() <= now.getTime()) {
    throw new InvalidShowInputError("showtime must be a valid date in the future");
  }
  if (!Number.isInteger(input.rows) || input.rows < 1 || input.rows > MAX_ROWS) {
    throw new InvalidShowInputError(`rows must be an integer between 1 and ${MAX_ROWS}`);
  }
  if (!Number.isInteger(input.columns) || input.columns < 1 || input.columns > MAX_COLUMNS) {
    throw new InvalidShowInputError(`columns must be an integer between 1 and ${MAX_COLUMNS}`);
  }
  if (!Number.isFinite(input.basePrice) || input.basePrice <= 0) {
    throw new InvalidShowInputError("basePrice must be a positive number");
  }
  if (input.posterUrl && !/^https:\/\//.test(input.posterUrl)) {
    throw new InvalidShowInputError("posterUrl must be an https:// URL");
  }
}

export class ShowService {
  async createShow(input: CreateShowInput, now: Date = new Date()): Promise<{ show: Show; seatsCreated: number }> {
    validate(input, now);

    return withRetry(
      () =>
        prisma.$transaction(async (tx) => {
          const show = await tx.show.create({
            data: {
              movieName: input.movieName,
              venue: input.venue,
              showtime: input.showtime,
              rows: input.rows,
              columns: input.columns,
              posterUrl: input.posterUrl || null,
            },
          });

          const seatsData = [];
          for (let rowIndex = 0; rowIndex < input.rows; rowIndex++) {
            for (let seatNumber = 1; seatNumber <= input.columns; seatNumber++) {
              seatsData.push({
                showId: show.id,
                rowLabel: rowLabelFor(rowIndex),
                seatNumber,
                price: input.basePrice,
              });
            }
          }

          const { count } = await tx.seat.createMany({ data: seatsData });

          return { show, seatsCreated: count };
        }),
      { ...config.resilience, isRetryable: isRetryableDbError }
    );
  }
}

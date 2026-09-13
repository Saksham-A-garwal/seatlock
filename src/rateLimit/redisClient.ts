import { Redis } from "@upstash/redis";
import { config } from "../config";

export const redisClient = new Redis({
  url: config.upstash.restUrl,
  token: config.upstash.restToken,
});

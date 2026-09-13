import "dotenv/config";
import express from "express";
import { Pool } from "pg";

const app = express();
const port = process.env.PORT ?? 3000;

// Milestone 0 only: raw pg connection to prove DB connectivity before any
// models exist. Once Milestone 1 adds the schema, DB access moves to Prisma.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.status(200).json({ status: "ok", db: "connected" });
  } catch (error) {
    console.error("Health check DB query failed:", error);
    res.status(500).json({ status: "error", db: "unreachable" });
  }
});

app.listen(port, () => {
  console.log(`SeatLock API listening on port ${port}`);
});

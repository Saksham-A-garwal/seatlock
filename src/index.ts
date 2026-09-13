import { createApp } from "./app";
import { config } from "./config";
import { SeatRepository } from "./seats/SeatRepository";
import { startHoldExpirySweep } from "./seats/holdSweep";

const app = createApp();

app.listen(config.port, () => {
  console.log(`SeatLock API listening on port ${config.port}`);
});

startHoldExpirySweep(new SeatRepository(), config.holdSweepIntervalSeconds);

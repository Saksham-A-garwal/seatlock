import Razorpay from "razorpay";
import { config } from "../config";

export const razorpayClient = new Razorpay({
  key_id: config.razorpay.keyId,
  key_secret: config.razorpay.keySecret,
});

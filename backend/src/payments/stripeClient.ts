import Stripe from "stripe";
import { config } from "../config";

export const stripeClient = new Stripe(config.stripeSecretKey);

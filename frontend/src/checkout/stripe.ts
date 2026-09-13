import { loadStripe } from "@stripe/stripe-js";

// Loaded once, outside any component, per Stripe's recommended pattern --
// recreating this on every render would reinitialize Stripe.js repeatedly.
export const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string);

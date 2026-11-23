// Settings come from Cloudflare Pages > Settings > Variables and secrets.
// Nothing secret is stored in this repository.
export interface Env {
  DB: D1Database;
  ADMIN_PASSWORD: string;

  // Stripe (cards, Apple Pay, Google Pay)
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;

  // PayPal
  PAYPAL_CLIENT_ID?: string;
  PAYPAL_SECRET?: string;
  PAYPAL_MODE?: string; // "live" or "sandbox" (default sandbox)

  // Resend (receipts and download links)
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string; // e.g. "Aidem Media <orders@aidemmedia.com.au>"
  EMAIL_REPLY_TO?: string;

  // "on" shows a Test payment button that marks orders paid without charging.
  // Only for trying the system before Stripe and PayPal are set up.
  TEST_PAYMENTS?: string;
}

export type Ctx = EventContext<Env, string, Record<string, unknown>>;

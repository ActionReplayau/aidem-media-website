import type { Env } from './env';
import { hmacHex, safeEqual } from './util';

async function stripe(env: Env, method: string, path: string, params?: Record<string, string>) {
  if (!env.STRIPE_SECRET_KEY) throw new Error('Stripe is not set up');
  const res = await fetch('https://api.stripe.com/v1/' + path, {
    method,
    headers: {
      authorization: 'Bearer ' + env.STRIPE_SECRET_KEY,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: params ? new URLSearchParams(params).toString() : undefined,
  });
  const data: any = await res.json();
  if (!res.ok) throw new Error('Stripe: ' + (data?.error?.message || res.status));
  return data;
}

export async function createCheckout(env: Env, o: {
  orderId: string; token: string; email: string; description: string; total: number; origin: string; concertId: number;
}) {
  // Stripe Checkout is Stripe's own payment page. It offers cards, Apple Pay and Google Pay automatically.
  return stripe(env, 'POST', 'checkout/sessions', {
    mode: 'payment',
    customer_email: o.email,
    client_reference_id: o.orderId,
    'metadata[order_id]': o.orderId,
    'payment_intent_data[metadata][order_id]': o.orderId,
    'payment_intent_data[description]': o.description,
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'aud',
    'line_items[0][price_data][unit_amount]': String(o.total),
    'line_items[0][price_data][product_data][name]': o.description,
    success_url: `${o.origin}/receipt.html?o=${o.orderId}&t=${o.token}`,
    cancel_url: `${o.origin}/?concert=${o.concertId}&cancelled=1`,
  });
}

export function getCheckout(env: Env, sessionId: string) {
  return stripe(env, 'GET', 'checkout/sessions/' + encodeURIComponent(sessionId));
}

export function refund(env: Env, paymentIntent: string, amount?: number) {
  const p: Record<string, string> = { payment_intent: paymentIntent };
  if (amount) p.amount = String(amount);
  return stripe(env, 'POST', 'refunds', p);
}

// Checks the Stripe-Signature header so nobody can fake a "paid" message.
export async function verifyWebhook(env: Env, body: string, header: string | null): Promise<boolean> {
  if (!env.STRIPE_WEBHOOK_SECRET || !header) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]).filter((p) => p[0] === 't'));
  const t = parts.t;
  const sigs = header.split(',').filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
  if (!t || !sigs.length) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > 600) return false;
  const expected = await hmacHex(env.STRIPE_WEBHOOK_SECRET, `${t}.${body}`);
  return sigs.some((s) => safeEqual(s, expected));
}

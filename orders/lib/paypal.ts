import type { Env } from './env';
import { business } from './business';

function base(env: Env) {
  return env.PAYPAL_MODE === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
}

async function token(env: Env): Promise<string> {
  if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_SECRET) throw new Error('PayPal is not set up');
  const res = await fetch(base(env) + '/v1/oauth2/token', {
    method: 'POST',
    headers: {
      authorization: 'Basic ' + btoa(env.PAYPAL_CLIENT_ID + ':' + env.PAYPAL_SECRET),
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const data: any = await res.json();
  if (!res.ok) throw new Error('PayPal sign-in failed: ' + (data?.error_description || res.status));
  return data.access_token;
}

async function call(env: Env, method: string, path: string, body?: unknown, idempotencyKey?: string) {
  const res = await fetch(base(env) + path, {
    method,
    headers: {
      authorization: 'Bearer ' + (await token(env)),
      'content-type': 'application/json',
      ...(idempotencyKey ? { 'PayPal-Request-Id': idempotencyKey } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error('PayPal: ' + (data?.details?.[0]?.description || data?.message || res.status));
  return data;
}

const dollars = (cents: number) => (cents / 100).toFixed(2);

export async function createOrder(env: Env, o: { orderId: string; description: string; total: number; origin: string; concertId: number }) {
  const data = await call(env, 'POST', '/v2/checkout/orders', {
    intent: 'CAPTURE',
    purchase_units: [{
      reference_id: o.orderId,
      custom_id: o.orderId,
      description: o.description.slice(0, 127),
      amount: { currency_code: 'AUD', value: dollars(o.total) },
    }],
    payment_source: {
      paypal: {
        experience_context: {
          brand_name: business.tradingName,
          shipping_preference: 'NO_SHIPPING',
          user_action: 'PAY_NOW',
          return_url: `${o.origin}/api/paypal/return`,
          cancel_url: `${o.origin}/?concert=${o.concertId}&cancelled=1`,
        },
      },
    },
  }, 'create-' + o.orderId);
  const link = (data.links || []).find((l: any) => l.rel === 'payer-action' || l.rel === 'approve');
  if (!link) throw new Error('PayPal did not return a payment link');
  return { id: data.id as string, url: link.href as string };
}

export async function captureOrder(env: Env, paypalOrderId: string) {
  const data = await call(env, 'POST', `/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`, {}, 'capture-' + paypalOrderId);
  const cap = data?.purchase_units?.[0]?.payments?.captures?.[0];
  return {
    completed: data.status === 'COMPLETED' && cap?.status === 'COMPLETED',
    captureId: cap?.id as string | undefined,
    amount: cap ? Math.round(Number(cap.amount.value) * 100) : 0,
    orderId: data?.purchase_units?.[0]?.reference_id as string | undefined,
  };
}

export async function getOrder(env: Env, paypalOrderId: string) {
  return call(env, 'GET', `/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}`);
}

export function refund(env: Env, captureId: string, amount?: number) {
  return call(env, 'POST', `/v2/payments/captures/${encodeURIComponent(captureId)}/refund`,
    amount ? { amount: { currency_code: 'AUD', value: dollars(amount) } } : {});
}

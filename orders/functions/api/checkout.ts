import type { Env } from '../../lib/env';
import { ensureSchema } from '../../lib/db';
import { quote, type OrderInput } from '../../lib/pricing';
import { description, markPaid } from '../../lib/orders';
import * as stripe from '../../lib/stripe';
import * as paypal from '../../lib/paypal';
import { fail, handle, json, randomId, readJson } from '../../lib/util';

// Saves the order as "pending", then sends the parent to Stripe or PayPal to pay.
export const onRequestPost: PagesFunction<Env> = (ctx) => handle(async () => {
  const { env, request } = ctx;
  await ensureSchema(env);
  const body = await readJson<OrderInput & { provider: string }>(request);
  const provider = body.provider;
  if (provider === 'stripe' && !env.STRIPE_SECRET_KEY) fail(400, 'Card payments are not set up yet.');
  if (provider === 'paypal' && !(env.PAYPAL_CLIENT_ID && env.PAYPAL_SECRET)) fail(400, 'PayPal is not set up yet.');
  if (provider === 'test' && env.TEST_PAYMENTS !== 'on') fail(400, 'Test payments are turned off.');
  if (!['stripe', 'paypal', 'test'].includes(provider)) fail(400, 'Choose a payment method.');

  const q = await quote(env, body, { strict: true });
  const c = q.concert;
  const id = randomId(12);
  const token = randomId(16);
  const nightsText = q.chosen.map((n) => n.label).join(', ');
  const origin = new URL(request.url).origin;

  await env.DB.batch([
    env.DB.prepare(`INSERT INTO orders (id, token, concert_id, email, student, class, format, phase, nights_text, qty, unit_price, subtotal, discount, discount_code, total, provider)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, token, c.id, q.email, q.student, q.klass, q.format, q.bulk ? 'bulk' : 'after', nightsText, q.qty, q.unit, q.subtotal, q.discount, q.discountCode, q.total, provider),
    ...q.chosen.map((n) => env.DB.prepare('INSERT INTO order_nights (order_id, night_id) VALUES (?, ?)').bind(id, n.id)),
  ]);

  const receipt = `/receipt.html?o=${id}&t=${token}`;

  // A 100% discount code: nothing to pay.
  if (q.total === 0) {
    await markPaid(env, id, { provider: 'free', paymentRef: null, amount: 0 }, origin, ctx.waitUntil.bind(ctx));
    return json({ redirect: receipt });
  }

  const desc = description({ format: q.format!, qty: q.qty, nights_text: nightsText }, c);

  if (provider === 'test') {
    return json({ redirect: `/api/test-pay?o=${id}&t=${token}` });
  }

  if (provider === 'stripe') {
    const s = await stripe.createCheckout(env, { orderId: id, token, email: q.email, description: desc, total: q.total, origin, concertId: c.id });
    await env.DB.prepare('UPDATE orders SET provider_ref = ? WHERE id = ?').bind(s.id, id).run();
    return json({ redirect: s.url });
  }

  const p = await paypal.createOrder(env, { orderId: id, description: desc, total: q.total, origin, concertId: c.id });
  await env.DB.prepare('UPDATE orders SET provider_ref = ? WHERE id = ?').bind(p.id, id).run();
  return json({ redirect: p.url });
});

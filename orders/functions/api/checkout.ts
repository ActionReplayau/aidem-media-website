import type { Env } from '../../lib/env';
import { ensureSchema } from '../../lib/db';
import { findDiscount, quote, type OrderInput } from '../../lib/pricing';
import { description, markPaid } from '../../lib/orders';
import * as stripe from '../../lib/stripe';
import * as paypal from '../../lib/paypal';
import { fail, handle, json, randomId, readJson } from '../../lib/util';

// Saves the order(s) as "pending", then sends the parent to Stripe or PayPal to pay.
// A parent can put several concerts in their cart and pay once. Each concert becomes its own
// order with its own tax invoice, and the orders share a group_id so they are marked paid together.
export const onRequestPost: PagesFunction<Env> = (ctx) => handle(async () => {
  const { env, request } = ctx;
  await ensureSchema(env);
  const body = await readJson<OrderInput & { provider: string; items?: OrderInput[] }>(request);
  const provider = body.provider;
  if (provider === 'stripe' && !env.STRIPE_SECRET_KEY) fail(400, 'Card payments are not set up yet.');
  if (provider === 'paypal' && !(env.PAYPAL_CLIENT_ID && env.PAYPAL_SECRET)) fail(400, 'PayPal is not set up yet.');
  if (provider === 'test' && env.TEST_PAYMENTS !== 'on') fail(400, 'Test payments are turned off.');
  if (!['stripe', 'paypal', 'test'].includes(provider)) fail(400, 'Choose a payment method.');

  const items = Array.isArray(body.items) && body.items.length ? body.items : [body];
  if (items.length > 5) fail(400, 'Please order up to 5 concerts at a time.');
  if (new Set(items.map((i) => Number(i.concertId))).size !== items.length) fail(400, 'The same concert is in your cart twice. Remove one and try again.');

  // Work out every order first, so nothing is saved if one of them has a problem.
  // A dollar-off discount code comes off once per checkout; a percent code comes off each concert it's valid for.
  let amountCodeUsed = false;
  const quotes = [];
  for (const item of items) {
    const q = await quote(env, { ...item, discount: amountCodeUsed ? '' : item.discount }, { strict: true });
    if (q.discountCode && (await findDiscount(env, q.discountCode, q.concert.id))?.kind === 'amount') amountCodeUsed = true;
    quotes.push(q);
  }

  const groupId = items.length > 1 ? randomId(12) : null;
  const orders = quotes.map((q) => ({ q, id: randomId(12), token: randomId(16), nightsText: q.chosen.map((n) => n.label).join(', ') }));
  const lead = orders[0];
  const total = quotes.reduce((sum, q) => sum + q.total, 0);
  const origin = new URL(request.url).origin;

  await env.DB.batch(orders.flatMap(({ q, id, token, nightsText }) => [
    env.DB.prepare(`INSERT INTO orders (id, token, concert_id, email, student, class, format, phase, nights_text, qty, unit_price, subtotal, discount, discount_code, total, provider, group_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, token, q.concert.id, q.email, q.student, q.klass, q.format, q.bulk ? 'bulk' : 'after', nightsText, q.qty, q.unit, q.subtotal, q.discount, q.discountCode, q.total, provider, groupId),
    ...q.chosen.map((n) => env.DB.prepare('INSERT INTO order_nights (order_id, night_id) VALUES (?, ?)').bind(id, n.id)),
  ]));

  const receipt = `/receipt.html?o=${lead.id}&t=${lead.token}`;

  // A 100% discount code: nothing to pay.
  if (total === 0) {
    await markPaid(env, lead.id, { provider: 'free', paymentRef: null, amount: 0 }, origin, ctx.waitUntil.bind(ctx));
    return json({ redirect: receipt });
  }

  const desc = orders.map(({ q, nightsText }) => description({ format: q.format!, qty: q.qty, nights_text: nightsText }, q.concert)).join(' + ').slice(0, 250);

  if (provider === 'test') {
    return json({ redirect: `/api/test-pay?o=${lead.id}&t=${lead.token}` });
  }

  if (provider === 'stripe') {
    const s = await stripe.createCheckout(env, { orderId: lead.id, token: lead.token, email: lead.q.email, description: desc, total, origin, concertId: lead.q.concert.id });
    await env.DB.prepare('UPDATE orders SET provider_ref = ? WHERE id = ?').bind(s.id, lead.id).run();
    return json({ redirect: s.url });
  }

  const p = await paypal.createOrder(env, { orderId: lead.id, description: desc, total, origin, concertId: lead.q.concert.id });
  await env.DB.prepare('UPDATE orders SET provider_ref = ? WHERE id = ?').bind(p.id, lead.id).run();
  return json({ redirect: p.url });
});

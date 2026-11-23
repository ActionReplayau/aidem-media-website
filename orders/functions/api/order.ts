import type { Env } from '../../lib/env';
import { ensureSchema } from '../../lib/db';
import { getOrder, markPaid, publicView } from '../../lib/orders';
import * as stripe from '../../lib/stripe';
import { fail, handle, json, safeEqual } from '../../lib/util';

// The receipt page asks for the order here. If Stripe's "paid" message hasn't arrived yet,
// this checks with Stripe directly so the parent never sees "pending" for a paid order.
export const onRequestGet: PagesFunction<Env> = (ctx) => handle(async () => {
  const { env, request } = ctx;
  await ensureSchema(env);
  const url = new URL(request.url);
  let o = await getOrder(env, url.searchParams.get('o') || '');
  if (!o || !safeEqual(o.token, url.searchParams.get('t') || '')) fail(404, 'Order not found.');
  if (o.status === 'pending' && o.provider === 'stripe' && o.provider_ref && env.STRIPE_SECRET_KEY) {
    const s = await stripe.getCheckout(env, o.provider_ref);
    if (s.payment_status === 'paid' && s.metadata?.order_id === o.id) {
      o = (await markPaid(env, o.id, { provider: 'stripe', paymentRef: s.payment_intent, amount: s.amount_total }, url.origin, ctx.waitUntil.bind(ctx)))!;
    }
  }
  return json(await publicView(env, o));
});

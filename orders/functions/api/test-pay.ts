import type { Env } from '../../lib/env';
import { ensureSchema } from '../../lib/db';
import { getOrder, markPaid } from '../../lib/orders';
import { safeEqual } from '../../lib/util';

// Only works while TEST_PAYMENTS is "on". Marks the order paid without charging anything.
export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const { env, request } = ctx;
  if (env.TEST_PAYMENTS !== 'on') return new Response('Test payments are turned off.', { status: 404 });
  await ensureSchema(env);
  const url = new URL(request.url);
  const o = await getOrder(env, url.searchParams.get('o') || '');
  if (!o || !safeEqual(o.token, url.searchParams.get('t') || '')) return new Response('Order not found', { status: 404 });
  await markPaid(env, o.id, { provider: 'test', paymentRef: 'test', amount: null }, url.origin, ctx.waitUntil.bind(ctx));
  return Response.redirect(`${url.origin}/receipt.html?o=${o.id}&t=${o.token}`, 303);
};

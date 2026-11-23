import type { Env } from '../../../lib/env';
import { ensureSchema, type Order } from '../../../lib/db';
import { markPaid } from '../../../lib/orders';
import * as paypal from '../../../lib/paypal';

// PayPal sends the parent back here after they approve the payment. We then take the payment.
export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const { env, request } = ctx;
  const url = new URL(request.url);
  const ppId = url.searchParams.get('token') || '';
  await ensureSchema(env);
  const o = await env.DB.prepare("SELECT * FROM orders WHERE provider = 'paypal' AND provider_ref = ?").bind(ppId).first<Order>();
  if (!o) return Response.redirect(url.origin + '/?error=paypal', 303);
  const receipt = `${url.origin}/receipt.html?o=${o.id}&t=${o.token}`;
  if (o.status !== 'pending') return Response.redirect(receipt, 303);
  try {
    const cap = await paypal.captureOrder(env, ppId);
    if (cap.completed && cap.orderId === o.id) {
      await markPaid(env, o.id, { provider: 'paypal', paymentRef: cap.captureId || null, amount: cap.amount }, url.origin, ctx.waitUntil.bind(ctx));
      return Response.redirect(receipt, 303);
    }
  } catch (e) {
    console.error('PayPal capture failed', e);
  }
  return Response.redirect(`${url.origin}/?concert=${o.concert_id}&error=paypal`, 303);
};

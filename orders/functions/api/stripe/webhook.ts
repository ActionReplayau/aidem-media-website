import type { Env } from '../../../lib/env';
import { ensureSchema } from '../../../lib/db';
import { markPaid } from '../../../lib/orders';
import { verifyWebhook } from '../../../lib/stripe';

// Stripe calls this when a payment completes, even if the parent closes their browser.
// In Stripe: Developers > Webhooks > add endpoint https://<your site>/api/stripe/webhook
// with the event checkout.session.completed, and put its signing secret in STRIPE_WEBHOOK_SECRET.
export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  const { env, request } = ctx;
  const body = await request.text();
  if (!(await verifyWebhook(env, body, request.headers.get('stripe-signature')))) {
    return new Response('Bad signature', { status: 400 });
  }
  const event = JSON.parse(body);
  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    const s = event.data.object;
    if (s.payment_status === 'paid' && s.metadata?.order_id) {
      await ensureSchema(env);
      await markPaid(env, s.metadata.order_id, { provider: 'stripe', paymentRef: s.payment_intent, amount: s.amount_total }, new URL(request.url).origin, ctx.waitUntil.bind(ctx));
    }
  }
  return new Response('ok');
};

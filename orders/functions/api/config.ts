import type { Env } from '../../lib/env';
import { business } from '../../lib/business';
import { json } from '../../lib/util';

// Tells the order page which payment buttons to show.
export const onRequestGet: PagesFunction<Env> = async ({ env }) => json({
  stripe: !!env.STRIPE_SECRET_KEY,
  paypal: !!(env.PAYPAL_CLIENT_ID && env.PAYPAL_SECRET),
  test: env.TEST_PAYMENTS === 'on',
  privacyUrl: business.privacyUrl,
  email: business.email,
  phone: business.phone,
});

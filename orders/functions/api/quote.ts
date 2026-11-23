import type { Env } from '../../lib/env';
import { ensureSchema } from '../../lib/db';
import { quote, type OrderInput } from '../../lib/pricing';
import { handle, json, readJson } from '../../lib/util';

// Live price shown on the order form, including any discount code.
export const onRequestPost: PagesFunction<Env> = ({ env, request }) => handle(async () => {
  await ensureSchema(env);
  const q = await quote(env, await readJson<OrderInput>(request), { strict: false });
  return json({
    qty: q.qty, unit: q.unit, subtotal: q.subtotal, discount: q.discount, total: q.total,
    discountCode: q.discountCode, discountError: q.discountError,
  });
});

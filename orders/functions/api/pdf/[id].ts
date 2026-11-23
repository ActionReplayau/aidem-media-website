import type { Env } from '../../../lib/env';
import { ensureSchema, getPdf } from '../../../lib/db';
import { bytesFromB64, hmacHex, safeEqual } from '../../../lib/util';

// The concert PDF, linked from download emails. The k= key stops people guessing other concerts.
export const onRequestGet: PagesFunction<Env> = async ({ env, params, request }) => {
  await ensureSchema(env);
  const id = Number(params.id);
  const k = new URL(request.url).searchParams.get('k') || '';
  const expected = (await hmacHex(env.ADMIN_PASSWORD, 'pdf:' + id)).slice(0, 24);
  if (!safeEqual(k, expected)) return new Response('Not found', { status: 404 });
  const pdf = await getPdf(env, id);
  if (!pdf) return new Response('Not found', { status: 404 });
  return new Response(bytesFromB64(pdf.pdf_data), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="${pdf.pdf_name.replace(/[^\w.\- ]/g, '')}"`,
      'cache-control': 'private, max-age=3600',
    },
  });
};

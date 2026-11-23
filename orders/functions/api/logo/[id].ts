import type { Env } from '../../../lib/env';
import { ensureSchema } from '../../../lib/db';
import { bytesFromB64 } from '../../../lib/util';

export const onRequestGet: PagesFunction<Env> = async ({ env, params }) => {
  await ensureSchema(env);
  const r = await env.DB.prepare('SELECT logo_type, logo_data FROM concerts WHERE id = ?').bind(Number(params.id)).first<{ logo_type: string | null; logo_data: string | null }>();
  if (!r?.logo_type || !r.logo_data) return new Response('Not found', { status: 404 });
  return new Response(bytesFromB64(r.logo_data), {
    headers: { 'content-type': r.logo_type, 'cache-control': 'public, max-age=86400', 'x-content-type-options': 'nosniff' },
  });
};

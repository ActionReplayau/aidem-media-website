import type { Env } from '../../../lib/env';
import { ensureSchema, housekeeping, isBulk, isOpen, type Concert } from '../../../lib/db';
import { handle, json, longDate } from '../../../lib/util';

// The school list parents see after scanning the QR code.
export const onRequestGet: PagesFunction<Env> = (ctx) => handle(async () => {
  const { env } = ctx;
  await ensureSchema(env);
  if (Math.random() < 0.05) ctx.waitUntil(housekeeping(env).catch(console.error));
  const r = await env.DB.prepare(`SELECT id, school, title, performed, visible, usb_enabled, usb_cutoff, orders_close, logo_type, updated_at
    FROM concerts WHERE visible = 1 ORDER BY school COLLATE NOCASE, title COLLATE NOCASE`).all<Concert>();
  const concerts = r.results.filter((c) => isOpen(c)).map((c) => ({
    id: c.id,
    school: c.school,
    title: c.title,
    performed: c.performed,
    bulk: isBulk(c),
    usbCutoff: c.usb_cutoff && isBulk(c) ? longDate(c.usb_cutoff) : null,
    logo: c.logo_type ? `/api/logo/${c.id}?v=${encodeURIComponent(c.updated_at)}` : null,
  }));
  return json({ concerts }, 200, { 'cache-control': 'no-store' });
});

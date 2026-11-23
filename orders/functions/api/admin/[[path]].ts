import type { Env } from '../../../lib/env';
import { CONCERT_COLS, ensureSchema, getConcert, getNights, hasPdf, housekeeping, isBulk, type Concert, type Order } from '../../../lib/db';
import { checkPassword, isAdmin, makeSession, sessionCookie } from '../../../lib/auth';
import { emailReady, downloadEmail, sendBatch } from '../../../lib/email';
import { getOrder, pdfUrl, publicView, sendDownloadLink, sendReceipt } from '../../../lib/orders';
import { orderNo } from '../../../lib/business';
import * as stripe from '../../../lib/stripe';
import * as paypal from '../../../lib/paypal';
import { b64FromDataUrl, clean, csv, fail, gstOf, handle, isEmail, json, money, readJson } from '../../../lib/util';

type Handler = (a: { env: Env; request: Request; url: URL; parts: string[]; origin: string; waitUntil: (p: Promise<unknown>) => void }) => Promise<Response>;

export const onRequest: PagesFunction<Env> = (ctx) => handle(async () => {
  const { env, request } = ctx;
  await ensureSchema(env);
  const url = new URL(request.url);
  const parts = url.pathname.replace(/^\/api\/admin\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const route = `${request.method} ${parts[0] || ''}`;

  if (route === 'POST login') {
    const { password } = await readJson<{ password: string }>(request);
    await checkPassword(env, password);
    return json({ ok: true }, 200, { 'set-cookie': sessionCookie(await makeSession(env)) });
  }
  if (route === 'POST logout') return json({ ok: true }, 200, { 'set-cookie': sessionCookie('', true) });
  if (!(await isAdmin(env, request))) fail(401, 'Please sign in.');
  // Admin changes must come from the admin page itself.
  if (request.method !== 'GET' && !(request.headers.get('content-type') || '').includes('application/json')) fail(415, 'Expected JSON');

  const handler = routes[route];
  if (!handler) fail(404, 'Not found');
  return handler({ env, request, url, parts, origin: url.origin, waitUntil: ctx.waitUntil.bind(ctx) });
});

const routes: Record<string, Handler> = {
  'GET me': async ({ env }) => {
    await housekeeping(env);
    const sent = await env.DB.prepare(`SELECT
        (SELECT COUNT(*) FROM orders WHERE date(receipt_sent_at) = date('now')) +
        (SELECT COUNT(*) FROM orders WHERE date(download_sent_at) = date('now') AND (receipt_sent_at IS NULL OR download_sent_at <> receipt_sent_at)) AS n`).first<{ n: number }>();
    return json({
      ok: true,
      setup: {
        stripe: !!env.STRIPE_SECRET_KEY,
        stripeLive: (env.STRIPE_SECRET_KEY || '').startsWith('sk_live_'),
        stripeWebhook: !!env.STRIPE_WEBHOOK_SECRET,
        paypal: !!(env.PAYPAL_CLIENT_ID && env.PAYPAL_SECRET),
        paypalLive: env.PAYPAL_MODE === 'live',
        email: emailReady(env),
        emailFrom: env.EMAIL_FROM || '',
        test: env.TEST_PAYMENTS === 'on',
      },
      emailsToday: sent?.n || 0,
    });
  },

  // ---------- Concerts ----------
  'GET concerts': async ({ env }) => {
    const r = await env.DB.prepare(`SELECT ${CONCERT_COLS},
        (SELECT COUNT(*) FROM orders o WHERE o.concert_id = c.id AND o.status = 'paid') AS paid,
        (SELECT COUNT(*) FROM orders o WHERE o.concert_id = c.id AND o.status = 'paid' AND o.format = 'usb') AS usb,
        (SELECT COUNT(*) FROM orders o WHERE o.concert_id = c.id AND o.status = 'paid' AND o.format = 'download') AS download,
        (SELECT COUNT(*) FROM orders o WHERE o.concert_id = c.id AND o.status = 'paid' AND o.format = 'download' AND o.download_sent_at IS NULL) AS links_waiting,
        (SELECT COALESCE(SUM(o.total - o.refund_amount), 0) FROM orders o WHERE o.concert_id = c.id AND o.status IN ('paid', 'refunded')) AS takings
      FROM concerts c ORDER BY c.created_at DESC`).all<Concert & Record<string, number>>();
    return json({ concerts: r.results.map((c) => ({ ...c, bulk: isBulk(c) })) });
  },

  'GET concert': async ({ env, parts }) => {
    const c = await getConcert(env, Number(parts[1]));
    if (!c) fail(404, 'Concert not found');
    const nights = await getNights(env, c.id);
    const counts = await env.DB.prepare(`SELECT n.id, COUNT(o.id) AS paid FROM nights n
        LEFT JOIN order_nights x ON x.night_id = n.id LEFT JOIN orders o ON o.id = x.order_id AND o.status = 'paid'
        WHERE n.concert_id = ? GROUP BY n.id`).bind(c.id).all<{ id: number; paid: number }>();
    const pdf = await env.DB.prepare('SELECT pdf_name, length(pdf_data) AS size FROM concert_files WHERE concert_id = ?').bind(c.id).first<{ pdf_name: string; size: number }>();
    return json({
      concert: { ...c, bulk: isBulk(c) },
      nights: nights.map((n) => ({ ...n, paid: counts.results.find((x) => x.id === n.id)?.paid || 0 })),
      pdf: pdf ? { name: pdf.pdf_name, size: Math.round(pdf.size * 0.75) } : null,
      logo: c.logo_type ? `/api/logo/${c.id}?v=${encodeURIComponent(c.updated_at)}` : null,
    });
  },

  'POST concerts': async ({ env, request }) => {
    const body = await readJson(request);
    const v = concertFields(body);
    const r = await env.DB.prepare(`INSERT INTO concerts (school, title, performed, access_code, visible, usb_enabled, usb_cutoff, orders_close,
        price_usb, price_download, class_list, download_url, commission_pct, delete_students_after)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`)
      .bind(v.school, v.title, v.performed, v.access_code, v.visible, v.usb_enabled, v.usb_cutoff, v.orders_close,
        v.price_usb, v.price_download, v.class_list, v.download_url, v.commission_pct, v.delete_students_after).first<{ id: number }>();
    await saveExtras(env, r!.id, body);
    return json({ id: r!.id });
  },

  'PUT concert': async ({ env, request, parts }) => {
    const id = Number(parts[1]);
    if (!(await getConcert(env, id))) fail(404, 'Concert not found');
    const body = await readJson(request);
    const v = concertFields(body);
    await env.DB.prepare(`UPDATE concerts SET school = ?, title = ?, performed = ?, access_code = ?, visible = ?, usb_enabled = ?, usb_cutoff = ?,
        orders_close = ?, price_usb = ?, price_download = ?, class_list = ?, download_url = ?, commission_pct = ?, delete_students_after = ?,
        updated_at = datetime('now') WHERE id = ?`)
      .bind(v.school, v.title, v.performed, v.access_code, v.visible, v.usb_enabled, v.usb_cutoff, v.orders_close,
        v.price_usb, v.price_download, v.class_list, v.download_url, v.commission_pct, v.delete_students_after, id).run();
    await saveExtras(env, id, body);
    return json({ id });
  },

  'DELETE concert': async ({ env, parts }) => {
    const id = Number(parts[1]);
    const paid = await env.DB.prepare("SELECT COUNT(*) AS n FROM orders WHERE concert_id = ? AND status <> 'pending'").bind(id).first<{ n: number }>();
    if (paid && paid.n > 0) fail(400, 'This concert has paid orders, so it can only be hidden, not deleted.');
    await env.DB.batch([
      env.DB.prepare('DELETE FROM order_nights WHERE order_id IN (SELECT id FROM orders WHERE concert_id = ?)').bind(id),
      env.DB.prepare('DELETE FROM orders WHERE concert_id = ?').bind(id),
      env.DB.prepare('DELETE FROM nights WHERE concert_id = ?').bind(id),
      env.DB.prepare('DELETE FROM concert_files WHERE concert_id = ?').bind(id),
      env.DB.prepare('DELETE FROM concerts WHERE id = ?').bind(id),
    ]);
    return json({ ok: true });
  },

  // Emails download links to everyone who bought a download and hasn't had one yet.
  'POST send-links': async ({ env, request, origin }) => {
    const body = await readJson<{ concertId: number; limit?: number }>(request);
    const c = await getConcert(env, Number(body.concertId));
    if (!c) fail(404, 'Concert not found');
    if (!c.download_url) fail(400, 'Add the download link to this concert first.');
    if (!emailReady(env)) fail(400, 'Email is not set up yet (RESEND_API_KEY).');
    const limit = Math.max(1, Math.min(100, Number(body.limit) || 90));
    const r = await env.DB.prepare(`SELECT * FROM orders WHERE concert_id = ? AND status = 'paid' AND format = 'download' AND download_sent_at IS NULL
        ORDER BY order_no LIMIT ?`).bind(c.id, limit).all<Order>();
    const list = r.results;
    if (!list.length) return json({ sent: 0, remaining: 0 });
    const pdf = (await hasPdf(env, c.id)) ? await pdfUrl(env, origin, c.id) : null;
    const ok = await sendBatch(env, list.map((o) => downloadEmail(o, c, pdf)));
    if (!ok) fail(502, 'The email service refused the send. You may have reached today\'s limit; try again tomorrow.');
    await env.DB.batch(list.map((o) => env.DB.prepare("UPDATE orders SET download_sent_at = datetime('now') WHERE id = ?").bind(o.id)));
    const left = await env.DB.prepare(`SELECT COUNT(*) AS n FROM orders WHERE concert_id = ? AND status = 'paid' AND format = 'download' AND download_sent_at IS NULL`).bind(c.id).first<{ n: number }>();
    return json({ sent: list.length, remaining: left?.n || 0 });
  },

  // ---------- Orders ----------
  'GET orders': async ({ env, url }) => {
    const { where, binds } = orderFilter(url);
    const r = await env.DB.prepare(`SELECT o.*, c.school, c.title FROM orders o JOIN concerts c ON c.id = o.concert_id
        ${where} ORDER BY COALESCE(o.paid_at, o.created_at) DESC LIMIT 2000`).bind(...binds).all();
    return json({ orders: r.results.map((o: any) => ({ ...o, orderNo: orderNo(o.order_no) })) });
  },

  'GET order': async ({ env, parts }) => {
    const o = await getOrder(env, parts[1]);
    if (!o) fail(404, 'Order not found');
    const c = await getConcert(env, o.concert_id);
    return json({ order: { ...o, orderNo: orderNo(o.order_no) }, concert: c, view: await publicView(env, o) });
  },

  'PUT order': async ({ env, request, parts }) => {
    const o = await getOrder(env, parts[1]);
    if (!o) fail(404, 'Order not found');
    const b = await readJson<{ email?: string; student?: string; class?: string; note?: string }>(request);
    const email = clean(b.email ?? o.email, 254).toLowerCase();
    if (!isEmail(email)) fail(400, 'That email address does not look right.');
    await env.DB.prepare('UPDATE orders SET email = ?, student = ?, class = ?, note = ? WHERE id = ?')
      .bind(email, clean(b.student ?? o.student, 80) || null, clean(b.class ?? o.class, 30).toUpperCase() || null, clean(b.note ?? o.note, 500) || null, o.id).run();
    return json({ ok: true });
  },

  'POST order': async ({ env, request, parts, origin }) => {
    const o = await getOrder(env, parts[1]);
    if (!o) fail(404, 'Order not found');
    const action = parts[2];
    if (action === 'resend') {
      if (o.status === 'pending') fail(400, 'This order has not been paid.');
      if (!(await sendReceipt(env, o, origin))) fail(502, 'The receipt could not be sent. Check email settings.');
      return json({ ok: true });
    }
    if (action === 'send-link') {
      const c = await getConcert(env, o.concert_id);
      if (o.status !== 'paid' || o.format !== 'download') fail(400, 'Only paid download orders get a link.');
      if (!c?.download_url) fail(400, 'Add the download link to this concert first.');
      if (!(await sendDownloadLink(env, o, c, origin))) fail(502, 'The email could not be sent. Check email settings.');
      return json({ ok: true });
    }
    if (action === 'refund') {
      if (o.status !== 'paid') fail(400, 'Only paid orders can be refunded.');
      const b = await readJson<{ amount?: number }>(request);
      const left = o.total - o.refund_amount;
      const amount = b.amount ? Math.round(Number(b.amount)) : left;
      if (!(amount > 0 && amount <= left)) fail(400, `Refund must be between $0.01 and ${money(left)}.`);
      const partial = amount < o.total || o.refund_amount > 0;
      if (o.provider === 'stripe') {
        if (!o.payment_ref) fail(400, 'No Stripe payment found for this order. Refund it in Stripe.');
        await stripe.refund(env, o.payment_ref, partial ? amount : undefined);
      } else if (o.provider === 'paypal') {
        if (!o.payment_ref) fail(400, 'No PayPal payment found for this order. Refund it in PayPal.');
        await paypal.refund(env, o.payment_ref, partial ? amount : undefined);
      }
      const full = amount === left;
      await env.DB.prepare(`UPDATE orders SET refund_amount = refund_amount + ?, refunded_at = datetime('now')${full ? ", status = 'refunded'" : ''} WHERE id = ?`)
        .bind(amount, o.id).run();
      return json({ ok: true, refunded: amount, full });
    }
    fail(404, 'Not found');
  },

  // ---------- Exports ----------
  'GET export': async ({ env, url, parts }) => {
    const kind = parts[1];
    const { where, binds, concert, night } = await exportFilter(env, url);
    const r = await env.DB.prepare(`SELECT o.* FROM orders o ${where}
        ORDER BY o.class COLLATE NOCASE, o.student COLLATE NOCASE, o.order_no`).bind(...binds).all<Order>();
    const name = (concert.school + ' ' + concert.title + (night ? ' ' + night.label : '')).replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
    let body: string;
    if (kind === 'emails.csv') {
      const seen = new Set<string>();
      body = csv([['Email', 'Order', 'Format', 'Nights'], ...r.results.filter((o) => !seen.has(o.email) && seen.add(o.email)).map((o) => [o.email, orderNo(o.order_no), o.format === 'usb' ? 'USB' : 'Download', o.nights_text])]);
    } else {
      const commission = concert.commission_pct || 0;
      body = csv([
        ['Order', 'Paid', 'Class', 'Student', 'Format', 'Nights', 'Qty', 'Email', 'Subtotal', 'Discount', 'Discount code', 'Total', 'GST', 'Refunded', 'Paid by', 'Download link sent', ...(commission ? ['School commission'] : [])],
        ...r.results.map((o) => [
          orderNo(o.order_no), o.paid_at, o.class, o.student, o.format === 'usb' ? 'USB' : 'Download', o.nights_text, o.qty, o.email,
          (o.subtotal / 100).toFixed(2), (o.discount / 100).toFixed(2), o.discount_code, (o.total / 100).toFixed(2), (gstOf(o.total) / 100).toFixed(2),
          (o.refund_amount / 100).toFixed(2), o.provider, o.download_sent_at || '',
          ...(commission ? [(((o.total - o.refund_amount) * commission) / 10000).toFixed(2)] : []),
        ]),
      ]);
    }
    return new Response(body, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${name}-${kind === 'emails.csv' ? 'emails' : 'orders'}.csv"`,
        'cache-control': 'no-store',
      },
    });
  },

  'GET classlist': async ({ env, url }) => {
    const { where, binds, concert, night } = await exportFilter(env, url);
    const r = await env.DB.prepare(`SELECT o.order_no, o.class, o.student, o.format, o.nights_text, o.qty FROM orders o ${where}
        ORDER BY o.class COLLATE NOCASE, o.student COLLATE NOCASE`).bind(...binds).all<Order>();
    return json({
      concert: { school: concert.school, title: concert.title, performed: concert.performed },
      night: night?.label || null,
      rows: r.results.map((o) => ({ ...o, orderNo: orderNo(o.order_no) })),
    });
  },

  // ---------- Discount codes ----------
  'GET discounts': async ({ env }) => {
    const r = await env.DB.prepare(`SELECT d.*, c.school, c.title FROM discounts d LEFT JOIN concerts c ON c.id = d.concert_id ORDER BY d.created_at DESC`).all();
    return json({ discounts: r.results });
  },
  'POST discounts': async ({ env, request }) => {
    const b = await readJson(request);
    const code = clean(b.code, 40).toUpperCase().replace(/\s+/g, '');
    if (!/^[A-Z0-9_-]{3,40}$/.test(code)) fail(400, 'Codes use letters and numbers only, at least 3.');
    const kind = b.kind === 'amount' ? 'amount' : 'percent';
    const value = Math.round(Number(b.value));
    if (!(value > 0) || (kind === 'percent' && value > 100)) fail(400, kind === 'percent' ? 'Percent must be 1 to 100.' : 'Enter the dollar amount.');
    const maxUses = b.max_uses ? Math.max(1, Math.round(Number(b.max_uses))) : null;
    const concertId = b.concert_id ? Number(b.concert_id) : null;
    const exists = await env.DB.prepare('SELECT 1 FROM discounts WHERE code = ?').bind(code).first();
    if (exists) fail(400, 'That code already exists.');
    await env.DB.prepare('INSERT INTO discounts (code, kind, value, concert_id, max_uses) VALUES (?, ?, ?, ?, ?)')
      .bind(code, kind, value, concertId, maxUses).run();
    return json({ ok: true });
  },
  'PUT discounts': async ({ env, request, parts }) => {
    const b = await readJson<{ active: boolean }>(request);
    await env.DB.prepare('UPDATE discounts SET active = ? WHERE code = ?').bind(b.active ? 1 : 0, parts[1]).run();
    return json({ ok: true });
  },
  'DELETE discounts': async ({ env, parts }) => {
    await env.DB.prepare('DELETE FROM discounts WHERE code = ?').bind(parts[1]).run();
    return json({ ok: true });
  },
};

// Singular aliases so /concerts/12 and /orders/abc reach the right handler.
routes['GET concerts'] = ((list) => (a: Parameters<Handler>[0]) => (a.parts[1] ? routes['GET concert'](a) : list(a)))(routes['GET concerts']);
routes['PUT concerts'] = routes['PUT concert'];
routes['DELETE concerts'] = routes['DELETE concert'];
routes['GET orders'] = ((list) => (a: Parameters<Handler>[0]) => (a.parts[1] ? routes['GET order'](a) : list(a)))(routes['GET orders']);
routes['PUT orders'] = routes['PUT order'];
routes['POST orders'] = routes['POST order'];

function dateOrNull(v: unknown): string | null {
  const s = clean(v, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function cents(v: unknown, fallback: number): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function concertFields(b: any) {
  const school = clean(b.school, 120);
  const title = clean(b.title, 120);
  const access_code = clean(b.access_code, 40).toUpperCase().replace(/\s+/g, '');
  if (!school) fail(400, 'Enter the school name.');
  if (!title) fail(400, 'Enter the concert name.');
  if (access_code.length < 4) fail(400, 'The access code needs at least 4 letters or numbers.');
  const download_url = clean(b.download_url, 500);
  if (download_url && !/^https:\/\//.test(download_url)) fail(400, 'The download link must start with https://');
  return {
    school, title, access_code, download_url,
    performed: clean(b.performed, 120),
    visible: b.visible ? 1 : 0,
    usb_enabled: b.usb_enabled ? 1 : 0,
    usb_cutoff: dateOrNull(b.usb_cutoff),
    orders_close: dateOrNull(b.orders_close),
    price_usb: cents(b.price_usb, 4000),
    price_download: cents(b.price_download, 3500),
    class_list: String(b.class_list || '').slice(0, 4000),
    commission_pct: Math.max(0, Math.min(100, Number(b.commission_pct) || 0)),
    delete_students_after: dateOrNull(b.delete_students_after),
  };
}

// Nights, logo and PDF.
async function saveExtras(env: Env, id: number, b: any) {
  if (Array.isArray(b.nights)) {
    const existing = await getNights(env, id);
    const keep = new Set<number>();
    const stmts: D1PreparedStatement[] = [];
    b.nights.map((n: any) => ({ id: Number(n.id) || 0, label: clean(n.label, 80) })).filter((n: any) => n.label)
      .forEach((n: any, i: number) => {
        if (n.id && existing.some((e) => e.id === n.id)) {
          keep.add(n.id);
          stmts.push(env.DB.prepare('UPDATE nights SET label = ?, position = ? WHERE id = ?').bind(n.label, i, n.id));
        } else {
          stmts.push(env.DB.prepare('INSERT INTO nights (concert_id, label, position) VALUES (?, ?, ?)').bind(id, n.label, i));
        }
      });
    for (const e of existing.filter((e) => !keep.has(e.id))) {
      const used = await env.DB.prepare("SELECT 1 FROM order_nights x JOIN orders o ON o.id = x.order_id WHERE x.night_id = ? AND o.status <> 'pending' LIMIT 1").bind(e.id).first();
      if (used) fail(400, `"${e.label}" already has orders, so it can't be removed. Rename it instead.`);
      stmts.push(env.DB.prepare('DELETE FROM order_nights WHERE night_id = ?').bind(e.id));
      stmts.push(env.DB.prepare('DELETE FROM nights WHERE id = ?').bind(e.id));
    }
    if (stmts.length) await env.DB.batch(stmts);
  }
  if (b.logo === null || b.logo === '') {
    await env.DB.prepare("UPDATE concerts SET logo_type = NULL, logo_data = NULL, updated_at = datetime('now') WHERE id = ?").bind(id).run();
  } else if (typeof b.logo === 'string') {
    const img = b64FromDataUrl(b.logo);
    if (!img || !/^image\/(png|jpeg|webp)$/.test(img.type)) fail(400, 'The logo must be a PNG, JPG or WebP image.');
    if (img.data.length > 700_000) fail(400, 'The logo is too large.');
    await env.DB.prepare("UPDATE concerts SET logo_type = ?, logo_data = ?, updated_at = datetime('now') WHERE id = ?").bind(img.type, img.data, id).run();
  }
  if (b.pdf === null) {
    await env.DB.prepare('DELETE FROM concert_files WHERE concert_id = ?').bind(id).run();
  } else if (b.pdf && typeof b.pdf === 'object') {
    const f = b64FromDataUrl(b.pdf.data);
    if (!f || f.type !== 'application/pdf') fail(400, 'The concert file must be a PDF.');
    if (f.data.length > 1_400_000) fail(400, 'The PDF must be under 1 MB.');
    const name = clean(b.pdf.name, 100).replace(/[^\w.\- ]/g, '') || 'concert.pdf';
    await env.DB.prepare('INSERT OR REPLACE INTO concert_files (concert_id, pdf_name, pdf_data) VALUES (?, ?, ?)').bind(id, name, f.data).run();
  }
}

function orderFilter(url: URL) {
  const p = url.searchParams;
  const conds: string[] = [];
  const binds: (string | number)[] = [];
  if (p.get('concert')) { conds.push('o.concert_id = ?'); binds.push(Number(p.get('concert'))); }
  if (p.get('night')) { conds.push('o.id IN (SELECT order_id FROM order_nights WHERE night_id = ?)'); binds.push(Number(p.get('night'))); }
  if (p.get('format')) { conds.push('o.format = ?'); binds.push(p.get('format')!); }
  const status = p.get('status') || 'paid';
  if (status !== 'all') { conds.push('o.status = ?'); binds.push(status); }
  const q = clean(p.get('q'), 100);
  if (q) {
    const n = /^(?:AM-?)?(\d+)$/i.exec(q);
    if (n) { conds.push('o.order_no = ?'); binds.push(Number(n[1])); }
    else { conds.push('(o.email LIKE ? OR o.student LIKE ? OR o.class LIKE ?)'); binds.push(`%${q}%`, `%${q}%`, q); }
  }
  return { where: conds.length ? 'WHERE ' + conds.join(' AND ') : '', binds };
}

async function exportFilter(env: Env, url: URL) {
  const concert = await getConcert(env, Number(url.searchParams.get('concert')));
  if (!concert) fail(404, 'Choose a concert.');
  const nights = await getNights(env, concert.id);
  const night = nights.find((n) => n.id === Number(url.searchParams.get('night'))) || null;
  const conds = ["o.concert_id = ?", "o.status = 'paid'"];
  const binds: (string | number)[] = [concert.id];
  if (night) { conds.push('o.id IN (SELECT order_id FROM order_nights WHERE night_id = ?)'); binds.push(night.id); }
  const format = url.searchParams.get('format');
  if (format === 'usb' || format === 'download') { conds.push('o.format = ?'); binds.push(format); }
  return { where: 'WHERE ' + conds.join(' AND '), binds, concert, night };
}


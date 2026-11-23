import type { Env } from './env';
import { getConcert, getPdf, isBulk, NEXT_ORDER_NO_SQL, type Concert, type Order } from './db';
import { downloadEmail, invoiceLines, receiptEmail, sendEmail } from './email';
import { business, orderNo } from './business';
import { gstOf, hmacHex, money } from './util';

export async function getOrder(env: Env, id: string) {
  return env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first<Order>();
}

export function description(o: Pick<Order, 'format' | 'qty' | 'nights_text'>, c: Concert) {
  const fmt = o.format === 'usb' ? 'USB' : 'Download';
  return `${c.school}, ${c.title} (${fmt}${o.qty > 1 ? ', ' + o.qty + ' nights' : o.nights_text ? ', ' + o.nights_text : ''})`;
}

export async function pdfUrl(env: Env, origin: string, concertId: number) {
  const k = (await hmacHex(env.ADMIN_PASSWORD, 'pdf:' + concertId)).slice(0, 24);
  return `${origin}/api/pdf/${concertId}?k=${k}`;
}

export async function getGroup(env: Env, o: Order): Promise<Order[]> {
  if (!o.group_id) return [o];
  return (await env.DB.prepare('SELECT * FROM orders WHERE group_id = ? ORDER BY rowid').bind(o.group_id).all<Order>()).results;
}

// Marks an order paid exactly once, gives it the next invoice number and emails the receipt.
// Orders paid together in one checkout (same group_id) are all marked paid, each with its own invoice.
// Safe to call more than once (Stripe webhook and the receipt page may both call it).
export async function markPaid(env: Env, orderId: string, p: { provider: string; paymentRef: string | null; amount: number | null }, origin: string, waitUntil?: (p: Promise<unknown>) => void) {
  const lead = await getOrder(env, orderId);
  if (!lead) return null;
  const group = await getGroup(env, lead);
  const pending = group.filter((o) => o.status === 'pending');
  if (!pending.length) return lead;
  const groupTotal = group.reduce((sum, o) => sum + o.total, 0);
  if (p.amount != null && p.amount !== groupTotal) {
    console.error('Paid amount does not match order', orderId, p.amount, groupTotal);
    await env.DB.prepare('UPDATE orders SET note = ? WHERE id = ?').bind(`Paid ${money(p.amount)} but the order total was ${money(groupTotal)}. Check this order.`, orderId).run();
  }
  const codesUsed = new Set<string>();
  const jobs: Promise<unknown>[] = [];
  for (const o of pending) {
    const res = await env.DB.prepare(`UPDATE orders SET status = 'paid', order_no = ${NEXT_ORDER_NO_SQL},
        paid_at = datetime('now'), provider = ?, payment_ref = COALESCE(?, payment_ref)
        WHERE id = ? AND status = 'pending'`).bind(p.provider, p.paymentRef, o.id).run();
    if (res.meta.changes !== 1) continue;
    if (o.discount_code && !codesUsed.has(o.discount_code)) {
      codesUsed.add(o.discount_code);
      await env.DB.prepare('UPDATE discounts SET uses = uses + 1 WHERE code = ?').bind(o.discount_code).run();
    }
    const paid = (await getOrder(env, o.id))!;
    jobs.push(sendReceipt(env, paid, origin).catch((e) => console.error('Receipt email failed', e)));
  }
  const all = Promise.all(jobs);
  if (waitUntil) waitUntil(all); else await all;
  return (await getOrder(env, orderId))!;
}

export async function sendReceipt(env: Env, o: Order, origin: string) {
  const c = await getConcert(env, o.concert_id);
  if (!c) return false;
  // Orders placed after the bulk period get their download link straight away.
  const sendLinkNow = o.format === 'download' && o.phase === 'after' && !!c.download_url;
  const pdf = sendLinkNow ? await getPdf(env, c.id) : null;
  const mail = receiptEmail(o, c, {
    sendLinkNow,
    receiptUrl: `${origin}/receipt.html?o=${o.id}&t=${o.token}`,
    pdf: pdf ? { name: pdf.pdf_name, data: pdf.pdf_data } : null,
  });
  const ok = await sendEmail(env, mail);
  if (ok) {
    await env.DB.prepare(`UPDATE orders SET receipt_sent_at = datetime('now')${sendLinkNow ? ", download_sent_at = datetime('now')" : ''} WHERE id = ?`).bind(o.id).run();
  }
  return ok;
}

export async function sendDownloadLink(env: Env, o: Order, c: Concert, origin: string) {
  const hasPdf = !!(await env.DB.prepare('SELECT 1 FROM concert_files WHERE concert_id = ?').bind(c.id).first());
  const ok = await sendEmail(env, downloadEmail(o, c, hasPdf ? await pdfUrl(env, origin, c.id) : null));
  if (ok) await env.DB.prepare("UPDATE orders SET download_sent_at = datetime('now') WHERE id = ?").bind(o.id).run();
  return ok;
}

// What the parent sees on the receipt page.
export async function publicView(env: Env, o: Order) {
  const c = await getConcert(env, o.concert_id);
  if (!c) return null;
  const linkNow = o.status === 'paid' && o.format === 'download' && o.phase === 'after' && !!c.download_url;
  return {
    status: o.status,
    orderNo: orderNo(o.order_no),
    email: o.email,
    concert: `${c.school}, ${c.title}`,
    concertId: c.id,
    hasLogo: !!c.logo_type,
    logoVersion: c.updated_at,
    lines: o.status === 'pending' ? [] : invoiceLines(o, c),
    total: money(o.total),
    gst: money(gstOf(o.total)),
    business: { name: business.name, abn: business.abn, location: business.location, email: business.email },
    paidBy: o.provider === 'stripe' ? 'card' : o.provider === 'paypal' ? 'PayPal' : o.provider === 'test' ? 'test payment' : o.provider === 'free' ? 'discount code' : '',
    next: o.format === 'usb'
      ? `Your USB will be sent home with ${o.class ? 'class ' + o.class : 'your child'} after the concert.`
      : linkNow ? 'Your download link is below, and in your email.' : "We'll email your download link when the concert video is ready.",
    downloadUrl: linkNow ? c.download_url : null,
    stillBulk: isBulk(c),
    // Other events paid for in the same checkout, each with its own tax invoice.
    others: await Promise.all((await getGroup(env, o)).filter((x) => x.id !== o.id).map(async (x) => {
      const xc = await getConcert(env, x.concert_id);
      return { orderNo: orderNo(x.order_no), concert: xc ? `${xc.school}, ${xc.title}` : '', total: money(x.total), url: `/receipt.html?o=${x.id}&t=${x.token}` };
    })),
  };
}

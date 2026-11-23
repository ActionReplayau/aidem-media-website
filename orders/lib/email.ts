import type { Env } from './env';
import type { Concert, Order } from './db';
import { business, orderNo } from './business';
import { esc, gstOf, longDate, money } from './util';

export interface Mail {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: { filename: string; content: string }[];
}

function payload(env: Env, m: Mail) {
  return {
    from: env.EMAIL_FROM || 'Aidem Media <onboarding@resend.dev>',
    reply_to: env.EMAIL_REPLY_TO || business.email,
    to: [m.to],
    subject: m.subject,
    html: m.html,
    text: m.text,
    ...(m.attachments?.length ? { attachments: m.attachments } : {}),
  };
}

export function emailReady(env: Env) { return !!env.RESEND_API_KEY; }

export async function sendEmail(env: Env, m: Mail): Promise<boolean> {
  if (!env.RESEND_API_KEY) { console.log('Email not sent (Resend not set up):', m.subject, m.to); return false; }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + env.RESEND_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify(payload(env, m)),
  });
  if (!res.ok) { console.error('Resend error', res.status, await res.text()); return false; }
  return true;
}

// Up to 100 emails in one request (no attachments). Returns how many Resend accepted.
export async function sendBatch(env: Env, mails: Mail[]): Promise<boolean> {
  if (!env.RESEND_API_KEY || !mails.length) return false;
  const res = await fetch('https://api.resend.com/emails/batch', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + env.RESEND_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify(mails.map((m) => payload(env, m))),
  });
  if (!res.ok) { console.error('Resend batch error', res.status, await res.text()); return false; }
  return true;
}

const ink = '#15191F', paper = '#F7F5F0', line = '#DDD7CB', muted = '#4A5059', plum = '#8E2F89';

function shell(title: string, inner: string) {
  return `<!doctype html><html><body style="margin:0;background:${paper};font-family:Helvetica,Arial,sans-serif;color:#1E2329">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${paper}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border:1px solid ${line}">
<tr><td style="background:${ink};padding:18px 24px;color:${paper};font-family:Georgia,serif;font-size:20px">${business.tradingName}</td></tr>
<tr><td style="padding:28px 24px">
<h1 style="font-family:Georgia,serif;font-weight:normal;font-size:24px;margin:0 0 16px">${esc(title)}</h1>
${inner}
</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid ${line};font-size:12px;color:${muted}">
${business.name} · ABN ${business.abn} · ${business.location}<br>${business.email} · ${business.phone}
</td></tr></table></td></tr></table></body></html>`;
}

function row(label: string, value: string, bold = false) {
  const w = bold ? 'font-weight:bold;border-top:1px solid ' + line + ';' : '';
  return `<tr><td style="padding:6px 0;color:${muted};${w}">${esc(label)}</td><td align="right" style="padding:6px 0;${w}">${esc(value)}</td></tr>`;
}

function button(href: string, label: string) {
  return `<p style="margin:20px 0"><a href="${esc(href)}" style="display:inline-block;background:${plum};color:#fff;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:4px">${esc(label)}</a></p>`;
}

export function concertName(c: Concert) { return `${c.school}, ${c.title}`; }

export function invoiceLines(o: Order, c: Concert) {
  const lines: [string, string][] = [
    ['Invoice', orderNo(o.order_no)],
    ['Date', longDate(o.paid_at || o.created_at)],
    ['Concert', concertName(c)],
  ];
  if (o.nights_text) lines.push([o.qty > 1 ? 'Videos' : 'Video', o.nights_text]);
  if (o.student) lines.push(['Student', o.student]);
  if (o.class) lines.push(['Class', o.class]);
  lines.push(['Format', o.format === 'usb' ? 'USB' : 'Download']);
  lines.push([`${o.format === 'usb' ? 'USB' : 'Download'}${o.qty > 1 ? ` × ${o.qty}` : ''}`, money(o.subtotal)]);
  if (o.discount) lines.push([`Discount${o.discount_code ? ' (' + o.discount_code + ')' : ''}`, '−' + money(o.discount)]);
  lines.push(['Price excl. GST', money(o.total - gstOf(o.total))]);
  lines.push(['GST', money(gstOf(o.total))]);
  return lines;
}

function nextStep(o: Order, c: Concert, sendLinkNow: boolean) {
  if (o.format === 'usb') return `Your USB will be sent home with ${o.class ? 'class ' + o.class : 'your child'} after the concert.`;
  if (sendLinkNow && c.download_url) return 'Your download link is below.';
  return "We'll email your download link when the concert video is ready.";
}

export function receiptEmail(o: Order, c: Concert, opts: { sendLinkNow: boolean; receiptUrl: string; pdf?: { name: string; data: string } | null }): Mail {
  const lines = invoiceLines(o, c);
  const next = nextStep(o, c, opts.sendLinkNow);
  const link = opts.sendLinkNow && o.format === 'download' && c.download_url ? c.download_url : '';
  const html = shell('Tax invoice', `
<p style="margin:0 0 16px">Thanks for your order. ${esc(next)}</p>
${link ? button(link, 'Watch and download') : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;margin-top:8px">
${lines.map(([k, v]) => row(k, v)).join('')}
${row('Total paid (incl. GST)', money(o.total), true)}
</table>
<p style="margin:20px 0 0;font-size:13px;color:${muted}">Keep this email as your tax invoice. <a href="${esc(opts.receiptUrl)}" style="color:${plum}">View it online</a>. Questions? Reply to this email.</p>`);
  const text = [
    `${business.name} · ABN ${business.abn}`, 'TAX INVOICE', '',
    ...lines.map(([k, v]) => `${k}: ${v}`), `Total paid (incl. GST): ${money(o.total)}`, '',
    next, link ? `Download: ${link}` : '', '', `View online: ${opts.receiptUrl}`,
  ].filter((l, i, a) => l || a[i - 1]).join('\n');
  return {
    to: o.email,
    subject: `Your ${business.tradingName} order ${orderNo(o.order_no)}`,
    html, text,
    attachments: link && opts.pdf ? [{ filename: opts.pdf.name, content: opts.pdf.data }] : undefined,
  };
}

export function downloadEmail(o: Order, c: Concert, pdfUrl: string | null): Mail {
  const html = shell('Your concert video is ready', `
<p style="margin:0 0 12px">The video of ${esc(concertName(c))}${o.nights_text ? ' (' + esc(o.nights_text) + ')' : ''} is ready to watch and save.</p>
${button(c.download_url, 'Watch and download')}
${pdfUrl ? `<p style="margin:0 0 12px"><a href="${esc(pdfUrl)}" style="color:${plum}">Download the concert PDF</a></p>` : ''}
<p style="margin:0;font-size:13px;color:${muted}">Order ${esc(orderNo(o.order_no))}. On a phone, save the video to your Files app. Questions? Reply to this email.</p>`);
  const text = [
    `The video of ${concertName(c)}${o.nights_text ? ' (' + o.nights_text + ')' : ''} is ready.`, '',
    `Watch and download: ${c.download_url}`, pdfUrl ? `Concert PDF: ${pdfUrl}` : '', '', `Order ${orderNo(o.order_no)}`,
  ].join('\n');
  return { to: o.email, subject: `Your concert video is ready: ${c.school}`, html, text };
}

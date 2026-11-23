// Cloudflare Pages Function: handles the contact form on /contact/.
// Sends the enquiry to Aidem Media by email through Resend.
//
// Settings (Cloudflare Pages > aidem-media-website > Settings > Variables and secrets):
//   RESEND_API_KEY  (secret, required)
//   TO_EMAIL        (optional, default info@aidemmedia.com.au)
//   FROM_EMAIL      (optional, default website@aidemmedia.com.au, must be on a domain verified in Resend)

const EVENT_TYPES = ['School concert', 'Graduation', 'Dance concert', 'Corporate event', 'Funeral', 'Something else'];

function clean(value, max) {
  return String(value ?? '').replace(/\r/g, '').trim().slice(0, max);
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function back(request, path) {
  return Response.redirect(new URL(path, request.url).toString(), 303);
}

export async function onRequestPost({ request, env }) {
  let form;
  try {
    form = await request.formData();
  } catch {
    return back(request, '/contact/?error=1#form');
  }

  // Spam trap: real people never fill this hidden field.
  if (clean(form.get('company'), 200)) return back(request, '/contact/sent/');

  const name = clean(form.get('name'), 120);
  const email = clean(form.get('email'), 200);
  const phone = clean(form.get('phone'), 40);
  const eventType = EVENT_TYPES.includes(form.get('event')) ? form.get('event') : 'Not given';
  const eventDate = clean(form.get('date'), 60);
  const message = clean(form.get('message'), 5000);

  if (!name || !message || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return back(request, '/contact/?error=1#form');
  }
  if (!env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY is not set');
    return back(request, '/contact/?error=2#form');
  }

  const rows = [
    ['Name', name], ['Email', email], ['Phone', phone || 'Not given'],
    ['Event', eventType], ['Date', eventDate || 'Not given'],
  ];
  const text = rows.map(([k, v]) => `${k}: ${v}`).join('\n') + `\n\n${message}`;
  const html = `<table cellpadding="4">${rows.map(([k, v]) => `<tr><td><strong>${k}</strong></td><td>${escapeHtml(v)}</td></tr>`).join('')}</table><p style="white-space:pre-wrap">${escapeHtml(message)}</p>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: `Aidem Media website <${env.FROM_EMAIL || 'website@aidemmedia.com.au'}>`,
      to: [env.TO_EMAIL || 'info@aidemmedia.com.au'],
      reply_to: email,
      subject: `Website enquiry: ${eventType} (${name})`,
      text,
      html,
    }),
  });

  if (!res.ok) {
    console.error('Resend error', res.status, await res.text());
    return back(request, '/contact/?error=2#form');
  }
  return back(request, '/contact/sent/');
}

// Aidem Media orders admin
(() => {
  const app = document.getElementById('app');
  const dlg = document.getElementById('dlg');
  const dlgBody = document.getElementById('dlg-body');
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (c) => '$' + ((c || 0) / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const dollars = (c) => ((c || 0) / 100).toFixed(2);
  const toCents = (v) => Math.round(parseFloat(String(v).replace(/[$,\s]/g, '')) * 100);
  const when = (s) => s ? new Date(s.replace(' ', 'T') + (s.includes('Z') ? '' : 'Z')).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '';
  const dateText = (d) => d ? new Date(d + 'T12:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' }) : '';

  let me = null;
  let concerts = [];

  async function api(path, opts = {}) {
    const method = opts.method || (opts.body ? 'POST' : 'GET');
    const res = await fetch('/api/admin/' + path, {
      method,
      headers: method === 'GET' ? {} : { 'content-type': 'application/json' },
      body: method === 'GET' ? undefined : JSON.stringify(opts.body || {}),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && path !== 'login') { showLogin(); throw new Error('Please sign in.'); }
    if (!res.ok) throw new Error(data.error || 'Something went wrong.');
    return data;
  }

  function flash(el, msg, ok) {
    el.className = ok ? 'okmsg' : 'error';
    el.textContent = msg;
    el.hidden = false;
  }

  function busy(btn, on, label) {
    if (!btn) return;
    if (on) { btn.dataset.label = btn.textContent; btn.textContent = label || 'Working…'; btn.disabled = true; }
    else { btn.textContent = btn.dataset.label || btn.textContent; btn.disabled = false; }
  }

  // ---------- sign in ----------
  function showLogin() {
    $('#tabs').hidden = true;
    app.innerHTML = `
      <div class="stack" style="max-width:420px"><span class="label">Admin</span><h1>Sign in</h1></div>
      <form class="card" id="login" style="max-width:420px">
        <label class="field">Password<input type="password" id="pw" autocomplete="current-password" required></label>
        <p class="error" id="login-err" hidden></p>
        <div><button class="btn" type="submit">Sign in</button></div>
      </form>`;
    $('#pw').focus();
    $('#login').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('button', e.target);
      busy(btn, true, 'Signing in…');
      try { await api('login', { body: { password: $('#pw').value } }); start(); }
      catch (err) { flash($('#login-err'), err.message); busy(btn, false); }
    });
  }

  async function start() {
    try { me = await api('me'); } catch { return; }
    $('#tabs').hidden = false;
    $('#test-notice').hidden = !me.setup.test;
    route();
  }

  // ---------- routing ----------
  function route() {
    const [tab, id, sub] = (location.hash.slice(1) || 'concerts').split('/');
    $$('#tabs [data-tab]').forEach((b) => b.setAttribute('aria-current', b.dataset.tab === tab ? 'page' : 'false'));
    if (tab === 'concerts' && id === 'new') return editConcert(null);
    if (tab === 'concerts' && id && sub === 'edit') return editConcert(Number(id));
    if (tab === 'concerts' && id && sub === 'classlist') return classList(Number(id));
    if (tab === 'concerts' && id) return concertView(Number(id));
    if (tab === 'find') return findView();
    if (tab === 'discounts') return discountsView();
    if (tab === 'setup') return setupView();
    return concertsView();
  }
  window.addEventListener('hashchange', route);
  $('#tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (b) location.hash = b.dataset.tab;
  });
  $('#logout').addEventListener('click', async () => { await api('logout', { body: {} }).catch(() => {}); showLogin(); });

  function statusPill(c) {
    if (!c.visible) return '<span class="pill closed">Hidden</span>';
    if (c.orders_close && c.orders_close < new Date().toISOString().slice(0, 10)) return '<span class="pill closed">Orders closed</span>';
    return c.bulk ? `<span class="pill open">USB or download${c.usb_cutoff ? ' to ' + esc(dateText(c.usb_cutoff)) : ''}</span>` : '<span class="pill warn">Download only</span>';
  }

  // ---------- concerts list ----------
  async function concertsView() {
    app.innerHTML = '<p class="muted">Loading…</p>';
    const r = await api('concerts');
    concerts = r.concerts;
    const setupGaps = [];
    if (!me.setup.stripe && !me.setup.paypal) setupGaps.push('payments');
    if (!me.setup.email) setupGaps.push('email');
    app.innerHTML = `
      <div class="row" style="justify-content:space-between"><div class="stack"><span class="label">Admin</span><h1>Concerts</h1></div><a class="btn" href="#concerts/new">New concert</a></div>
      ${setupGaps.length ? `<p class="banner warn">Not set up yet: ${setupGaps.join(' and ')}. See <a href="#setup">Setup</a>.</p>` : ''}
      ${concerts.length ? `<div class="tablewrap"><table class="data">
        <thead><tr><th>School</th><th>Concert</th><th>Status</th><th class="num">Paid orders</th><th class="num">USB</th><th class="num">Download</th><th class="num">Links to send</th><th class="num">Takings</th></tr></thead>
        <tbody>${concerts.map((c) => `<tr class="click" data-id="${c.id}">
          <td><strong>${esc(c.school)}</strong></td><td>${esc(c.title)}<br><span class="small muted">${esc(c.performed)}</span></td><td>${statusPill(c)}</td>
          <td class="num">${c.paid}</td><td class="num">${c.usb}</td><td class="num">${c.download}</td><td class="num">${c.links_waiting || ''}</td><td class="num">${money(c.takings)}</td></tr>`).join('')}
        </tbody></table></div>` : '<p class="empty">No concerts yet. Press New concert to set one up.</p>'}`;
    $$('tr.click', app).forEach((tr) => tr.addEventListener('click', () => { location.hash = 'concerts/' + tr.dataset.id; }));
  }

  // ---------- one concert ----------
  async function concertView(id) {
    app.innerHTML = '<p class="muted">Loading…</p>';
    const { concert: c, nights, pdf, logo } = await api('concerts/' + id);
    const list = await api('concerts');
    const stats = list.concerts.find((x) => x.id === id) || {};
    app.innerHTML = `
      <a class="back" href="#concerts">All concerts</a>
      <div class="row" style="justify-content:space-between;align-items:flex-start">
        <div class="school-head">${logo ? `<span class="crest lg"><img src="${esc(logo)}" alt=""></span>` : ''}<div class="stack" style="gap:6px"><span class="label">${esc(c.school)}</span><h1>${esc(c.title)}</h1><div class="row">${statusPill(c)}<span class="small muted">Access code <strong>${esc(c.access_code)}</strong></span></div></div></div>
        <a class="btn ghost" href="#concerts/${id}/edit">Edit concert</a>
      </div>
      <div class="stats">
        <div class="stat"><b>${stats.paid || 0}</b><span>Paid orders</span></div>
        <div class="stat"><b>${stats.usb || 0}</b><span>USB</span></div>
        <div class="stat"><b>${stats.download || 0}</b><span>Download</span></div>
        <div class="stat"><b>${money(stats.takings)}</b><span>Takings after refunds</span></div>
        ${c.commission_pct ? `<div class="stat"><b>${money(Math.round((stats.takings || 0) * c.commission_pct / 100))}</b><span>School commission (${c.commission_pct}%)</span></div>` : ''}
        ${nights.length > 1 ? nights.map((n) => `<div class="stat"><b>${n.paid}</b><span>${esc(n.label)}</span></div>`).join('') : ''}
      </div>

      <div class="card">
        <div class="filters">
          ${nights.length > 1 ? `<label class="field">Night<select id="f-night"><option value="">All nights</option>${nights.map((n) => `<option value="${n.id}">${esc(n.label)}</option>`).join('')}</select></label>` : ''}
          <label class="field">Format<select id="f-format"><option value="">USB and download</option><option value="usb">USB only</option><option value="download">Download only</option></select></label>
          <label class="field">Show<select id="f-status"><option value="paid">Paid</option><option value="refunded">Refunded</option><option value="pending">Unfinished checkouts</option><option value="all">Everything</option></select></label>
          <label class="field">Search<input id="f-q" placeholder="Order no, email, student or class"></label>
        </div>
        <div class="row">
          <a class="btn ghost sm" id="x-orders">Download spreadsheet</a>
          <a class="btn ghost sm" id="x-class">Printable class list</a>
          <a class="btn ghost sm" id="x-emails">Download parent emails</a>
        </div>
      </div>

      <div class="card">
        <div class="row" style="justify-content:space-between"><h2>Download links</h2><span class="small muted">${me.emailsToday} emails sent today (free plan allows 100 a day)</span></div>
        <p class="muted small">${c.download_url ? `Link: <a href="${esc(c.download_url)}" target="_blank" rel="noopener">${esc(c.download_url)}</a>${pdf ? ` · PDF: ${esc(pdf.name)}` : ''}` : 'Add the Aidem Media Downloads link in Edit concert before sending.'}</p>
        <p class="small">${stats.links_waiting ? `<strong>${stats.links_waiting}</strong> download ${stats.links_waiting === 1 ? 'order is' : 'orders are'} waiting for a link.` : 'Every paid download order has been sent its link.'} Orders placed after USB orders close get their link automatically.</p>
        <div class="row"><label class="field" style="max-width:140px">Send up to<input id="send-limit" type="number" min="1" max="100" value="${Math.max(1, Math.min(90, 100 - me.emailsToday))}"></label>
        <button class="btn" id="send-links" ${!stats.links_waiting || !c.download_url ? 'disabled' : ''}>Send download links</button></div>
        <p id="send-msg" hidden></p>
      </div>

      <div id="orders"></div>`;

    const filters = () => {
      const p = new URLSearchParams({ concert: id });
      const n = $('#f-night')?.value, f = $('#f-format').value, s = $('#f-status').value, q = $('#f-q').value.trim();
      if (n) p.set('night', n);
      if (f) p.set('format', f);
      if (s) p.set('status', s);
      if (q) p.set('q', q);
      return p;
    };
    const refresh = async () => {
      const p = filters();
      const exp = new URLSearchParams(p); exp.delete('status'); exp.delete('q');
      $('#x-orders').href = '/api/admin/export/orders.csv?' + exp;
      $('#x-emails').href = '/api/admin/export/emails.csv?' + exp;
      $('#x-class').href = `#concerts/${id}/classlist${p.get('night') ? '/' + p.get('night') : ''}`;
      const r = await api('orders?' + p);
      renderOrders($('#orders'), r.orders, false);
    };
    let t = 0;
    $$('select, input#f-q', app).forEach((el) => el.addEventListener('input', () => { clearTimeout(t); t = setTimeout(refresh, 200); }));
    $('#send-links').addEventListener('click', async (e) => {
      const n = Number($('#send-limit').value) || 90;
      if (!confirm(`Email download links to up to ${n} parents now?`)) return;
      busy(e.target, true, 'Sending…');
      try {
        const r = await api('send-links', { body: { concertId: id, limit: n } });
        me = await api('me');
        flash($('#send-msg'), `Sent ${r.sent}. ${r.remaining ? r.remaining + ' still to send (send more tomorrow if you reach the daily limit).' : 'All done.'}`, true);
        setTimeout(() => concertView(id), 2500);
      } catch (err) { flash($('#send-msg'), err.message); busy(e.target, false); }
    });
    refresh();
  }

  function renderOrders(el, orders, showConcert) {
    if (!orders.length) { el.innerHTML = '<p class="empty">No orders match.</p>'; return; }
    el.innerHTML = `<div class="tablewrap"><table class="data">
      <thead><tr><th>Order</th>${showConcert ? '<th>Concert</th>' : ''}<th>Class</th><th>Student</th><th>Format</th><th>Nights</th><th>Email</th><th class="num">Total</th><th>Status</th></tr></thead>
      <tbody>${orders.map((o) => `<tr class="click" data-id="${o.id}">
        <td><strong>${esc(o.orderNo || '—')}</strong><br><span class="small muted">${esc(when(o.paid_at || o.created_at))}</span></td>
        ${showConcert ? `<td>${esc(o.school)}<br><span class="small muted">${esc(o.title)}</span></td>` : ''}
        <td>${esc(o.class || '')}</td><td>${esc(o.student || '')}</td><td>${o.format === 'usb' ? 'USB' : 'Download'}</td><td class="small">${esc(o.nights_text)}</td>
        <td class="small">${esc(o.email)}</td><td class="num">${money(o.total)}${o.discount_code ? `<br><span class="small muted">${esc(o.discount_code)}</span>` : ''}</td>
        <td>${o.status === 'paid' ? (o.refund_amount ? '<span class="pill warn">Part refunded</span>' : o.format === 'download' ? (o.download_sent_at ? '<span class="pill open">Link sent</span>' : '<span class="pill closed">Paid, link to send</span>') : '<span class="pill open">Paid</span>') : o.status === 'refunded' ? '<span class="pill err">Refunded</span>' : '<span class="pill closed">Not paid</span>'}${o.note ? ' <span title="Has a note">•</span>' : ''}</td>
      </tr>`).join('')}</tbody></table></div><p class="small muted" style="margin-top:8px">${orders.length} order${orders.length === 1 ? '' : 's'}</p>`;
    $$('tr.click', el).forEach((tr) => tr.addEventListener('click', () => orderDialog(tr.dataset.id)));
  }

  // ---------- order detail ----------
  async function orderDialog(id) {
    const { order: o, concert: c } = await api('orders/' + id);
    const left = o.total - o.refund_amount;
    dlgBody.innerHTML = `
      <div class="row" style="justify-content:space-between"><h2>${esc(o.orderNo || 'Unpaid checkout')}</h2><button class="btn ghost sm" id="dlg-close">Close</button></div>
      <dl class="kv">
        <dt>Concert</dt><dd>${esc(c.school)}, ${esc(c.title)}</dd>
        ${o.nights_text ? `<dt>Nights</dt><dd>${esc(o.nights_text)}</dd>` : ''}
        <dt>Format</dt><dd>${o.format === 'usb' ? 'USB' : 'Download'}${o.phase === 'after' ? ' (ordered after USB orders closed)' : ''}</dd>
        <dt>Price</dt><dd>${money(o.subtotal)}${o.discount ? ` − ${money(o.discount)} (${esc(o.discount_code)})` : ''} = <strong>${money(o.total)}</strong> incl. GST</dd>
        <dt>Paid</dt><dd>${o.paid_at ? esc(when(o.paid_at)) + ' by ' + esc(o.provider) : 'Not paid'}</dd>
        ${o.refund_amount ? `<dt>Refunded</dt><dd>${money(o.refund_amount)} on ${esc(when(o.refunded_at))}</dd>` : ''}
        <dt>Receipt emailed</dt><dd>${o.receipt_sent_at ? esc(when(o.receipt_sent_at)) : 'No'}</dd>
        ${o.format === 'download' ? `<dt>Download link</dt><dd>${o.download_sent_at ? 'Sent ' + esc(when(o.download_sent_at)) : 'Not sent yet'}</dd>` : ''}
      </dl>
      <form id="o-edit" class="stack">
        <div class="grid2">
          <label class="field">Student<input name="student" value="${esc(o.student || '')}"></label>
          <label class="field">Class<input name="class" value="${esc(o.class || '')}"></label>
        </div>
        <label class="field">Email<input name="email" type="email" value="${esc(o.email)}"></label>
        <label class="field">Note (only you see this)<input name="note" value="${esc(o.note || '')}"></label>
        <div><button class="btn ghost sm" type="submit">Save changes</button></div>
      </form>
      ${o.status !== 'pending' ? `<div class="row">
        <button class="btn ghost sm" id="o-resend">Resend receipt</button>
        ${o.status === 'paid' && o.format === 'download' ? `<button class="btn ghost sm" id="o-link">${o.download_sent_at ? 'Resend' : 'Send'} download link</button>` : ''}
        <a class="btn ghost sm" href="/receipt.html?o=${esc(o.id)}&t=${esc(o.token)}" target="_blank" rel="noopener">View receipt</a>
      </div>` : ''}
      ${o.status === 'paid' && left > 0 ? `<form id="o-refund" class="row" style="align-items:end">
        <label class="field" style="max-width:160px">Refund amount<input name="amount" value="${dollars(left)}" inputmode="decimal"></label>
        <button class="btn danger sm" type="submit">Refund</button>
      </form>` : ''}
      <p id="o-msg" hidden></p>`;
    dlg.showModal();
    const msg = $('#o-msg', dlgBody);
    $('#dlg-close', dlgBody).addEventListener('click', () => dlg.close());
    $('#o-edit', dlgBody).addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      try { await api('orders/' + id, { method: 'PUT', body: Object.fromEntries(f) }); flash(msg, 'Saved.', true); }
      catch (err) { flash(msg, err.message); }
    });
    $('#o-resend', dlgBody)?.addEventListener('click', async (e) => {
      busy(e.target, true, 'Sending…');
      try { await api(`orders/${id}/resend`, { body: {} }); flash(msg, 'Receipt sent to ' + o.email + '.', true); }
      catch (err) { flash(msg, err.message); }
      busy(e.target, false);
    });
    $('#o-link', dlgBody)?.addEventListener('click', async (e) => {
      busy(e.target, true, 'Sending…');
      try { await api(`orders/${id}/send-link`, { body: {} }); flash(msg, 'Download link sent to ' + o.email + '.', true); }
      catch (err) { flash(msg, err.message); }
      busy(e.target, false);
    });
    $('#o-refund', dlgBody)?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const amount = toCents(new FormData(e.target).get('amount'));
      if (!(amount > 0)) return flash(msg, 'Enter the refund amount.');
      if (!confirm(`Refund ${money(amount)} to the parent's ${o.provider === 'paypal' ? 'PayPal' : 'card'}? This can't be undone.`)) return;
      const btn = $('button', e.target);
      busy(btn, true, 'Refunding…');
      try { await api(`orders/${id}/refund`, { body: { amount } }); flash(msg, 'Refunded ' + money(amount) + '.', true); setTimeout(() => { dlg.close(); route(); }, 1200); }
      catch (err) { flash(msg, err.message); busy(btn, false); }
    });
  }
  dlg.addEventListener('close', () => { dlgBody.innerHTML = ''; });

  // ---------- concert editor ----------
  async function editConcert(id) {
    let c = { school: '', title: '', performed: '', access_code: randomCode(), visible: 0, usb_enabled: 1, usb_cutoff: '', orders_close: '',
      price_usb: 4000, price_download: 3500, class_list: '', download_url: '', commission_pct: 0, delete_students_after: '' };
    let nights = [], pdf = null, logo = null;
    if (id) ({ concert: c, nights, pdf, logo } = await api('concerts/' + id));
    const extras = { logo: undefined, pdf: undefined };
    app.innerHTML = `
      <a class="back" href="${id ? '#concerts/' + id : '#concerts'}">Back</a>
      <div class="stack"><span class="label">${id ? 'Edit concert' : 'New concert'}</span><h1>${id ? esc(c.school) : 'Set up a concert'}</h1></div>
      <form class="step" id="cform" novalidate>
        <div class="card">
          <h2>School and concert</h2>
          <div class="grid2">
            <label class="field">School name<input name="school" value="${esc(c.school)}" required></label>
            <label class="field">Concert name<span class="hint">For example "Christmas Concert 2027"</span><input name="title" value="${esc(c.title)}" required></label>
          </div>
          <div class="grid2">
            <label class="field">When it's on<span class="hint">Shown to parents, for example "Thursday 9 December"</span><input name="performed" value="${esc(c.performed)}"></label>
            <label class="field">Access code<span class="hint">Printed on the note that goes home. Letters and numbers.</span><input name="access_code" value="${esc(c.access_code)}" required autocapitalize="characters"></label>
          </div>
          <div class="field">School logo<span class="hint">PNG or JPG. Shown next to the school name.</span>
            <div class="row"><span class="crest lg" id="logo-prev">${logo ? `<img src="${esc(logo)}" alt="">` : ''}</span><input type="file" id="logo" accept="image/png,image/jpeg,image/webp"><button type="button" class="linkbtn" id="logo-remove" ${logo ? '' : 'hidden'}>Remove logo</button></div>
          </div>
          <label class="check"><input type="checkbox" name="visible" ${c.visible ? 'checked' : ''}> Show this concert on the order page</label>
        </div>

        <div class="card">
          <h2>Nights</h2>
          <p class="muted small">Leave this empty for a one-night concert. Add each night for multi-night shows. Parents tick the nights they want and pay per night.</p>
          <div class="stack" id="nights"></div>
          <div><button type="button" class="btn ghost sm" id="add-night">Add a night</button></div>
        </div>

        <div class="card">
          <h2>Prices and dates</h2>
          <div class="grid2">
            <label class="field">USB price (incl. GST)<input name="price_usb" value="${dollars(c.price_usb)}" inputmode="decimal"></label>
            <label class="field">Download price (incl. GST)<input name="price_download" value="${dollars(c.price_download)}" inputmode="decimal"></label>
          </div>
          <label class="check"><input type="checkbox" name="usb_enabled" ${c.usb_enabled ? 'checked' : ''}> Take USB orders (bulk period with student name and class)</label>
          <div class="grid2">
            <label class="field">Last day for USB orders<span class="hint">After this day it switches to download only and links are emailed automatically.</span><input type="date" name="usb_cutoff" value="${esc(c.usb_cutoff || '')}"></label>
            <label class="field">Stop all orders after (optional)<input type="date" name="orders_close" value="${esc(c.orders_close || '')}"></label>
          </div>
        </div>

        <div class="card">
          <h2>Classes</h2>
          <label class="field">Class list (optional)<span class="hint">One class per line, for example 3B. If you add a list, parents choose from it instead of typing.</span><textarea name="class_list">${esc(c.class_list)}</textarea></label>
        </div>

        <div class="card">
          <h2>Video delivery</h2>
          <label class="field">Aidem Media Downloads link<span class="hint">For example https://downloads.aidemmedia.com.au/d/2027/school-christmas-concert</span><input name="download_url" value="${esc(c.download_url)}" inputmode="url"></label>
          <div class="field">Concert PDF (optional)<span class="hint">Attached to download emails sent at checkout. Under 1 MB.</span>
            <div class="row"><input type="file" id="pdf" accept="application/pdf"><span class="small" id="pdf-name">${pdf ? esc(pdf.name) : ''}</span><button type="button" class="linkbtn" id="pdf-remove" ${pdf ? '' : 'hidden'}>Remove PDF</button></div>
          </div>
        </div>

        <div class="card">
          <h2>Privacy and commission</h2>
          <label class="field">Delete student names and classes after<span class="hint">Leave a few weeks after USBs go home. Orders and receipts are kept.</span><input type="date" name="delete_students_after" value="${esc(c.delete_students_after || '')}"></label>
          <label class="field" style="max-width:240px">School commission % (optional)<input name="commission_pct" value="${esc(c.commission_pct || '')}" inputmode="decimal"></label>
        </div>

        <p class="error" id="c-err" role="alert" hidden></p>
        <div class="row"><button class="btn" type="submit">${id ? 'Save changes' : 'Create concert'}</button>${id ? '<button type="button" class="btn danger" id="c-delete">Delete concert</button>' : ''}</div>
      </form>`;

    const nightBox = $('#nights');
    const addNight = (n = { id: 0, label: '' }) => {
      const div = document.createElement('div');
      div.className = 'nightrow';
      div.innerHTML = `<input class="field" style="font:inherit;padding:10px 12px;border:1px solid var(--field);border-radius:4px;min-height:44px" placeholder="For example Tuesday 9 December" value="${esc(n.label)}" data-id="${n.id || ''}" aria-label="Night"><button type="button" class="btn ghost sm">Remove</button>`;
      $('button', div).addEventListener('click', () => div.remove());
      nightBox.appendChild(div);
    };
    nights.forEach(addNight);
    $('#add-night').addEventListener('click', () => addNight());
    if (!nights.length) nightBox.innerHTML = '';

    $('#logo').addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      extras.logo = await resizeImage(f, 320);
      $('#logo-prev').innerHTML = `<img src="${extras.logo}" alt="">`;
      $('#logo-remove').hidden = false;
    });
    $('#logo-remove').addEventListener('click', () => { extras.logo = null; $('#logo-prev').innerHTML = ''; $('#logo').value = ''; $('#logo-remove').hidden = true; });
    $('#pdf').addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      if (f.size > 1_000_000) { flash($('#c-err'), 'That PDF is over 1 MB. Export a smaller one.'); e.target.value = ''; return; }
      extras.pdf = { name: f.name, data: await readDataUrl(f) };
      $('#pdf-name').textContent = f.name;
      $('#pdf-remove').hidden = false;
    });
    $('#pdf-remove').addEventListener('click', () => { extras.pdf = null; $('#pdf-name').textContent = ''; $('#pdf').value = ''; $('#pdf-remove').hidden = true; });

    $('#c-delete')?.addEventListener('click', async () => {
      if (!confirm('Delete this concert? Only possible if nobody has paid.')) return;
      try { await api('concerts/' + id, { method: 'DELETE' }); location.hash = 'concerts'; }
      catch (err) { flash($('#c-err'), err.message); }
    });

    $('#cform').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const body = {
        school: f.get('school'), title: f.get('title'), performed: f.get('performed'), access_code: f.get('access_code'),
        visible: f.get('visible') === 'on', usb_enabled: f.get('usb_enabled') === 'on',
        usb_cutoff: f.get('usb_cutoff'), orders_close: f.get('orders_close'),
        price_usb: toCents(f.get('price_usb')), price_download: toCents(f.get('price_download')),
        class_list: f.get('class_list'), download_url: f.get('download_url'),
        commission_pct: f.get('commission_pct'), delete_students_after: f.get('delete_students_after'),
        nights: $$('input', nightBox).map((i) => ({ id: Number(i.dataset.id) || 0, label: i.value.trim() })).filter((n) => n.label),
      };
      if (!(body.price_usb >= 0) || !(body.price_download >= 0)) return flash($('#c-err'), 'Check the prices.');
      if (extras.logo !== undefined) body.logo = extras.logo;
      if (extras.pdf !== undefined) body.pdf = extras.pdf;
      const btn = e.submitter;
      busy(btn, true, 'Saving…');
      try {
        const r = await api(id ? 'concerts/' + id : 'concerts', { method: id ? 'PUT' : 'POST', body });
        location.hash = 'concerts/' + r.id;
      } catch (err) { flash($('#c-err'), err.message); busy(btn, false); }
    });
  }

  function randomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const a = crypto.getRandomValues(new Uint8Array(6));
    return Array.from(a, (b) => chars[b % chars.length]).join('');
  }

  function readDataUrl(file) {
    return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
  }

  async function resizeImage(file, max) {
    const url = await readDataUrl(file);
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const cv = document.createElement('canvas');
    cv.width = Math.round(img.width * scale); cv.height = Math.round(img.height * scale);
    cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
    return cv.toDataURL('image/png');
  }

  // ---------- printable class list ----------
  async function classList(id) {
    const night = (location.hash.split('/')[3] || '');
    const p = new URLSearchParams({ concert: id }); if (night) p.set('night', night);
    const r = await api('classlist?' + p);
    const groups = {};
    r.rows.forEach((o) => { (groups[o.class || 'No class'] ||= []).push(o); });
    const names = Object.keys(groups).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
    app.innerHTML = `
      <div class="row noprint"><a class="back" href="#concerts/${id}">Back</a><button class="btn sm" id="print">Print</button>
        <label class="check small"><input type="checkbox" id="usb-only" checked> USB orders only (for sending USBs home)</label></div>
      <div class="stack"><span class="label">${esc(r.concert.school)}</span><h1>${esc(r.concert.title)}${r.night ? ' · ' + esc(r.night) : ''}</h1><p class="muted">Class list · ${r.rows.length} paid orders</p></div>
      <div id="groups"></div>`;
    const render = () => {
      const usbOnly = $('#usb-only').checked;
      $('#groups').innerHTML = names.map((k, i) => {
        const rows = groups[k].filter((o) => !usbOnly || o.format === 'usb');
        if (!rows.length) return '';
        return `<section class="${i ? 'pagebreak' : ''}" style="padding-block:20px 8px"><h2 style="margin-bottom:10px">Class ${esc(k)} <span class="small muted">(${rows.length})</span></h2>
          <div class="tablewrap"><table class="data"><thead><tr><th>Student</th><th>Format</th><th>Nights</th><th>Order</th><th>Done</th></tr></thead>
          <tbody>${rows.map((o) => `<tr><td>${esc(o.student || '')}</td><td>${o.format === 'usb' ? 'USB' : 'Download'}${o.qty > 1 ? ' × ' + o.qty : ''}</td><td>${esc(o.nights_text)}</td><td>${esc(o.orderNo)}</td><td>☐</td></tr>`).join('')}</tbody></table></div></section>`;
      }).join('') || '<p class="empty">No orders to list.</p>';
    };
    $('#usb-only').addEventListener('change', render);
    $('#print').addEventListener('click', () => window.print());
    render();
  }

  // ---------- find ----------
  function findView() {
    app.innerHTML = `
      <div class="stack"><span class="label">Admin</span><h1>Find an order</h1></div>
      <form class="card" id="find"><div class="filters">
        <label class="field" style="flex:3 1 260px">Order number, email, student or class<input id="q" autofocus></label>
        <label class="field">Show<select id="s"><option value="all">Everything</option><option value="paid">Paid</option><option value="refunded">Refunded</option></select></label>
        <div><button class="btn" type="submit">Search</button></div>
      </div></form>
      <div id="results"></div>`;
    $('#find').addEventListener('submit', async (e) => {
      e.preventDefault();
      const q = $('#q').value.trim();
      if (!q) return;
      const r = await api('orders?' + new URLSearchParams({ q, status: $('#s').value }));
      renderOrders($('#results'), r.orders.filter((o) => o.status !== 'pending' || $('#s').value === 'all'), true);
    });
  }

  // ---------- discounts ----------
  async function discountsView() {
    const [{ discounts }, { concerts: cs }] = await Promise.all([api('discounts'), api('concerts')]);
    app.innerHTML = `
      <div class="stack"><span class="label">Admin</span><h1>Discount codes</h1></div>
      <form class="card" id="dform">
        <h2>New code</h2>
        <div class="grid3">
          <label class="field">Code<input name="code" required autocapitalize="characters" placeholder="e.g. STAFF20"></label>
          <label class="field">Type<select name="kind"><option value="percent">Percent off</option><option value="amount">Dollars off</option></select></label>
          <label class="field">Amount<span class="hint">Percent, or dollars off the order</span><input name="value" required inputmode="decimal"></label>
        </div>
        <div class="grid2">
          <label class="field">Concert<select name="concert_id"><option value="">Any concert</option>${cs.map((c) => `<option value="${c.id}">${esc(c.school)}, ${esc(c.title)}</option>`).join('')}</select></label>
          <label class="field">Maximum uses (optional)<input name="max_uses" inputmode="numeric"></label>
        </div>
        <p id="d-msg" hidden></p>
        <div><button class="btn" type="submit">Add code</button></div>
      </form>
      ${discounts.length ? `<div class="tablewrap"><table class="data"><thead><tr><th>Code</th><th>Discount</th><th>Concert</th><th class="num">Used</th><th>Status</th><th></th></tr></thead><tbody>
        ${discounts.map((d) => `<tr><td><strong>${esc(d.code)}</strong></td><td>${d.kind === 'percent' ? d.value + '%' : money(d.value)} off</td><td>${d.concert_id ? esc(d.school + ', ' + d.title) : 'Any'}</td>
        <td class="num">${d.uses}${d.max_uses ? ' of ' + d.max_uses : ''}</td><td>${d.active ? '<span class="pill open">On</span>' : '<span class="pill closed">Off</span>'}</td>
        <td><div class="row"><button class="btn ghost sm" data-toggle="${esc(d.code)}" data-on="${d.active ? 0 : 1}">${d.active ? 'Turn off' : 'Turn on'}</button>${d.uses ? '' : `<button class="btn danger sm" data-del="${esc(d.code)}">Delete</button>`}</div></td></tr>`).join('')}
      </tbody></table></div>` : '<p class="empty">No discount codes yet.</p>'}`;
    $('#dform').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      if (f.kind === 'amount') f.value = toCents(f.value);
      try { await api('discounts', { body: f }); discountsView(); }
      catch (err) { flash($('#d-msg'), err.message); }
    });
    $$('[data-toggle]').forEach((b) => b.addEventListener('click', async () => { await api('discounts/' + encodeURIComponent(b.dataset.toggle), { method: 'PUT', body: { active: b.dataset.on === '1' } }); discountsView(); }));
    $$('[data-del]').forEach((b) => b.addEventListener('click', async () => { if (confirm('Delete ' + b.dataset.del + '?')) { await api('discounts/' + encodeURIComponent(b.dataset.del), { method: 'DELETE' }); discountsView(); } }));
  }

  // ---------- setup ----------
  async function setupView() {
    me = await api('me');
    const s = me.setup;
    const item = (ok, text, warn) => `<li>${ok ? '<span class="pill open">Done</span>' : `<span class="pill ${warn ? 'warn' : 'err'}">To do</span>`} ${text}</li>`;
    app.innerHTML = `
      <div class="stack"><span class="label">Admin</span><h1>Setup</h1><p class="muted">These are set in Cloudflare Pages under Settings, Variables and secrets. The README in the repository has the steps.</p></div>
      <div class="card"><ul class="setup" style="list-style:none;padding:0;margin:0;display:grid;gap:8px">
        ${item(s.stripe, `Stripe card payments${s.stripe ? (s.stripeLive ? ' (live)' : ' (test keys)') : ''}`)}
        ${item(s.stripeWebhook, 'Stripe webhook secret (confirms payments if a parent closes their browser)')}
        ${item(s.paypal, `PayPal${s.paypal ? (s.paypalLive ? ' (live)' : ' (sandbox)') : ''}`)}
        ${item(s.email, 'Resend email (receipts and download links)')}
        ${item(!!s.emailFrom, `Sending address${s.emailFrom ? ': ' + esc(s.emailFrom) : ' (until set, emails can only go to your own Resend sign-up address)'}`)}
        ${item(!s.test, s.test ? 'Test payments are ON. Turn off before going live.' : 'Test payments are off', true)}
      </ul></div>
      <p class="small muted">${me.emailsToday} emails sent today. Resend's free plan allows 100 a day and 3,000 a month.</p>`;
  }

  start();
})();

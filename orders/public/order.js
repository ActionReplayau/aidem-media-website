// Parent ordering: school > access code > order details > pay > receipt
(() => {
  const $ = (id) => document.getElementById(id);
  const money = (c) => '$' + (c / 100).toFixed(2);
  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k) { try { return JSON.parse(sessionStorage.getItem(k) || 'null'); } catch { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };

  let config = { stripe: false, paypal: false, test: false };
  let schools = [];
  let concert = null; // unlocked concert details
  let code = '';
  let quoteTimer = 0;
  let lastQuote = null;

  async function api(path, body) {
    const res = await fetch(path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
    return data;
  }

  function go(n) {
    for (let i = 1; i <= 4; i++) $('s' + i).hidden = i !== n;
    document.querySelectorAll('#progress li').forEach((li, i) => li.classList.toggle('done', i < n));
    window.scrollTo(0, 0);
  }

  function crest(c, lg) {
    const initials = c.school.split(/\s+/).filter((w) => /^[A-Z]/i.test(w)).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
    return `<span class="crest${lg ? ' lg' : ''}" aria-hidden="true">${c.logo ? `<img src="${esc(c.logo)}" alt="">` : esc(initials)}</span>`;
  }

  function renderSchools() {
    if (!schools.length) {
      $('schools').innerHTML = `<p class="empty">No concerts are taking orders right now. If you were expecting one, email <a href="mailto:${esc(config.email || 'info@aidemmedia.com.au')}">${esc(config.email || 'info@aidemmedia.com.au')}</a>.</p>`;
      return;
    }
    $('schools').innerHTML = schools.map((s) => `
      <button class="school" type="button" data-id="${s.id}">
        <span class="who">${crest(s)}<span><strong>${esc(s.school)}</strong><small>${esc(s.title)}${s.performed ? ' · ' + esc(s.performed) : ''}</small></span></span>
        <span class="pill ${s.bulk ? 'open' : 'closed'}">${s.bulk ? 'USB or download' : 'Download only'}</span>
      </button>`).join('');
  }

  function openCodeStep(s) {
    concert = null;
    $('s2-school').textContent = s.school;
    $('s2-crest').innerHTML = crest(s, true);
    $('code').value = '';
    $('code-err').hidden = true;
    $('code-form').dataset.id = s.id;
    go(2);
    $('code').focus();
  }

  async function unlock(id, theCode, quiet) {
    const c = await api(`/api/concerts/${id}/unlock`, { code: theCode });
    concert = c;
    code = theCode;
    store.set('am-code-' + id, theCode);
    showOrderForm();
    return c;
  }

  function showOrderForm() {
    const c = concert;
    $('s3-school').textContent = c.school;
    $('s3-title').textContent = c.title;
    $('s3-cutoff').textContent = c.bulk
      ? `${c.performed ? 'Performed ' + c.performed + '. ' : ''}${c.usbCutoff ? `USB orders close at the end of ${c.usbCutoff}, then it's download only.` : ''}`
      : `${c.performed ? 'Performed ' + c.performed + '. ' : ''}Download only.`;
    $('p-usb').textContent = money(c.prices.usb) + (c.nights.length ? ' a night' : '');
    $('p-dl').textContent = money(c.prices.download) + (c.nights.length ? ' a night' : '');
    $('opt-usb').hidden = !c.usbAvailable;
    $('usb-closed').hidden = c.usbAvailable;
    $('student-fields').hidden = !c.bulk;
    $('nights-box').hidden = !c.nights.length;
    $('nights').innerHTML = c.nights.map((n) => `<label class="check"><input type="checkbox" name="night" value="${n.id}"> ${esc(n.label)}</label>`).join('');
    const pick = c.classes && c.classes.length;
    $('klass-text').hidden = !!pick;
    $('klass-pick').hidden = !pick;
    $('klass-select').innerHTML = '<option value="">Choose a class</option>' + (c.classes || []).map((k) => `<option>${esc(k)}</option>`).join('');
    const radios = document.querySelectorAll('input[name="format"]');
    radios.forEach((r) => { r.checked = false; });
    if (!c.usbAvailable) document.querySelector('input[name="format"][value="download"]').checked = true;
    $('order-err').hidden = true;
    $('promo-msg').textContent = '';
    restoreDraft();
    go(3);
    refreshQuote();
  }

  function formValues() {
    const fmt = document.querySelector('input[name="format"]:checked');
    const pick = concert.classes && concert.classes.length;
    return {
      concertId: concert.id,
      code,
      format: fmt ? fmt.value : '',
      nights: Array.from(document.querySelectorAll('input[name="night"]:checked')).map((i) => Number(i.value)),
      student: $('student').value.trim(),
      klass: (pick ? $('klass-select').value : $('klass').value).trim(),
      email: $('email').value.trim(),
      discount: $('promo').value.trim(),
    };
  }

  function saveDraft() {
    if (!concert) return;
    const v = formValues();
    store.set('am-draft-' + concert.id, { format: v.format, nights: v.nights, student: v.student, klass: v.klass, email: v.email, discount: v.discount });
  }

  function restoreDraft() {
    const d = store.get('am-draft-' + concert.id);
    if (!d) return;
    if (d.format) { const r = document.querySelector(`input[name="format"][value="${d.format}"]`); if (r && !r.closest('[hidden]')) r.checked = true; }
    (d.nights || []).forEach((id) => { const i = document.querySelector(`input[name="night"][value="${id}"]`); if (i) i.checked = true; });
    $('student').value = d.student || '';
    $('klass').value = d.klass || '';
    if (d.klass) $('klass-select').value = d.klass;
    $('email').value = d.email || '';
    $('promo').value = d.discount || '';
  }

  function renderTotal(q, v) {
    lastQuote = q;
    if (!v.format) { $('live-total').innerHTML = ''; return; }
    const label = v.format === 'usb' ? 'USB' : 'Download';
    $('live-total').innerHTML = `
      <div><span>${label}${q.qty > 1 ? ` × ${q.qty} nights` : ''}</span><span>${money(q.subtotal)}</span></div>
      ${q.discount ? `<div class="disc"><span>Discount (${esc(q.discountCode)})</span><span>−${money(q.discount)}</span></div>` : ''}
      <div class="total"><span>Total (incl. GST)</span><span>${money(q.total)}</span></div>`;
    if (v.discount) {
      $('promo-msg').className = 'small ' + (q.discountError ? 'error' : 'okmsg');
      $('promo-msg').textContent = q.discountError || `Code ${q.discountCode} applied.`;
    } else $('promo-msg').textContent = '';
  }

  async function refreshQuote() {
    if (!concert) return;
    const v = formValues();
    saveDraft();
    try { renderTotal(await api('/api/quote', v), v); } catch { /* shown at submit */ }
  }

  function scheduleQuote() { clearTimeout(quoteTimer); quoteTimer = setTimeout(refreshQuote, 250); }

  function showReview() {
    const c = concert, v = formValues(), q = lastQuote;
    const nightLabels = c.nights.filter((n) => v.nights.includes(n.id)).map((n) => n.label);
    $('summary').innerHTML = `
      <div><span>Concert</span><span>${esc(c.school)}, ${esc(c.title)}</span></div>
      ${nightLabels.length ? `<div><span>${nightLabels.length > 1 ? 'Nights' : 'Night'}</span><span>${esc(nightLabels.join(', '))}</span></div>` : c.singleNight ? `<div><span>Night</span><span>${esc(c.singleNight)}</span></div>` : ''}
      ${c.bulk ? `<div><span>Student</span><span>${esc(v.student)}, ${esc(v.klass.toUpperCase())}</span></div>` : ''}
      <div><span>Format</span><span>${v.format === 'usb' ? 'USB' : 'Download'}</span></div>
      <div><span>Email</span><span>${esc(v.email)}</span></div>
      ${q.discount ? `<div><span>Subtotal</span><span>${money(q.subtotal)}</span></div><div class="disc"><span>Discount (${esc(q.discountCode)})</span><span>−${money(q.discount)}</span></div>` : ''}
      <div class="total"><span>Total (incl. GST)</span><span>${money(q.total)}</span></div>`;
    $('s4-next').textContent = v.format === 'usb'
      ? `Your USB will be sent home with class ${v.klass.toUpperCase()} after the concert.`
      : c.bulk ? "We'll email your download link when the concert video is ready." : 'Your download link is emailed as soon as you pay.';
    const btns = [];
    if (q.total === 0) btns.push(`<button class="btn pay" data-pay="stripe">Place order</button>`);
    else {
      if (config.stripe) btns.push(`<button class="btn pay" data-pay="stripe">Pay ${money(q.total)} by card, Apple Pay or Google Pay</button>`);
      if (config.paypal) btns.push(`<button class="btn pay" data-pay="paypal">Pay ${money(q.total)} with PayPal</button>`);
      if (config.test) btns.push(`<button class="btn ghost" data-pay="test">Test payment (no charge)</button>`);
      if (!btns.length) btns.push(`<p class="banner warn">Online payment isn't switched on yet. Please check back soon.</p>`);
    }
    $('pay-buttons').innerHTML = btns.join('');
    $('pay-err').hidden = true;
    go(4);
  }

  // ----- events -----
  $('schools').addEventListener('click', (e) => {
    const b = e.target.closest('.school');
    if (!b) return;
    const s = schools.find((x) => String(x.id) === b.dataset.id);
    const saved = store.get('am-code-' + s.id);
    if (saved) unlock(s.id, saved).catch(() => openCodeStep(s));
    else openCodeStep(s);
  });

  $('code-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.submitter || e.target.querySelector('button');
    btn.disabled = true;
    $('code-err').hidden = true;
    try { await unlock(e.target.dataset.id, $('code').value.trim()); }
    catch (err) { $('code-err').textContent = err.message; $('code-err').hidden = false; }
    finally { btn.disabled = false; }
  });

  $('order-form').addEventListener('input', scheduleQuote);
  $('order-form').addEventListener('change', scheduleQuote);
  $('promo-apply').addEventListener('click', refreshQuote);

  $('order-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = formValues(), c = concert, problems = [];
    if (c.nights.length && !v.nights.length) problems.push('tick at least one night');
    if (!v.format) problems.push('choose USB or download');
    if (c.bulk && !v.student) problems.push("enter the eldest student's name");
    if (c.bulk && !v.klass) problems.push('choose the class');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.email)) problems.push('enter a valid email');
    if (problems.length) { $('order-err').textContent = 'Please ' + problems.join(', ') + '.'; $('order-err').hidden = false; return; }
    try {
      const q = await api('/api/quote', v);
      renderTotal(q, v);
      if (q.discountError) { $('order-err').textContent = q.discountError + ' Remove it to continue.'; $('order-err').hidden = false; return; }
      $('order-err').hidden = true;
      showReview();
    } catch (err) { $('order-err').textContent = err.message; $('order-err').hidden = false; }
  });

  $('pay-buttons').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-pay]');
    if (!b) return;
    document.querySelectorAll('[data-pay]').forEach((x) => { x.disabled = true; });
    const original = b.textContent;
    b.textContent = 'Please wait…';
    try {
      const r = await api('/api/checkout', { ...formValues(), provider: b.dataset.pay });
      window.location.href = r.redirect;
    } catch (err) {
      $('pay-err').textContent = err.message;
      $('pay-err').hidden = false;
      document.querySelectorAll('[data-pay]').forEach((x) => { x.disabled = false; });
      b.textContent = original;
    }
  });

  document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => go(+b.dataset.go)));

  // ----- start -----
  (async () => {
    try {
      [config] = await Promise.all([api('/api/config')]);
      $('test-notice').hidden = !config.test;
      if (config.privacyUrl) $('privacy').href = config.privacyUrl;
      schools = (await api('/api/concerts')).concerts;
      renderSchools();
    } catch (err) {
      $('schools').innerHTML = '';
      $('s1-err').textContent = err.message;
      $('s1-err').hidden = false;
      return;
    }
    // Coming back from a cancelled payment, or a link straight to one concert (?concert=12).
    const p = new URLSearchParams(location.search);
    const id = p.get('concert');
    const s = id && schools.find((x) => String(x.id) === id);
    if (s) {
      const saved = store.get('am-code-' + s.id);
      if (saved) {
        try { await unlock(s.id, saved); $('s3-cancel').hidden = !(p.get('cancelled') || p.get('error')); return; } catch {}
      }
      openCodeStep(s);
    } else go(1);
  })();
})();

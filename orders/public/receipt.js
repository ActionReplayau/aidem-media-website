// Receipt and tax invoice, shown after payment.
(() => {
  const el = document.getElementById('receipt');
  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const p = new URLSearchParams(location.search);
  let tries = 0;

  async function load() {
    try {
      const res = await fetch(`/api/order?o=${encodeURIComponent(p.get('o') || '')}&t=${encodeURIComponent(p.get('t') || '')}`);
      const r = await res.json();
      if (!res.ok) throw new Error(r.error || 'Order not found.');
      if (r.status === 'pending') {
        // Payment can take a few seconds to confirm.
        if (tries++ < 10) {
          el.innerHTML = '<p class="banner warn">Confirming your payment…</p>';
          return setTimeout(load, 2000);
        }
        el.innerHTML = `<p class="banner warn">We haven't received confirmation of this payment yet. If you paid, your receipt will be emailed to ${esc(r.email)} shortly. Otherwise, <a href="/?concert=${r.concertId}">go back and try again</a>.</p>`;
        return;
      }
      render(r);
    } catch (err) {
      el.innerHTML = `<p class="banner err">${esc(err.message)} If you've paid, check your email for the receipt, or contact <a href="mailto:info@aidemmedia.com.au">info@aidemmedia.com.au</a>.</p>`;
    }
  }

  function render(r) {
    const refunded = r.status === 'refunded';
    el.innerHTML = `
      <p class="banner ${refunded ? 'warn' : 'ok'}">${refunded ? `Order ${esc(r.orderNo)} has been refunded.` : `Thanks, your order ${esc(r.orderNo)} is confirmed.`}</p>
      <div class="stack"><h1>Your receipt</h1><p class="muted">We've emailed this tax invoice to ${esc(r.email)}. ${esc(r.next)}</p></div>
      ${r.downloadUrl ? `<div><a class="btn" href="${esc(r.downloadUrl)}">Watch and download</a></div>` : ''}
      <div class="invoice">
        <div class="top">
          <div class="stack" style="gap:4px"><h2>Tax invoice</h2><span class="muted">${esc(r.business.name)} · ABN ${esc(r.business.abn)}</span><span class="muted">${esc(r.business.location)} · ${esc(r.business.email)}</span></div>
          <div class="stack" style="gap:4px;text-align:right"><strong>${esc(r.orderNo)}</strong>${r.paidBy ? `<span class="muted">Paid by ${esc(r.paidBy)}</span>` : ''}</div>
        </div>
        <div class="summary">
          ${r.lines.filter(([k]) => k !== 'Invoice').map(([k, v]) => `<div><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join('')}
          <div class="total"><span>Total paid (incl. GST)</span><span>${esc(r.total)}</span></div>
        </div>
      </div>
      <div class="row noprint"><button class="btn ghost" type="button" id="print">Print or save as PDF</button><a class="btn ghost" href="/">Order for another concert</a></div>`;
    document.getElementById('print').addEventListener('click', () => window.print());
    try { sessionStorage.removeItem('am-draft-' + r.concertId); } catch {}
  }

  load();
})();

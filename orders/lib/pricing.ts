import type { Env } from './env';
import { asksStudent, getConcert, getNights, isBulk, isOpen, type Concert, type Night } from './db';
import { clean, fail, isEmail, safeEqual } from './util';

export interface OrderInput {
  concertId: number;
  code: string;
  format?: string;
  nights?: number[];
  student?: string;
  klass?: string;
  email?: string;
  discount?: string;
}

export interface Discount { code: string; kind: 'percent' | 'amount'; value: number; concert_id: number | null; max_uses: number | null; uses: number; active: number }

export function codeMatches(c: Concert, code: string) {
  return safeEqual(clean(code, 40).toUpperCase(), c.access_code.toUpperCase());
}

// Slows down anyone guessing access codes: 15 wrong codes in 15 minutes locks that connection out for a while.
export async function unlockConcert(env: Env, concertId: number, code: string, ip = '') {
  const c = await getConcert(env, Number(concertId));
  if (!c || !isOpen(c)) fail(404, 'This concert is not taking orders.');
  if (!codeMatches(c, code)) {
    if (ip) {
      const since = Date.now() - 15 * 60_000;
      const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM code_attempts WHERE ip = ? AND at > ?').bind(ip, since).first<{ n: number }>();
      if ((n?.n || 0) >= 15) fail(429, 'Too many tries. Please wait 15 minutes and try again.');
      await env.DB.prepare('INSERT INTO code_attempts (ip, at) VALUES (?, ?)').bind(ip, Date.now()).run();
    }
    fail(403, "That code doesn't match this concert. Check the note from school and try again.");
  }
  return c;
}

export async function findDiscount(env: Env, code: string, concertId: number): Promise<Discount | null> {
  const d = await env.DB.prepare('SELECT * FROM discounts WHERE code = ?').bind(clean(code, 40).toUpperCase()).first<Discount>();
  if (!d || !d.active) return null;
  if (d.concert_id && d.concert_id !== concertId) return null;
  if (d.max_uses != null && d.uses >= d.max_uses) return null;
  return d;
}

// Works out the price and checks every field. Used for the live price and again at checkout.
export async function quote(env: Env, input: OrderInput, { strict, ip = '' }: { strict: boolean; ip?: string }) {
  const c = await unlockConcert(env, input.concertId, input.code, ip);
  const nights = await getNights(env, c.id);
  const bulk = isBulk(c);
  const askStudent = asksStudent(c);
  const problems: string[] = [];

  const format = input.format === 'usb' && bulk ? 'usb' : input.format === 'download' ? 'download' : null;
  if (!format) problems.push(input.format === 'usb' ? 'choose download (USB orders have closed)' : 'choose USB or download');

  let chosen: Night[] = [];
  if (nights.length > 1) {
    const ids = new Set((input.nights || []).map(Number));
    chosen = nights.filter((n) => ids.has(n.id));
    if (!chosen.length) problems.push('tick at least one video');
  } else if (nights.length === 1) {
    chosen = nights;
  }

  const student = clean(input.student, 80);
  let klass = clean(input.klass, 30).toUpperCase();
  if (askStudent) {
    if (!student) problems.push("enter the eldest student's name");
    if (!klass) problems.push('enter the class');
    const list = classList(c);
    if (klass && list.length && !list.includes(klass)) problems.push('choose a class from the list');
  }

  const email = clean(input.email, 254).toLowerCase();
  if (!isEmail(email)) problems.push('enter a valid email');

  const qty = Math.max(1, chosen.length);
  const unit = format === 'usb' ? c.price_usb : c.price_download;
  const subtotal = unit * qty;

  let discount = 0;
  let discountCode: string | null = null;
  let discountError: string | null = null;
  if (input.discount && clean(input.discount)) {
    const d = await findDiscount(env, input.discount, c.id);
    if (!d) discountError = "That discount code isn't valid for this concert.";
    else {
      discountCode = d.code;
      // Percent codes take a share off the order; dollar codes take a fixed amount off the order.
      discount = d.kind === 'percent' ? Math.round(subtotal * Math.min(100, d.value) / 100) : d.value;
      discount = Math.max(0, Math.min(discount, subtotal));
    }
  }

  if (strict) {
    if (discountError) problems.push('check or remove the discount code');
    if (problems.length) fail(400, 'Please ' + problems.join(', ') + '.');
  }

  return {
    concert: c, nights, chosen, bulk, format: format as 'usb' | 'download' | null,
    student: askStudent ? student : null, klass: askStudent ? klass : null, email,
    qty, unit, subtotal, discount, discountCode, discountError, total: subtotal - discount, problems,
  };
}

export function classList(c: Concert): string[] {
  return c.class_list.split(/[\n,]/).map((s) => clean(s, 30).toUpperCase()).filter(Boolean);
}

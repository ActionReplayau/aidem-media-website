import type { Env } from './env';
import { business } from './business';
import { today } from './util';

// Tables are created automatically the first time the app runs,
// so there is nothing to paste into the Cloudflare D1 console.
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS concerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    school TEXT NOT NULL,
    title TEXT NOT NULL,
    performed TEXT NOT NULL DEFAULT '',
    access_code TEXT NOT NULL,
    visible INTEGER NOT NULL DEFAULT 0,
    usb_enabled INTEGER NOT NULL DEFAULT 1,
    usb_cutoff TEXT,
    orders_close TEXT,
    price_usb INTEGER NOT NULL DEFAULT 4000,
    price_download INTEGER NOT NULL DEFAULT 3500,
    class_list TEXT NOT NULL DEFAULT '',
    download_url TEXT NOT NULL DEFAULT '',
    commission_pct REAL NOT NULL DEFAULT 0,
    delete_students_after TEXT,
    students_deleted_at TEXT,
    logo_type TEXT,
    logo_data TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS concert_files (
    concert_id INTEGER PRIMARY KEY,
    pdf_name TEXT NOT NULL,
    pdf_data TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS nights (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    concert_id INTEGER NOT NULL,
    label TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS nights_concert ON nights(concert_id)`,
  `CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    token TEXT NOT NULL,
    order_no INTEGER UNIQUE,
    concert_id INTEGER NOT NULL,
    email TEXT NOT NULL,
    student TEXT,
    class TEXT,
    format TEXT NOT NULL,
    phase TEXT NOT NULL,
    nights_text TEXT NOT NULL DEFAULT '',
    qty INTEGER NOT NULL DEFAULT 1,
    unit_price INTEGER NOT NULL,
    subtotal INTEGER NOT NULL,
    discount INTEGER NOT NULL DEFAULT 0,
    discount_code TEXT,
    total INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    provider TEXT,
    provider_ref TEXT,
    payment_ref TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    paid_at TEXT,
    receipt_sent_at TEXT,
    download_sent_at TEXT,
    refunded_at TEXT,
    refund_amount INTEGER NOT NULL DEFAULT 0,
    note TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS orders_concert ON orders(concert_id, status)`,
  `CREATE INDEX IF NOT EXISTS orders_email ON orders(email)`,
  `CREATE INDEX IF NOT EXISTS orders_provider_ref ON orders(provider_ref)`,
  `CREATE TABLE IF NOT EXISTS order_nights (
    order_id TEXT NOT NULL,
    night_id INTEGER NOT NULL,
    PRIMARY KEY (order_id, night_id)
  )`,
  `CREATE INDEX IF NOT EXISTS order_nights_night ON order_nights(night_id)`,
  `CREATE TABLE IF NOT EXISTS code_attempts (
    ip TEXT NOT NULL,
    at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS code_attempts_ip ON code_attempts(ip, at)`,
  `CREATE TABLE IF NOT EXISTS discounts (
    code TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    value INTEGER NOT NULL,
    concert_id INTEGER,
    max_uses INTEGER,
    uses INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
];

let ready: Promise<void> | null = null;

export function ensureSchema(env: Env): Promise<void> {
  if (!env.DB) throw new Error('D1 database is not connected. Add a D1 binding called DB in Cloudflare Pages settings.');
  if (!ready) {
    ready = env.DB.batch(SCHEMA.map((s) => env.DB.prepare(s))).then(() => undefined);
    ready.catch(() => { ready = null; });
  }
  return ready;
}

export interface Concert {
  id: number;
  school: string;
  title: string;
  performed: string;
  access_code: string;
  visible: number;
  usb_enabled: number;
  usb_cutoff: string | null;
  orders_close: string | null;
  price_usb: number;
  price_download: number;
  class_list: string;
  download_url: string;
  commission_pct: number;
  delete_students_after: string | null;
  students_deleted_at: string | null;
  logo_type: string | null;
  updated_at: string;
  created_at: string;
}

export interface Night { id: number; concert_id: number; label: string; position: number }

export interface Order {
  id: string; token: string; order_no: number | null; concert_id: number; email: string;
  student: string | null; class: string | null; format: 'usb' | 'download'; phase: 'bulk' | 'after';
  nights_text: string; qty: number; unit_price: number; subtotal: number; discount: number;
  discount_code: string | null; total: number; status: 'pending' | 'paid' | 'refunded';
  provider: string | null; provider_ref: string | null; payment_ref: string | null;
  created_at: string; paid_at: string | null; receipt_sent_at: string | null;
  download_sent_at: string | null; refunded_at: string | null; refund_amount: number; note: string | null;
}

// Everything except the logo image itself.
export const CONCERT_COLS = `id, school, title, performed, access_code, visible, usb_enabled, usb_cutoff, orders_close,
  price_usb, price_download, class_list, download_url, commission_pct, delete_students_after, students_deleted_at,
  logo_type, updated_at, created_at`;

export async function getConcert(env: Env, id: number): Promise<Concert | null> {
  return env.DB.prepare(`SELECT ${CONCERT_COLS} FROM concerts WHERE id = ?`).bind(id).first<Concert>();
}

export async function getNights(env: Env, concertId: number): Promise<Night[]> {
  const r = await env.DB.prepare('SELECT * FROM nights WHERE concert_id = ? ORDER BY position, id').bind(concertId).all<Night>();
  return r.results;
}

export async function hasPdf(env: Env, concertId: number): Promise<boolean> {
  return !!(await env.DB.prepare('SELECT 1 FROM concert_files WHERE concert_id = ?').bind(concertId).first());
}

export async function getPdf(env: Env, concertId: number) {
  return env.DB.prepare('SELECT pdf_name, pdf_data FROM concert_files WHERE concert_id = ?').bind(concertId).first<{ pdf_name: string; pdf_data: string }>();
}

// Bulk period = USB or download, with student name and class.
// After the cut-off date it's download only, and the link is emailed at checkout.
export function isBulk(c: Concert, day = today()): boolean {
  return !!c.usb_enabled && (!c.usb_cutoff || day <= c.usb_cutoff);
}

export function isOpen(c: Concert, day = today()): boolean {
  return !!c.visible && (!c.orders_close || day <= c.orders_close);
}

// Housekeeping, run now and then from normal requests (there is no scheduler on Pages).
export async function housekeeping(env: Env) {
  const day = today();
  await env.DB.batch([
    // Privacy: remove student names and classes once the concert's delete date has passed.
    env.DB.prepare(`UPDATE orders SET student = NULL, class = NULL
      WHERE (student IS NOT NULL OR class IS NOT NULL)
      AND concert_id IN (SELECT id FROM concerts WHERE delete_students_after IS NOT NULL AND delete_students_after < ?)`).bind(day),
    env.DB.prepare(`UPDATE concerts SET students_deleted_at = datetime('now')
      WHERE students_deleted_at IS NULL AND delete_students_after IS NOT NULL AND delete_students_after < ?`).bind(day),
    // Abandoned checkouts older than 14 days.
    env.DB.prepare(`DELETE FROM order_nights WHERE order_id IN
      (SELECT id FROM orders WHERE status = 'pending' AND created_at < datetime('now', '-14 days'))`),
    env.DB.prepare(`DELETE FROM orders WHERE status = 'pending' AND created_at < datetime('now', '-14 days')`),
    env.DB.prepare('DELETE FROM code_attempts WHERE at < ?').bind(Date.now() - 86400_000),
  ]);
}

export const NEXT_ORDER_NO_SQL = `COALESCE((SELECT MAX(order_no) FROM orders), ${business.firstOrderNo - 1}) + 1`;

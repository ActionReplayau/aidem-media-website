import { business } from './business';

export function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function fail(status: number, message: string): never {
  throw new HttpError(status, message);
}

export async function readJson<T = any>(request: Request): Promise<T> {
  if (!(request.headers.get('content-type') || '').includes('application/json')) fail(415, 'Expected JSON');
  try { return await request.json() as T; } catch { fail(400, 'Invalid JSON'); }
}

export function handle(fn: () => Promise<Response>): Promise<Response> {
  return fn().catch((e) => {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  });
}

// Today's date (YYYY-MM-DD) in Melbourne.
export function today(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: business.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

export function nowIso() { return new Date().toISOString(); }

export function money(cents: number): string {
  return '$' + (cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function gstOf(totalCents: number): number {
  return Math.round(totalCents / 11);
}

export function longDate(isoOrDate: string | Date): string {
  const d = typeof isoOrDate === 'string' ? new Date(isoOrDate.length === 10 ? isoOrDate + 'T12:00:00Z' : isoOrDate) : isoOrDate;
  return new Intl.DateTimeFormat('en-AU', { timeZone: business.timeZone, day: 'numeric', month: 'long', year: 'numeric' }).format(d);
}

export function randomId(bytes = 16): string {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

const enc = new TextEncoder();

export async function hmacHex(key: string, message: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, enc.encode(message));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export function clean(s: unknown, max = 200): string {
  return String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) && s.length <= 254;
}

export function csv(rows: (string | number | null | undefined)[][]): string {
  return '﻿' + rows.map((r) => r.map((v) => {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // stop spreadsheet formula injection
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',')).join('\r\n');
}

export function b64FromDataUrl(dataUrl: string): { type: string; data: string } | null {
  const m = /^data:([\w/+.-]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || '');
  return m ? { type: m[1], data: m[2] } : null;
}

export function bytesFromB64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

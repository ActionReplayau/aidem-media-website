import type { Env } from './env';
import { fail, hmacHex, safeEqual } from './util';

const COOKIE = 'am_admin';
const DAYS = 14;

export async function makeSession(env: Env): Promise<string> {
  const exp = String(Date.now() + DAYS * 86400_000);
  return `${exp}.${await hmacHex(env.ADMIN_PASSWORD, 'admin:' + exp)}`;
}

export function sessionCookie(value: string, clear = false) {
  return `${COOKIE}=${clear ? '' : value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${clear ? 0 : DAYS * 86400}`;
}

export async function isAdmin(env: Env, request: Request): Promise<boolean> {
  if (!env.ADMIN_PASSWORD) return false;
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(request.headers.get('cookie') || '');
  if (!m) return false;
  const [exp, sig] = m[1].split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return safeEqual(sig, await hmacHex(env.ADMIN_PASSWORD, 'admin:' + exp));
}

export async function checkPassword(env: Env, password: string) {
  if (!env.ADMIN_PASSWORD) fail(500, 'Set ADMIN_PASSWORD in Cloudflare Pages settings first.');
  // Compare HMACs so the check takes the same time whatever is typed.
  const a = await hmacHex('pw', String(password || ''));
  const b = await hmacHex('pw', env.ADMIN_PASSWORD);
  if (!safeEqual(a, b)) {
    await new Promise((r) => setTimeout(r, 800));
    fail(401, 'Wrong password.');
  }
}

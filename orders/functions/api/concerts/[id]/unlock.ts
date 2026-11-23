import type { Env } from '../../../../lib/env';
import { asksStudent, ensureSchema, getNights, hasPdf, isBulk } from '../../../../lib/db';
import { classList, unlockConcert } from '../../../../lib/pricing';
import { handle, json, longDate, readJson } from '../../../../lib/util';

// Checks the access code and returns the concert's order options.
export const onRequestPost: PagesFunction<Env> = ({ env, request, params }) => handle(async () => {
  await ensureSchema(env);
  const body = await readJson<{ code: string }>(request);
  const ip = request.headers.get('cf-connecting-ip') || '';
  const c = await unlockConcert(env, Number(params.id), body.code, ip);
  const nights = await getNights(env, c.id);
  const bulk = isBulk(c);
  return json({
    id: c.id,
    school: c.school,
    title: c.title,
    performed: c.performed,
    bulk,
    usbCutoff: bulk && c.usb_cutoff ? longDate(c.usb_cutoff) : null,
    usbAvailable: bulk,
    usbOffered: !!c.usb_enabled,
    askStudent: asksStudent(c),
    prices: { usb: c.price_usb, download: c.price_download },
    nights: nights.length > 1 ? nights.map((n) => ({ id: n.id, label: n.label })) : [],
    singleNight: nights.length === 1 ? nights[0].label : null,
    classes: classList(c),
    downloadReady: !!c.download_url,
    pdf: await hasPdf(env, c.id),
    logo: c.logo_type ? `/api/logo/${c.id}?v=${encodeURIComponent(c.updated_at)}` : null,
  });
});

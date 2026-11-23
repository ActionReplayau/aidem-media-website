# Aidem Media website

Static website for aidemmedia.com.au, built with Astro and hosted on Cloudflare Pages.

## Change common details

Phone, email, ABN, the concert order link and the testimonial all live in `src/site.ts`.

- `orderUrl`: where every "Order" button goes. For the 2026 season it is the current Wix order page. Change it when the new ordering system is ready, and before the domain moves off Wix.
- `showPlaceholders`: while `true`, wording that still needs Matt's real copy is highlighted in yellow. Set it to `false` once all of it is replaced.

## Pages

| Page | File |
|---|---|
| Home | `src/pages/index.astro` |
| School concerts | `src/pages/school-concerts.astro` |
| Graduations | `src/pages/graduations.astro` |
| Dance concerts | `src/pages/dance-concerts.astro` |
| Corporate events | `src/pages/corporate.astro` |
| Funerals | `src/pages/funerals.astro` |
| Contact | `src/pages/contact.astro` |
| Privacy policy | `src/pages/privacy.astro` |

Photos are in `public/images/`. Old Wix addresses are redirected in `public/_redirects`.

## Cloudflare Pages settings

- Framework preset: Astro
- Build command: `npm run build`
- Build output directory: `dist`

## Before going live

- [ ] Real logo file (current one is taken from the design preview)
- [ ] Replace all yellow placeholder wording, then set `showPlaceholders` to `false`
- [ ] Confirm the testimonial(s) chosen from Google reviews
- [ ] Confirm every photo is your own (or licensed)
- [ ] Privacy policy wording
- [ ] Point `orderUrl` at the new ordering system
- [ ] Only then: move the domain from Wix (ask Matt first)

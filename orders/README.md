# Aidem Media concert orders

Parents scan one QR code, choose their school, enter the concert's access code, pick USB or download (and nights for multi-night shows), and pay by card, Apple Pay, Google Pay or PayPal. They get a GST tax invoice by email. You manage everything at `/admin`.

It runs on Cloudflare Pages (free plan) with a D1 database. It lives in this folder (`orders/`) but is its own Cloudflare Pages project, separate from the website, so it can't break the website.

## What's where

| Thing | File |
|---|---|
| Business name, ABN, privacy link, first invoice number | `lib/business.ts` |
| Parent order page | `public/index.html`, `public/order.js` |
| Receipt page | `public/receipt.html`, `public/receipt.js` |
| Admin | `public/admin/index.html`, `public/admin.js` |
| Look and feel | `public/styles.css` |
| Server code | `functions/api/` and `lib/` |

Database tables are created automatically the first time it runs.

## Set up step 1: get it running in test mode

1. Cloudflare dashboard > **Storage & Databases** > **D1** > **Create database**. Name it `aidem-orders`.
2. **Workers & Pages** > **Create** > **Pages** > **Connect to Git** > choose `aidem-media-website`.
3. Settings on the next screen:
   - Project name: `aidem-media-orders`
   - Production branch: `main`
   - Framework preset: **None**
   - Build command: leave empty
   - Build output directory: `public`
   - Root directory (under Advanced): `orders`
4. Press **Save and Deploy**. The first deploy will show errors until steps 5 to 7 are done. That's expected.
5. The new project > **Settings** > **Bindings** > **Add** > **D1 database**. Variable name `DB`, database `aidem-orders`. Save.
6. **Settings** > **Variables and secrets** > **Add**:
   - `ADMIN_PASSWORD` (type Secret): a long password only you know.
   - `TEST_PAYMENTS` (type Text): `on`
7. **Deployments** > the latest one > **Retry deployment**.
8. Open `https://aidem-media-orders.pages.dev/admin`, sign in, and create a concert. Then try ordering at `https://aidem-media-orders.pages.dev` with the Test payment button.

## Set up step 2: payments and email (before the pilot concert)

Add each of these in **Settings** > **Variables and secrets** (type Secret), then retry the deployment.

**Stripe** (cards, Apple Pay, Google Pay). Stripe dashboard > Developers > API keys.
- `STRIPE_SECRET_KEY`: starts `sk_test_` while testing, `sk_live_` for real.
- Then Developers > Webhooks > Add endpoint: `https://<orders address>/api/stripe/webhook`, event `checkout.session.completed`. Copy its signing secret into `STRIPE_WEBHOOK_SECRET`.

**PayPal**. developer.paypal.com > Apps & Credentials > create an app.
- `PAYPAL_CLIENT_ID`, `PAYPAL_SECRET`
- `PAYPAL_MODE` (Text): `sandbox` while testing, `live` for real.

**Resend** (receipts and download links). resend.com > API Keys.
- `RESEND_API_KEY`
- `EMAIL_FROM` (Text): for example `Aidem Media <orders@aidemmedia.com.au>`. This needs the domain verified in Resend first (DNS records, ask before changing DNS). Until then emails only reach your own Resend sign-up address.

Free plan limit: 100 emails a day, 3,000 a month. "Send download links" sends up to 90 at a time; send the rest the next day.

## Going live checklist

- [ ] Full test order with real Stripe and PayPal (refund it afterwards in admin)
- [ ] Resend domain verified so receipts don't land in spam
- [ ] `TEST_PAYMENTS` removed
- [ ] Custom domain `orders.aidemmedia.com.au` added under Custom domains (needs a DNS record, ask first)
- [ ] Privacy policy link in `lib/business.ts` points at the live website
- [ ] Website `orderUrl` in `src/site.ts` points here (ask first)

## How orders work

- **Bulk period** (until the "Last day for USB orders"): USB or download. Parents enter their eldest student's name and class. Download buyers get their link when you press **Send download links**.
- **After that day**: download only, no student details. The download link (and the concert PDF, if added) is emailed at checkout.
- **Multi-night shows**: add nights to the concert. Parents tick nights and pay per night. Filter by night in admin.
- **Invoice numbers** run AM-1001, AM-1002 and so on. Prices include GST; GST is the total divided by 11.
- **Privacy**: set "Delete student names and classes after" on each concert. After that date, names and classes are removed automatically. Orders and receipts stay.

## Local testing (developers)

```
cd orders
npm install
npm run dev     # http://localhost:8788, admin password "test", test payments on
npm run check   # type check
```

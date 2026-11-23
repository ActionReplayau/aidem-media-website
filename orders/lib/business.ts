// Business details printed on tax invoices and emails.
export const business = {
  name: 'Aidem Media Pty Ltd',
  tradingName: 'Aidem Media',
  abn: '77 610 944 226',
  location: 'Beaconsfield VIC',
  email: 'info@aidemmedia.com.au',
  phone: '0433 416 369',
  website: 'https://www.aidemmedia.com.au',
  // Where the "Privacy policy" link on the order pages goes.
  privacyUrl: 'https://aidem-media-website.pages.dev/privacy',
  // Invoice numbers start after this number (first order is AM-1001).
  firstOrderNo: 1001,
  orderPrefix: 'AM-',
  timeZone: 'Australia/Melbourne',
};

export const orderNo = (n: number | null | undefined) => (n ? business.orderPrefix + n : '');

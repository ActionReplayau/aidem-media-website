// Everything you are likely to change lives in this one file.

export const site = {
  name: 'Aidem Media',
  phone: '0433 416 369',
  phoneHref: 'tel:+61433416369',
  email: 'info@aidemmedia.com.au',
  location: 'Beaconsfield VIC',
  abn: '77 610 944 226',

  // Parents order here. For the 2026 season this is the current Wix ordering page.
  // When the new ordering system is ready, change this one line.
  orderUrl: 'https://www.aidemmedia.com.au/concert-production-orders',

  actionReplayUrl: 'https://actionreplay.com.au',

  // While this is true, wording still waiting on Matt is highlighted in yellow.
  // Set it to false once all placeholder text has been replaced.
  showPlaceholders: true,
};

export const services = [
  { slug: 'school-concerts', name: 'School concerts', image: 'school-concerts.jpg',
    alt: 'An audience watching students perform on a brightly lit school concert stage',
    blurb: "Multi-camera filming of your school's concert, with easy online ordering for parents." },
  { slug: 'graduations', name: 'Graduations', image: 'graduations.jpg',
    alt: 'A graduation night on a school stage, filmed from the back of the theatre',
    blurb: "Every student's moment on stage, captured and ready to share with families." },
  { slug: 'dance-concerts', name: 'Dance concerts', image: 'dance-concerts.jpg',
    alt: 'Dancers performing under stage spotlights',
    blurb: "Full-length recordings of your dance school's end-of-year show." },
  { slug: 'corporate', name: 'Corporate events', image: 'corporate.jpg',
    alt: 'Two professional cameras on tripods set up to film a presentation in a conference room',
    blurb: 'Conferences, presentations and functions, filmed and delivered privately.' },
  { slug: 'funerals', name: 'Funerals', image: 'funerals.jpg',
    alt: 'Flowers resting on a polished timber coffin at a graveside service',
    blurb: "Quiet, respectful filming of a service, so family who can't attend can watch." },
];

// Genuine Google reviews, quoted word for word. Do not edit the wording.
export const testimonial = {
  quote: 'Absolutely amazing work! The communication was second to none, and the quality of there work is next level. Definitely recommend their service.',
  name: 'bozlotoz',
  source: 'Google review',
};

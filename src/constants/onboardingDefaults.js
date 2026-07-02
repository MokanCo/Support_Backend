export const DEFAULT_ONBOARDING_CONFIG = {
  key: 'default',
  brandName: 'Mokanco',
  welcomeTitle: 'Welcome to Mokanco',
  welcomeDescription:
    'Complete this short wizard to request onboarding for your new location. Our team will review your submission and follow up by email.',
  wizardTitle: 'Location onboarding',
  wizardSidebarTitle: 'Get your location online',
  wizardSidebarDescription:
    'Tell us about you, your location, and the services you need. You can save progress as you go.',
  stepLabels: ['Personal', 'Location', 'Services', 'Confirm'],
  welcomeSteps: [
    { num: 1, label: 'Your details' },
    { num: 2, label: 'Location info' },
    { num: 3, label: 'Choose services' },
    { num: 4, label: 'Review & submit' },
  ],
  stepSubtitles: {
    personal: 'Contact information for the primary account holder',
    location: 'Details about the new Mokanco location',
    services: 'Select the listing and marketing services you need',
    confirm: 'Review everything before submitting',
  },
  successTitle: 'Request submitted',
  successDescription:
    'Thank you! We received your onboarding request and will review it shortly.',
  successEmailNote: 'A confirmation email with tracking details has been sent to your inbox.',
  enabled: true,
};

export const DEFAULT_ONBOARDING_SERVICES = [
  {
    slug: 'google',
    title: 'Google',
    section: 'Business Listing',
    iconKey: 'globe',
    iconClass: 'bg-blue-100 text-blue-600',
    sortOrder: 0,
  },
  {
    slug: 'yelp',
    title: 'Yelp',
    section: 'Business Listing',
    iconKey: 'star',
    iconClass: 'bg-red-100 text-red-600',
    sortOrder: 1,
  },
  {
    slug: 'apple-maps',
    title: 'Apple Maps',
    section: 'Business Listing',
    iconKey: 'smartphone',
    iconClass: 'bg-slate-100 text-slate-600',
    sortOrder: 2,
  },
  {
    slug: 'facebook',
    title: 'Facebook',
    section: 'Social Media',
    iconKey: 'facebook',
    iconClass: 'bg-blue-100 text-blue-700',
    sortOrder: 0,
  },
  {
    slug: 'instagram',
    title: 'Instagram',
    section: 'Social Media',
    iconKey: 'instagram',
    iconClass: 'bg-pink-100 text-pink-600',
    sortOrder: 1,
  },
  {
    slug: 'website',
    title: 'Website Setup',
    section: 'Digital Presence',
    iconKey: 'monitor',
    iconClass: 'bg-indigo-100 text-indigo-600',
    sortOrder: 0,
  },
];

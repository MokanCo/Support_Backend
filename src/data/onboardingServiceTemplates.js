/**
 * Reusable onboarding service task templates.
 * Synced into MongoDB via onboardingTemplateService — not used directly in request handlers.
 *
 * Three global categories:
 * 1. Business Listings — Google, Apple, Yelp
 * 2. Website Listing
 * 3. Delivery Services
 */
export const ONBOARDING_SERVICE_TEMPLATE_DEFS = [
  {
    slug: 'google',
    title: 'Google Business Profile',
    section: 'Business Listings',
    iconKey: 'globe',
    iconClass: 'bg-blue-100 text-blue-600',
    sortOrder: 0,
    tasks: [
      'Business Verified on Google',
      'Ownership Verified',
      'Logo Updated',
      'Hours Updated',
    ],
  },
  {
    slug: 'apple',
    title: 'Apple Business Connect',
    section: 'Business Listings',
    iconKey: 'smartphone',
    iconClass: 'bg-slate-100 text-slate-700',
    sortOrder: 1,
    tasks: [
      'Business Verified on Apple',
      'Ownership Verified',
      'Logo Updated',
      'Hours Updated',
    ],
  },
  {
    slug: 'yelp',
    title: 'Yelp',
    section: 'Business Listings',
    iconKey: 'star',
    iconClass: 'bg-red-100 text-red-700',
    sortOrder: 2,
    tasks: [
      'Business Verified on Yelp',
      'Ownership Verified',
      'Logo Updated',
      'Hours Updated',
    ],
  },
  {
    slug: 'website',
    title: 'Website',
    section: 'Website Listing',
    iconKey: 'globe',
    iconClass: 'bg-sky-100 text-sky-700',
    sortOrder: 3,
    tasks: [
      'Location Listed on Website',
      'Hours Updated on Website',
      'Map & Location Links Updated',
      'Forms Integrated',
    ],
  },
  {
    slug: 'delivery',
    title: 'Delivery & Ordering App',
    section: 'Delivery Services',
    iconKey: 'smartphone',
    iconClass: 'bg-violet-100 text-violet-700',
    sortOrder: 4,
    tasks: [
      'Location Listed on App',
      'Hours Updated on App',
      'Ready to Receive Orders',
      'Loyalty Activated',
    ],
  },
];

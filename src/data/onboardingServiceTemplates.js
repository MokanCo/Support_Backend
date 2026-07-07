/**
 * Reusable onboarding service task templates.
 * Synced into MongoDB via onboardingTemplateService — not used directly in request handlers.
 *
 * Four global categories:
 * 1. Business Listings — Google, Apple, Yelp
 * 2. Website Listing
 * 3. Geo Tagging Listing — Facebook, Instagram, TikTok
 * 4. Delivery Services
 */
export const ONBOARDING_SERVICE_TEMPLATE_DEFS = [
  // ── Business Listings ─────────────────────────────────────────────────────
  {
    slug: "google",
    title: "Google Business Profile",
    section: "Business Listings",
    iconKey: "globe",
    iconClass: "bg-blue-100 text-blue-600",
    sortOrder: 0,
    tasks: ["Website URL Added", "Phone Number"],
  },
  {
    slug: "apple",
    title: "Apple Business Connect",
    section: "Business Listings",
    iconKey: "smartphone",
    iconClass: "bg-slate-100 text-slate-700",
    sortOrder: 1,
    tasks: [
      "Business Verified on Apple",
      "Ownership Verified",
      "Logo Updated",
      "Hours Updated",
    ],
  },
  {
    slug: "yelp",
    title: "Yelp",
    section: "Business Listings",
    iconKey: "star",
    iconClass: "bg-red-100 text-red-700",
    sortOrder: 2,
    tasks: [
      "Business Verified on Yelp",
      "Ownership Verified",
      "Logo Updated",
      "Hours Updated",
    ],
  },

  // ── Website Listing ───────────────────────────────────────────────────────
  {
    slug: "website",
    title: "Website",
    section: "Website Listing",
    iconKey: "globe",
    iconClass: "bg-sky-100 text-sky-700",
    sortOrder: 3,
    tasks: ["Location is Activated on Website"],
  },

  // ── Geo Tagging Listing ───────────────────────────────────────────────────
  {
    slug: "facebook",
    title: "Facebook",
    section: "Geo Tagging Listing",
    iconKey: "facebook",
    iconClass: "bg-blue-100 text-blue-700",
    sortOrder: 4,
    tasks: [
      "Store Information Verified",
      "Address Confirmed",
      "Hours Confirmed",
      "Store Created",
    ],
  },
  {
    slug: "instagram",
    title: "Instagram",
    section: "Geo Tagging Listing",
    iconKey: "instagram",
    iconClass: "bg-pink-100 text-pink-700",
    sortOrder: 5,
    tasks: [
      "Store Information Verified",
      "Address Confirmed",
      "Hours Confirmed",
      "Store Created",
    ],
  },
  {
    slug: "tiktok",
    title: "TikTok",
    section: "Geo Tagging Listing",
    iconKey: "video",
    iconClass: "bg-slate-100 text-slate-900",
    sortOrder: 6,
    tasks: [
      "Store Information Verified",
      "Address Confirmed",
      "Hours Confirmed",
      "Store Created",
    ],
  },

  // ── Third Party ───────────────────────────────────────────────────────────
  {
    slug: "appfront",
    title: "Appfront",
    section: "Third Party",
    iconKey: "monitor-smartphone",
    iconClass: "bg-violet-100 text-violet-700",
    sortOrder: 8,
    tasks: [
      "Account Created",
      "Menu Configured",
      "Branding Applied",
      "Ordering Activated",
      "Loyalty Program Set Up",
    ],
  },

  // ── Delivery Services ─────────────────────────────────────────────────────
  {
    slug: "delivery",
    title: "Delivery & Ordering App",
    section: "Delivery Services",
    iconKey: "smartphone",
    iconClass: "bg-violet-100 text-violet-700",
    sortOrder: 9,
    tasks: [
      "Location Listed on App",
      "Hours Updated on App",
      "Ready to Receive Orders",
      "Loyalty Activated",
    ],
  },
];

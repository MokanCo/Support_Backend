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
    tasks: [
      "Listing Creation",
      "Listing Optimization",
      "Verification request submitted",
      "Verification Completed",
      "Live listing Check",
      "Business Verified on Google",
    ],
  },
  {
    slug: "apple",
    title: "Apple Business Connect",
    section: "Business Listings",
    iconKey: "smartphone",
    iconClass: "bg-slate-100 text-slate-700",
    sortOrder: 1,
    tasks: [
      "Listing Creation",
      "Listing Optimization",
      "Verification request submitted",
      "Verification Completed",
      "Live listing Check",
      "Business Verified on Apple",
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
      "Listing Creation",
      "Listing Optimization",
      "Verification request submitted",
      "Verification Completed",
      "Live listing Check",
      "Business Verified on Yelp",
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
    tasks: [
      "Location Listed on website",
      "Hours Updated",
      "Redirection Links Added",
      "Forms Integrated",
    ],
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
      "Store Location Creation",
      "Store Optimization",
      "Location Publishing",
      "Geo Tag Verification",
      "Store Live on Facebook",
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
      "Store Location Creation",
      "Store Optimization",
      "Location Publishing",
      "Geo Tag Verification",
      "Store Live on Instagram",
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
      "Store Location Creation",
      "Store Optimization",
      "Location Publishing",
      "Geo Tag Verification",
      "Store Live on TikTok",
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
      "Location Registered in Appfront",
      "Information Verified",
      "Ready to Receive Orders",
      "Loyalty Activated",
    ],
  },
];

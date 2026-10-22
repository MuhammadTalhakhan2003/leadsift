import type { Icp } from "./types";

// A realistic messy list for a searcher looking at home-services businesses:
// owner-run HVAC/plumbing companies mixed with a national chain, a franchise, a
// publicly owned brand, a site behind a bot wall, a duplicate URL and a junk row.
export const SAMPLE: { icp: Icp; domains: string[] } = {
  icp: { preset: "acquisition", industries: ["hvac", "plumbing", "heating"], locations: [], minYears: 15 },
  domains: [
    "mckellipsandsons.com",
    "3rdgplumbing.com",
    "trmillerheating.com",
    "kingplumbing-hvac.com",
    "https://www.mckellipsandsons.com/about-us/",
    "rotorooter.com",
    "mrrooter.com",
    "uttkeheating.com",
    "lehmans.com",
    "harryanddavid.com",
    "not a website",
  ],
};

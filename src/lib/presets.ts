import type { Icp, PresetId } from "./types";

export interface Preset {
  id: PresetId;
  label: string;
  persona: string;
  blurb: string;
  defaults: Omit<Icp, "preset">;
  /** Phrases that suggest an opportunity for this persona, with the points each is worth. */
  opportunity: { label: string; re: RegExp; points: number }[];
  /** Phrases that make a lead a poor fit. */
  risks: { label: string; re: RegExp; points: number }[];
}

export const PRESETS: Record<PresetId, Preset> = {
  acquisition: {
    id: "acquisition",
    label: "Acquisition targets",
    persona: "Search funds, ETA buyers, PE deal teams",
    blurb: "Owner-operated, established businesses that may be ready for a succession conversation.",
    defaults: { industries: [], locations: [], minYears: 15 },
    opportunity: [
      { label: "Family / owner-operated", re: /family[- ]owned|family[- ]operated|owner[- ]operated|locally owned|independently owned/i, points: 10 },
      { label: "Multi-generation business", re: /(second|third|fourth|2nd|3rd|4th)[- ]generation/i, points: 8 },
      { label: "Founder still involved", re: /\b(founder|owner)\b[^.]{0,60}\b(still|continues|personally)\b/i, points: 6 },
      { label: "Recurring / service revenue", re: /maintenance (plans?|agreements?|contracts?)|service agreements?|recurring|subscription|annual contracts?/i, points: 6 },
      { label: "Commercial / B2B customers", re: /\bcommercial\b|\bindustrial\b|\bB2B\b|business clients|municipal/i, points: 4 },
    ],
    risks: [
      { label: "Franchise location", re: /franchise (location|owner)|independently owned and operated franchise|a franchise of/i, points: -10 },
      { label: "Already PE-backed / acquired", re: /portfolio company|backed by .{0,40}(capital|partners|equity)|acquired by|a subsidiary of|part of the .{0,30} family of companies/i, points: -12 },
      { label: "Publicly traded", re: /nasdaq|nyse:|investor relations/i, points: -15 },
    ],
  },
  sales: {
    id: "sales",
    label: "B2B sales prospects",
    persona: "SDRs, agencies, B2B SaaS sellers",
    blurb: "Growing companies with budget and an active buying signal.",
    defaults: { industries: [], locations: [], minYears: 0 },
    opportunity: [
      { label: "Hiring right now", re: /we('| a)re hiring|join our team|open positions|now hiring|careers/i, points: 10 },
      { label: "Growth language", re: /fast[- ]growing|rapidly growing|expanding|new location|recently opened|series [a-c]\b|raised \$/i, points: 8 },
      { label: "Sells to businesses", re: /\bB2B\b|enterprise|for businesses|for teams|request a demo|book a demo/i, points: 6 },
      { label: "Multiple locations", re: /\blocations\b|offices in|branches/i, points: 6 },
    ],
    risks: [
      { label: "Very large enterprise", re: /fortune 500 company|nasdaq|nyse:|investor relations/i, points: -10 },
      { label: "Site looks inactive", re: /coming soon|under construction|domain (is )?for sale/i, points: -20 },
    ],
  },
};

// Transparent, rule-based score. Every point maps to a visible signal so a rep can
// see *why* a lead ranks where it does. Claude's judgement is blended in when available.

import { PRESETS } from "./presets";
import type { EmailResult, Icp, Person, ScoreBreakdown, Signal, Tier } from "./types";

export interface ScoreInput {
  icp: Icp;
  reachable: boolean;
  text: string;
  description: string;
  location: string | null;
  yearsInBusiness: number | null;
  foundedEvidence: string | null;
  emails: EmailResult[];
  phones: string[];
  socials: Record<string, string>;
  people: Person[];
  hiring: boolean;
  copyrightYear: number | null;
}

export function heuristicScore(input: ScoreInput): { score: Omit<ScoreBreakdown, "ai" | "final">; signals: Signal[] } {
  const signals: Signal[] = [];
  const preset = PRESETS[input.icp.preset];
  const haystack = `${input.description} ${input.text}`.toLowerCase();

  if (!input.reachable) {
    signals.push({ label: "Website unreachable", kind: "risk" });
    return { score: { fit: 0, contact: 0, opportunity: 0, penalties: 0, heuristic: 0 }, signals };
  }

  // ---- Fit (0-40) ----
  let fit = 0;
  if (input.icp.industries.length === 0) {
    fit += 10; // no industry filter: neutral credit
  } else {
    const hits = input.icp.industries.filter((k) => hasWord(haystack, k));
    if (hits.length) {
      fit += Math.min(20, 12 + hits.length * 4);
      signals.push({ label: `Matches ${hits.slice(0, 3).join(", ")}`, kind: "fit" });
    }
  }
  if (input.icp.locations.length === 0) {
    fit += 5;
  } else {
    // Short codes like "il" only count against the detected address, not free text.
    const hit = input.icp.locations.find(
      (l) => hasWord((input.location ?? "").toLowerCase(), l) || (l.length > 3 && hasWord(haystack, l)),
    );
    if (hit) {
      fit += 10;
      signals.push({ label: `Located in ${hit}`, kind: "fit" });
    }
  }
  if (input.yearsInBusiness !== null) {
    if (input.yearsInBusiness >= input.icp.minYears) {
      fit += 10;
      signals.push({
        label: `${input.yearsInBusiness} years in business`,
        kind: "fit",
        evidence: input.foundedEvidence ?? undefined,
      });
    } else {
      signals.push({ label: `Only ${input.yearsInBusiness} years in business`, kind: "risk" });
    }
  } else if (input.icp.minYears === 0) {
    fit += 5;
  }

  // ---- Contactability (0-30) ----
  let contact = 0;
  const best = input.emails[0];
  if (best?.confidence === "high") {
    contact += 15;
    signals.push({ label: "Direct email on company domain", kind: "contact", evidence: best.address });
  } else if (best?.confidence === "medium") {
    contact += 9;
    signals.push({ label: best.roleBased ? "Shared inbox email only" : "Verified email", kind: "contact", evidence: best.address });
  } else if (best) {
    contact += 3;
  }
  if (input.phones.length) {
    contact += 7;
    signals.push({ label: "Phone number listed", kind: "contact" });
  }
  if (input.people.length) {
    contact += 5;
    signals.push({ label: `Decision maker: ${input.people[0].name}`, kind: "contact", evidence: input.people[0].title });
  }
  if (input.socials.linkedin) contact += 3;
  contact = Math.min(30, contact);

  // ---- Opportunity (0-30) & penalties ----
  let opportunity = 0;
  for (const o of preset.opportunity) {
    const m = haystack.match(o.re);
    if (m) {
      opportunity += o.points;
      signals.push({ label: o.label, kind: "opportunity", evidence: snippet(haystack, m.index ?? 0) });
    }
  }
  if (input.icp.preset === "sales" && input.hiring && !signals.some((s) => s.label === "Hiring right now")) {
    opportunity += 10;
    signals.push({ label: "Hiring right now", kind: "opportunity", evidence: "Careers page found" });
  }
  if (input.icp.preset === "acquisition" && (input.yearsInBusiness ?? 0) >= 25) {
    opportunity += 6;
    signals.push({ label: "Long-tenured owner likely nearing succession", kind: "opportunity" });
  }
  opportunity = Math.min(30, opportunity);

  let penalties = 0;
  for (const r of preset.risks) {
    const m = haystack.match(r.re);
    if (m) {
      penalties += r.points;
      signals.push({ label: r.label, kind: "risk", evidence: snippet(haystack, m.index ?? 0) });
    }
  }
  const thisYear = new Date().getFullYear();
  if (input.copyrightYear && thisYear - input.copyrightYear >= 4) {
    penalties -= 5;
    signals.push({ label: `Website not updated since ${input.copyrightYear}`, kind: "risk" });
  }

  const heuristic = clamp(fit + contact + opportunity + penalties);
  return { score: { fit, contact, opportunity, penalties, heuristic }, signals };
}

export function finalScore(heuristic: number, ai: number | null): number {
  // Rules keep the score explainable; the LLM catches fit that keywords miss.
  return ai === null ? heuristic : clamp(Math.round(heuristic * 0.55 + ai * 0.45));
}

export function tierFor(score: number): Tier {
  if (score >= 65) return "hot";
  if (score >= 40) return "warm";
  return "cold";
}

/** Whole-word, case-insensitive match; allows simple plurals ("plumber" → "plumbers"). */
function hasWord(text: string, word: string): boolean {
  const escaped = word.toLowerCase().trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return escaped !== "" && new RegExp(`\\b${escaped}(s|es)?\\b`, "i").test(text);
}

function clamp(n: number) {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function snippet(text: string, index: number): string {
  return text.slice(Math.max(0, index - 40), index + 80).trim();
}

// One domain in, one qualified lead out:
// homepage -> robots-allowed subpages -> extract -> verify emails -> score -> Claude.

import { aiModel, qualifyWithAi } from "./ai";
import { cacheGet, cacheSet } from "./cache";
import { verifyEmails } from "./email";
import { extractFacts, pickSubpages, type PageFacts } from "./extract";
import { fetchHomepage, fetchPage, loadRobots } from "./fetcher";
import { finalScore, heuristicScore, tierFor } from "./score";
import type { Icp, Lead, Person } from "./types";

const LEAD_TTL_MS = 24 * 60 * 60_000;
const PIPELINE_VERSION = "v5";

export async function qualifyDomain(domain: string, icp: Icp, inputName?: string): Promise<Lead> {
  const started = Date.now();
  const key = `lead:${PIPELINE_VERSION}:${domain}:${hashIcp(icp)}:${aiModel() ?? "rules"}`;
  const cached = await cacheGet<Lead>(key);
  if (cached) return { ...cached, inputName: inputName ?? cached.inputName, fromCache: true, durationMs: Date.now() - started };

  const lead = await runPipeline(domain, icp, inputName);
  lead.durationMs = Date.now() - started;
  // Don't cache a lead whose AI step failed (rate limit, bad key): retry it next run.
  if (lead.reachable && (lead.ai || !aiModel())) await cacheSet(key, lead, LEAD_TTL_MS);
  return lead;
}

async function runPipeline(domain: string, icp: Icp, inputName?: string): Promise<Lead> {
  const home = await fetchHomepage(domain);
  if (!home.html || home.blocked) {
    const { score, signals } = heuristicScore({
      icp, reachable: false, text: "", description: "", location: null, yearsInBusiness: null,
      foundedEvidence: null, emails: [], phones: [], socials: {}, people: [], hiring: false, copyrightYear: null,
    });
    return {
      ...emptyLead(domain, inputName),
      url: home.url,
      blockedReason: home.blocked ?? "Empty response",
      signals,
      score: { ...score, ai: null, final: 0 },
    };
  }

  const homeFacts = extractFacts(home.html, home.url);
  const origin = new URL(home.url).origin;
  const robots = await loadRobots(origin);
  const subpages = pickSubpages(homeFacts.links, home.url).filter((u) => robots.isAllowed(new URL(u).pathname));

  const pages: { url: string; facts: PageFacts }[] = [{ url: home.url, facts: homeFacts }];
  const fetched = await Promise.all(subpages.map((u) => fetchPage(u)));
  for (const p of fetched) {
    if (p.html && !p.blocked) pages.push({ url: p.url, facts: extractFacts(p.html, p.url) });
  }

  const merged = mergeFacts(pages.map((p) => p.facts));
  const hiring = homeFacts.links.some((l) => /careers|jobs|join-our-team|hiring/i.test(l));
  const foundedYear = merged.foundedYear;
  const yearsInBusiness = foundedYear ? new Date().getFullYear() - foundedYear : null;
  const emails = await verifyEmails(merged.emails, domain, merged.people);
  const phones = merged.phones.map((p) => p.number).slice(0, 4);
  const allText = pages.map((p) => p.facts.text).join(" ");
  const name = inputName || cleanName(merged.siteName || merged.title, domain);

  const { score, signals } = heuristicScore({
    icp,
    reachable: true,
    text: allText,
    description: merged.description,
    location: merged.location,
    yearsInBusiness,
    foundedEvidence: merged.foundedEvidence,
    emails,
    phones,
    socials: merged.socials,
    people: merged.people,
    hiring,
    copyrightYear: copyrightYear(allText),
  });

  const facts = [
    `Description: ${merged.description || "n/a"}`,
    `Founded: ${foundedYear ?? "unknown"}${merged.foundedEvidence ? ` ("${merged.foundedEvidence}")` : ""}`,
    `Location: ${merged.location ?? "unknown"}`,
    `People: ${merged.people.map((p) => `${p.name} (${p.title})`).join("; ") || "none found"}`,
    `Tech: ${merged.tech.join(", ") || "none detected"}`,
    `Hiring page: ${hiring ? "yes" : "no"}`,
    `Rule-based signals: ${signals.map((s) => s.label).join("; ")}`,
  ].join("\n");

  const ai = await qualifyWithAi({
    domain,
    name,
    icp,
    facts,
    pages: pages.map((p) => ({ url: p.url, text: p.facts.text })),
  });

  const final = finalScore(score.heuristic, ai?.fitScore ?? null);
  return {
    ...emptyLead(domain, inputName),
    name,
    url: home.url,
    reachable: true,
    description: ai?.summary || merged.description,
    foundedYear,
    yearsInBusiness,
    location: merged.location,
    emails,
    phones,
    socials: merged.socials,
    people: merged.people,
    tech: merged.tech,
    hiring,
    pagesScanned: pages.map((p) => p.url),
    signals,
    score: { ...score, ai: ai?.fitScore ?? null, final },
    tier: tierFor(final),
    ai,
  };
}

function mergeFacts(all: PageFacts[]) {
  const first = all[0];
  const emails = new Map<string, string>();
  const phones = new Map<string, string>();
  const people = new Map<string, Person>();
  const socials: Record<string, string> = {};
  const tech = new Set<string>();
  let foundedYear: number | null = null;
  let foundedEvidence: string | null = null;
  let location: string | null = null;

  for (const f of all) {
    f.emails.forEach((e) => emails.has(e.address) || emails.set(e.address, e.source));
    f.phones.forEach((p) => phones.has(p.number) || phones.set(p.number, p.source));
    f.people.forEach((p) => people.has(p.name) || people.set(p.name, p));
    Object.entries(f.socials).forEach(([k, v]) => (socials[k] ??= v));
    f.tech.forEach((t) => tech.add(t));
    // The oldest year mentioned is usually the founding year ("since 1978").
    if (f.foundedYear && (!foundedYear || f.foundedYear < foundedYear)) {
      foundedYear = f.foundedYear;
      foundedEvidence = f.foundedEvidence;
    }
    location ??= f.location;
  }

  return {
    title: first.title,
    siteName: first.siteName,
    description: first.description,
    emails: [...emails].map(([address, source]) => ({ address, source })),
    phones: [...phones].map(([number, source]) => ({ number, source })),
    people: [...people.values()],
    socials,
    tech: [...tech],
    foundedYear,
    foundedEvidence,
    location,
  };
}

function cleanName(title: string, domain: string): string {
  const part = title.split(/\s*[|–—:]\s+|\s-\s/)[0].trim();
  if (part && part.length <= 60 && !/^home$/i.test(part)) return part;
  const base = domain.split(".")[0];
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function copyrightYear(text: string): number | null {
  const years = [...text.matchAll(/(?:©|&copy;|copyright)\s*(?:\d{4}\s*[-–]\s*)?((?:19|20)\d{2})/gi)].map((m) => Number(m[1]));
  return years.length ? Math.max(...years) : null;
}

function hashIcp(icp: Icp): string {
  const s = JSON.stringify([icp.preset, [...icp.industries].sort(), [...icp.locations].sort(), icp.minYears]);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function emptyLead(domain: string, inputName?: string): Lead {
  return {
    id: domain,
    domain,
    inputName,
    name: inputName || domain,
    url: null,
    reachable: false,
    description: "",
    foundedYear: null,
    yearsInBusiness: null,
    location: null,
    emails: [],
    phones: [],
    socials: {},
    people: [],
    tech: [],
    hiring: false,
    pagesScanned: [],
    signals: [],
    score: { fit: 0, contact: 0, opportunity: 0, penalties: 0, heuristic: 0, ai: null, final: 0 },
    tier: "cold",
    ai: null,
    fromCache: false,
    durationMs: 0,
  };
}

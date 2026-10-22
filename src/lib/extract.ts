// Pulls sales-relevant facts out of raw HTML: contacts, people, founding year,
// location, tech stack and ownership/succession language. Structured data
// (schema.org JSON-LD) is preferred; regexes over visible text fill the gaps.

import * as cheerio from "cheerio";

export interface PageFacts {
  title: string;
  siteName: string;
  description: string;
  emails: { address: string; source: string }[];
  phones: { number: string; source: string }[];
  socials: Record<string, string>;
  people: { name: string; title: string; source: string }[];
  foundedYear: number | null;
  foundedEvidence: string | null;
  location: string | null;
  tech: string[];
  links: string[];
  text: string;
}

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,24}/gi;
const OBFUSCATED_EMAIL_RE =
  /([a-z0-9._%+-]+)\s*[[(]\s*at\s*[\])]\s*([a-z0-9-]+)\s*[[(]\s*dot\s*[\])]\s*([a-z]{2,24})/gi;
const PHONE_RE = /(?:\+?1[\s.-]?)?\(?([2-9]\d{2})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})\b/g;
const JUNK_EMAIL = /(\.(png|jpe?g|gif|svg|webp)$)|example\.|sentry|wixpress|godaddy|domain\.com|email\.com|yourdomain/i;

const SOCIAL_HOSTS: Record<string, RegExp> = {
  linkedin: /linkedin\.com\/(company|in)\//i,
  facebook: /facebook\.com\/(?!sharer|dialog)/i,
  x: /(twitter|x)\.com\/(?!intent|share)/i,
  instagram: /instagram\.com\//i,
  youtube: /youtube\.com\/(c\/|channel\/|@|user\/)/i,
};

const TECH_FINGERPRINTS: [string, RegExp][] = [
  ["WordPress", /wp-content|wp-includes/i],
  ["Shopify", /cdn\.shopify\.com/i],
  ["Wix", /wix\.com|wixstatic/i],
  ["Squarespace", /squarespace/i],
  ["Webflow", /webflow/i],
  ["HubSpot", /js\.hs-scripts\.com|hs-analytics|hubspot/i],
  ["Salesforce", /pardot|salesforce/i],
  ["Google Analytics", /googletagmanager|google-analytics|gtag\(/i],
  ["Intercom", /intercom/i],
  ["Calendly", /calendly\.com/i],
  ["Stripe", /js\.stripe\.com/i],
  ["Zendesk", /zendesk|zdassets/i],
];

const TITLE_WORDS =
  "Owner|Co-Owner|Founder|Co-Founder|President|CEO|Chief Executive Officer|Principal|Managing Partner|Managing Director|General Manager|Proprietor";
const PERSON_BEFORE_TITLE = new RegExp(
  `\\b([A-Z][a-z]+(?:\\s[A-Z]\\.)?\\s[A-Z][a-zA-Z'-]+)\\s*[,\\-–|]\\s*(${TITLE_WORDS})\\b`,
  "g",
);
const TITLE_BEFORE_PERSON = new RegExp(
  `\\b(${TITLE_WORDS})\\s*[,:\\-–|]?\\s+([A-Z][a-z]+(?:\\s[A-Z]\\.)?\\s[A-Z][a-zA-Z'-]+)\\b`,
  "g",
);
const NOT_A_NAME = /^(Our|The|About|Contact|Meet|Read|Learn|Home|Click|View|Call|Email|Team)\b/;

export function extractFacts(html: string, pageUrl: string): PageFacts {
  const $ = cheerio.load(html);
  const host = new URL(pageUrl).hostname.replace(/^www\./, "");

  const jsonLd = readJsonLd($);

  const links: string[] = [];
  const emails = new Map<string, string>();
  const phones = new Map<string, string>();
  const socials: Record<string, string> = {};

  $("a[href]").each((_, el) => {
    const href = ($(el).attr("href") ?? "").trim();
    if (href.startsWith("mailto:")) {
      const addr = decodeURIComponent(href.slice(7).split("?")[0]).toLowerCase();
      if (addr.includes("@")) emails.set(addr, "mailto link");
      return;
    }
    if (href.startsWith("tel:")) {
      const n = normalizePhone(href.slice(4));
      if (n) phones.set(n, "tel link");
      return;
    }
    let abs: URL;
    try {
      abs = new URL(href, pageUrl);
    } catch {
      return;
    }
    for (const [name, re] of Object.entries(SOCIAL_HOSTS)) {
      if (!socials[name] && re.test(abs.href)) socials[name] = abs.href.split("?")[0];
    }
    if (abs.hostname.replace(/^www\./, "") === host && /^https?:$/.test(abs.protocol)) {
      links.push(abs.origin + abs.pathname);
    }
  });

  // Visible text only: scripts, styles and SVG would add noise.
  const raw = html;
  $("script, style, noscript, svg, iframe").remove();
  // Cheerio concatenates sibling elements with no whitespace ("Jane DoeOwner").
  $("p, div, li, td, th, h1, h2, h3, h4, h5, h6, span, a, br, section, header, footer, address").after(" ");
  const text = $("body").text().replace(/\s+/g, " ").trim();

  for (const m of text.matchAll(EMAIL_RE)) {
    const addr = m[0].toLowerCase().replace(/\.$/, "");
    if (!emails.has(addr)) emails.set(addr, "page text");
  }
  for (const m of text.matchAll(OBFUSCATED_EMAIL_RE)) {
    emails.set(`${m[1]}@${m[2]}.${m[3]}`.toLowerCase(), "obfuscated text");
  }
  for (const m of text.matchAll(PHONE_RE)) {
    const n = normalizePhone(m[0]);
    if (n && !phones.has(n)) phones.set(n, "page text");
  }
  for (const e of jsonLd.emails) emails.set(e.toLowerCase(), "structured data");
  for (const p of jsonLd.phones) {
    const n = normalizePhone(p);
    if (n) phones.set(n, "structured data");
  }
  for (const s of jsonLd.sameAs) {
    for (const [name, re] of Object.entries(SOCIAL_HOSTS)) {
      if (!socials[name] && re.test(s)) socials[name] = s;
    }
  }

  const founded = jsonLd.foundingYear
    ? { year: jsonLd.foundingYear, evidence: "schema.org foundingDate" }
    : findFoundedYear(text);

  return {
    title: decodeEntities($("title").first().text().trim()),
    siteName: decodeEntities(jsonLd.name || $('meta[property="og:site_name"]').attr("content")?.trim() || ""),
    description: decodeEntities(
      $('meta[name="description"]').attr("content")?.trim() ||
        $('meta[property="og:description"]').attr("content")?.trim() ||
        "",
    ).slice(0, 300),
    emails: [...emails]
      .filter(([a]) => !JUNK_EMAIL.test(a) && a.length < 80)
      .map(([address, source]) => ({ address, source })),
    phones: [...phones].map(([number, source]) => ({ number, source })),
    socials,
    people: findPeople(text, jsonLd.people),
    foundedYear: founded?.year ?? null,
    foundedEvidence: founded?.evidence ?? null,
    location: jsonLd.location ?? findUsLocation(text),
    tech: TECH_FINGERPRINTS.filter(([, re]) => re.test(raw)).map(([name]) => name),
    links: [...new Set(links)],
    text,
  };
}

const US_STATES =
  "AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC";
const US_ADDRESS_RE = new RegExp(`\\b([A-Z][a-zA-Z.]+(?: [A-Z][a-zA-Z.]+){0,2}),\\s*(${US_STATES})\\s+\\d{5}(?:-\\d{4})?\\b`);

/** "Springfield, OH 45502" in a footer is the most common way small businesses list HQ. */
function findUsLocation(text: string): string | null {
  const m = text.match(US_ADDRESS_RE);
  if (!m) return null;
  // The regex can swallow the end of a street line ("Aero Dr Plainfield").
  const city = m[1].replace(/^.*\b(?:St|Ave|Rd|Dr|Blvd|Ln|Way|Ct|Pkwy|Hwy|Suite|Ste|Street|Avenue|Road|Drive)\.?\s+/, "");
  return `${city}, ${m[2]}`;
}

/** Some sites double-encode titles and JSON-LD ("Lehman&#39;s"). */
function decodeEntities(s: string): string {
  return s.includes("&") ? cheerio.load(`<p>${s}</p>`)("p").text() : s;
}

export function normalizePhone(input: string): string | null {
  const digits = input.replace(/[^\d+]/g, "").replace(/^\+?1(?=\d{10}$)/, "");
  const d = digits.replace(/\D/g, "");
  if (d.length === 10 && /^[2-9]/.test(d)) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  if (digits.startsWith("+") && d.length >= 8 && d.length <= 15) return `+${d}`;
  return null;
}

function findFoundedYear(text: string): { year: number; evidence: string } | null {
  const now = new Date().getFullYear();
  // Sites mention many years ("since 2007 we've offered..."). Explicit founding language
  // wins; otherwise take the oldest "since 19xx" / "over 50 years" claim.
  const oldest = (re: RegExp, toYear: (m: RegExpMatchArray) => number) => {
    let best: { year: number; evidence: string } | null = null;
    for (const m of text.matchAll(re)) {
      const year = toYear(m);
      if (year > 1700 && year <= now && (!best || year < best.year)) best = { year, evidence: m[0] };
    }
    return best;
  };
  const strong = oldest(/\b(?:founded|established|est\.|incorporated)\s*(?:in\s*)?((?:17|18|19|20)\d{2})\b/gi, (m) => Number(m[1]));
  if (strong) return strong;
  const since = oldest(/\b(?:since|started in|opened (?:our doors )?in)\s*((?:17|18|19|20)\d{2})\b/gi, (m) => Number(m[1]));
  const years = oldest(/\b(?:over|more than|nearly|for)\s+(\d{2,3})\s+years\b/gi, (m) => {
    const n = Number(m[1]);
    return n >= 3 && n < 250 ? now - n : 0;
  });
  if (since && years) return since.year <= years.year ? since : years;
  return since ?? years;
}

function findPeople(
  text: string,
  structured: { name: string; title: string }[],
): { name: string; title: string; source: string }[] {
  const found = new Map<string, { name: string; title: string; source: string }>();
  for (const p of structured) found.set(p.name, { ...p, source: "structured data" });
  for (const m of text.matchAll(PERSON_BEFORE_TITLE)) {
    if (!NOT_A_NAME.test(m[1]) && !found.has(m[1])) found.set(m[1], { name: m[1], title: m[2], source: "page text" });
  }
  for (const m of text.matchAll(TITLE_BEFORE_PERSON)) {
    if (!NOT_A_NAME.test(m[2]) && !found.has(m[2])) found.set(m[2], { name: m[2], title: m[1], source: "page text" });
  }
  return [...found.values()].slice(0, 5);
}

interface JsonLdFacts {
  name: string;
  emails: string[];
  phones: string[];
  sameAs: string[];
  foundingYear: number | null;
  location: string | null;
  people: { name: string; title: string }[];
}

function readJsonLd($: cheerio.CheerioAPI): JsonLdFacts {
  const out: JsonLdFacts = { name: "", emails: [], phones: [], sameAs: [], foundingYear: null, location: null, people: [] };
  $('script[type="application/ld+json"]').each((_, el) => {
    let data: unknown;
    try {
      data = JSON.parse($(el).contents().text());
    } catch {
      return;
    }
    for (const node of flatten(data)) {
      const type = String(node["@type"] ?? "");
      if (/Organization|LocalBusiness|Corporation|Store|Service|Contractor|Professional/i.test(type)) {
        if (!out.name && typeof node.name === "string") out.name = node.name;
        if (typeof node.email === "string") out.emails.push(node.email.replace(/^mailto:/, ""));
        if (typeof node.telephone === "string") out.phones.push(node.telephone);
        if (Array.isArray(node.sameAs)) out.sameAs.push(...node.sameAs.filter((s): s is string => typeof s === "string"));
        if (typeof node.foundingDate === "string") {
          const y = Number(node.foundingDate.slice(0, 4));
          if (y > 1800) out.foundingYear = y;
        }
        const addr = node.address as Record<string, unknown> | undefined;
        if (addr && typeof addr === "object" && !out.location) {
          const parts = [addr.addressLocality, addr.addressRegion].filter((p) => typeof p === "string" && p);
          if (parts.length) out.location = parts.join(", ");
        }
        for (const key of ["founder", "employee"]) {
          const people = ([] as unknown[]).concat(node[key] ?? []);
          for (const p of people) {
            if (p && typeof p === "object" && typeof (p as Record<string, unknown>).name === "string") {
              const rec = p as Record<string, unknown>;
              out.people.push({
                name: rec.name as string,
                title: typeof rec.jobTitle === "string" ? rec.jobTitle : key === "founder" ? "Founder" : "",
              });
            }
          }
        }
      }
    }
  });
  return out;
}

function flatten(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data.flatMap(flatten);
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    return [obj, ...(obj["@graph"] ? flatten(obj["@graph"]) : [])];
  }
  return [];
}

/** Internal links worth a second request: who runs the company and how to reach them. */
export function pickSubpages(links: string[], homepage: string, limit = 4): string[] {
  const priority = [
    /about|our-story|history|who-we-are|company/i,
    /team|leadership|staff|people|owner|management/i,
    /contact/i,
    /careers|jobs|join|hiring/i,
  ];
  const home = new URL(homepage);
  const picked: string[] = [];
  for (const re of priority) {
    const match = links.find(
      (l) => re.test(new URL(l).pathname) && l !== home.origin + home.pathname && !picked.includes(l),
    );
    if (match) picked.push(match);
    if (picked.length >= limit) break;
  }
  return picked;
}

// Turn messy user input (URLs, emails, "Acme Inc - acme.com") into clean, de-duplicated domains.

const DOMAIN_RE = /([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}/i;

export function normalizeDomain(raw: string): string | null {
  let s = raw.trim().toLowerCase();
  if (!s) return null;
  // An email address: keep the domain part.
  if (s.includes("@") && !s.includes("/")) s = s.split("@").pop()!;
  s = s.replace(/^[a-z]+:\/\//, "").replace(/^www\./, "");
  s = s.split(/[/?#\s]/)[0];
  const m = s.match(DOMAIN_RE);
  if (!m) return null;
  const domain = m[0].replace(/^www\./, "");
  // Never let user input point the scraper at internal infrastructure.
  if (/\.(local|localhost|internal|lan|home|corp|test|invalid)$/.test(domain)) return null;
  return domain;
}

export interface InputRow {
  domain: string;
  name?: string;
}

/** Normalizes and de-duplicates rows; returns the clean rows plus how many were dropped. */
export function dedupeRows(rows: { raw: string; name?: string }[]): {
  rows: InputRow[];
  duplicates: number;
  invalid: number;
} {
  const seen = new Map<string, InputRow>();
  let duplicates = 0;
  let invalid = 0;
  for (const r of rows) {
    const domain = normalizeDomain(r.raw);
    if (!domain) {
      invalid++;
      continue;
    }
    if (seen.has(domain)) {
      duplicates++;
      continue;
    }
    seen.set(domain, { domain, name: r.name?.trim() || undefined });
  }
  return { rows: [...seen.values()], duplicates, invalid };
}

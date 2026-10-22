// Email validation without sending mail: syntax, MX records, role-based and
// free-provider detection. SMTP "ping" checks are deliberately skipped: they are
// unreliable (catch-all servers, greylisting), port 25 is blocked on serverless
// hosts, and they look like abuse to the receiving server.

import { resolveMx } from "node:dns/promises";
import type { EmailResult, EmailStatus, Person } from "./types";

const SYNTAX = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,24}$/i;
const ROLE = /^(info|contact|hello|sales|support|admin|office|service|help|team|enquiries|inquiries|marketing|billing|accounts|hr|jobs|careers|webmaster|noreply|no-reply|mail)$/i;

const mxCache = new Map<string, Promise<boolean>>();

function hasMx(domain: string): Promise<boolean> {
  let p = mxCache.get(domain);
  if (!p) {
    p = resolveMx(domain)
      .then((records) => records.length > 0)
      .catch(() => false);
    mxCache.set(domain, p);
  }
  return p;
}

export async function verifyEmails(
  found: { address: string; source: string }[],
  companyDomain: string,
  people: Person[],
): Promise<EmailResult[]> {
  const unique = new Map<string, string>();
  for (const e of found) {
    const address = e.address.trim().toLowerCase();
    if (!unique.has(address)) unique.set(address, e.source);
  }
  const results = await Promise.all([...unique].map(([address, source]) => verifyOne(address, source, companyDomain, false)));

  // If the site lists a decision maker but no personal inbox, offer the most common
  // B2B pattern as an explicitly-labelled, lower-confidence guess.
  const hasPersonal = results.some((r) => r.onCompanyDomain && !r.roleBased && r.status === "verified-domain");
  const owner = people[0];
  if (!hasPersonal && owner && (await hasMx(companyDomain))) {
    const [first, ...rest] = owner.name.toLowerCase().replace(/[^a-z\s]/g, "").split(/\s+/);
    const last = rest.at(-1);
    if (first && last) {
      results.push(await verifyOne(`${first}@${companyDomain}`, `pattern guess for ${owner.name}`, companyDomain, true));
    }
  }

  return results.sort((a, b) => rank(b) - rank(a));
}

async function verifyOne(
  address: string,
  source: string,
  companyDomain: string,
  guessed: boolean,
): Promise<EmailResult> {
  const [local, domain] = address.split("@");
  let status: EmailStatus = "invalid";
  if (SYNTAX.test(address)) status = (await hasMx(domain)) ? "verified-domain" : "no-mx";

  const roleBased = ROLE.test(local);
  const onCompanyDomain = domain === companyDomain || domain.endsWith(`.${companyDomain}`);
  // Published on the company's own site + deliverable domain = real inbox. Small
  // owner-run businesses often publish a Gmail address, so that still counts as medium.
  let confidence: EmailResult["confidence"] = "low";
  if (status === "verified-domain" && !guessed) {
    confidence = onCompanyDomain && !roleBased ? "high" : "medium";
  }
  return { address, status, roleBased, onCompanyDomain, guessed, confidence, source };
}

function rank(e: EmailResult): number {
  const c = { high: 3, medium: 2, low: 1 }[e.confidence];
  return c * 10 + (e.onCompanyDomain ? 2 : 0) + (e.roleBased ? 0 : 1) - (e.guessed ? 5 : 0);
}

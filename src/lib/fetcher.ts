// Polite page fetcher: robots.txt aware, time- and size-bounded, retries transient
// failures, falls back across https/http and www variants, and caches pages.

import { cacheGet, cacheSet } from "./cache";

const USER_AGENT =
  "Mozilla/5.0 (compatible; LeadSiftBot/1.0; lead qualification; respects robots.txt)";
const TIMEOUT_MS = 8000;
const MAX_BYTES = 1_500_000;
const PAGE_TTL_MS = 7 * 24 * 60 * 60_000;

export interface FetchedPage {
  url: string; // final URL after redirects
  status: number;
  html: string;
  blocked?: string; // why we could not use the page (captcha, robots, ...)
}

async function fetchOnce(url: string): Promise<FetchedPage> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const type = res.headers.get("content-type") ?? "";
  if (!type.includes("html")) {
    return { url: res.url || url, status: res.status, html: "", blocked: `non-HTML (${type || "unknown"})` };
  }
  const html = await readCapped(res);
  return { url: res.url || url, status: res.status, html, blocked: detectBlock(res.status, html) };
}

async function readCapped(res: Response): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  await reader.cancel().catch(() => {});
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/** Bot walls and CAPTCHAs: we report them instead of trying to defeat them. */
function detectBlock(status: number, html: string): string | undefined {
  const head = html.slice(0, 20000).toLowerCase();
  if (head.includes("cf-challenge") || head.includes("just a moment...") || head.includes("cf_chl_"))
    return "Cloudflare challenge";
  if (head.includes("g-recaptcha") && head.length < 15000) return "CAPTCHA";
  if (head.includes("px-captcha") || head.includes("perimeterx")) return "Bot protection";
  if (status === 403 || status === 429) return `HTTP ${status}`;
  if (status >= 400) return `HTTP ${status}`;
  return undefined;
}

/** Fetch with one retry on transient errors (timeouts, 429, 5xx). */
export async function fetchPage(url: string): Promise<FetchedPage> {
  const key = `page:v2:${url}`;
  const cached = await cacheGet<FetchedPage>(key);
  if (cached) return cached;

  // Retry only fast, transient failures (429, 5xx, connection resets). A timeout has
  // already spent its budget, and DNS failures will not fix themselves.
  let last: FetchedPage | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    let retryable: boolean;
    try {
      last = await fetchOnce(url);
      retryable = last.status === 429 || last.status >= 500;
    } catch (err) {
      last = { url, status: 0, html: "", blocked: errorLabel(err) };
      retryable = last.blocked === "ECONNRESET";
    }
    if (!retryable) break;
    await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
  }
  const page = last!;
  // Only cache useful pages; failures should be retried on the next run.
  if (!page.blocked && page.html) await cacheSet(key, page, PAGE_TTL_MS);
  return page;
}

function errorLabel(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === "TimeoutError") return "Timed out";
    const cause = (err as Error & { cause?: { code?: string } }).cause;
    if (cause?.code === "ENOTFOUND") return "Domain does not resolve";
    if (cause?.code) return cause.code;
    return err.message;
  }
  return "Fetch failed";
}

/** Find the first working homepage across https/http and www/apex variants. */
export async function fetchHomepage(domain: string): Promise<FetchedPage> {
  const candidates = [`https://${domain}/`, `https://www.${domain}/`, `http://${domain}/`];
  let first: FetchedPage | null = null;
  for (const url of candidates) {
    const page = await fetchPage(url);
    if (page.html && !page.blocked) return page;
    first ??= page;
    // A bot wall or timeout will not change on another variant; DNS failure on www is final.
    if (page.blocked && !/resolve|ECONN|HTTP 404|non-HTML/.test(page.blocked)) break;
    if (page.blocked === "Domain does not resolve" && url.includes("www.")) break;
  }
  return first!;
}

// ---- robots.txt -----------------------------------------------------------

export interface Robots {
  isAllowed(path: string): boolean;
}

export async function loadRobots(origin: string): Promise<Robots> {
  const key = `robots:v1:${origin}`;
  let rules = await cacheGet<string[]>(key);
  if (!rules) {
    rules = [];
    try {
      const res = await fetch(`${origin}/robots.txt`, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(4000),
      });
      if (res.ok) rules = parseRobots(await res.text());
    } catch {
      // No robots.txt reachable: treat as allow-all, like mainstream crawlers.
    }
    await cacheSet(key, rules, PAGE_TTL_MS);
  }
  const disallow = rules;
  return {
    isAllowed(path: string) {
      return !disallow.some((rule) => rule !== "" && path.startsWith(rule));
    },
  };
}

/** Disallow rules that apply to "*" (we have no named-agent rules of our own). */
function parseRobots(text: string): string[] {
  const out: string[] = [];
  let applies = false;
  let inAgentBlock = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const field = m[1].toLowerCase();
    const value = m[2].trim();
    if (field === "user-agent") {
      if (!inAgentBlock) applies = false;
      inAgentBlock = true;
      if (value === "*") applies = true;
    } else {
      inAgentBlock = false;
      if (applies && field === "disallow") out.push(value.replace(/\*.*$/, ""));
    }
  }
  return out;
}

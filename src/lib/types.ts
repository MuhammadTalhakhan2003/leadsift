// Shared types for the qualification pipeline (server) and the UI (client).

export type PresetId = "acquisition" | "sales";

/** Ideal Customer Profile: what "a good lead" means for this run. */
export interface Icp {
  preset: PresetId;
  /** Industry / offering keywords, e.g. ["hvac", "plumbing"]. */
  industries: string[];
  /** Location keywords, e.g. ["texas", "dallas"]. Empty = anywhere. */
  locations: string[];
  /** Minimum years in business (acquisition targets are usually 10+). */
  minYears: number;
}

export type EmailStatus = "verified-domain" | "no-mx" | "invalid";

export interface EmailResult {
  address: string;
  status: EmailStatus;
  /** info@, sales@ ... reaches a shared inbox, not a decision maker. */
  roleBased: boolean;
  /** Email lives on the company's own domain (vs gmail etc.). */
  onCompanyDomain: boolean;
  /** Derived from a found name + the domain, not seen on the site. */
  guessed: boolean;
  confidence: "high" | "medium" | "low";
  source: string;
}

export interface Person {
  name: string;
  title: string;
  source: string;
}

export interface Signal {
  label: string;
  kind: "fit" | "contact" | "opportunity" | "risk";
  evidence?: string;
}

export interface ScoreBreakdown {
  fit: number; // 0-40
  contact: number; // 0-30
  opportunity: number; // 0-30
  penalties: number; // <= 0
  heuristic: number; // 0-100
  ai: number | null; // 0-100 when Claude ran
  final: number; // 0-100
}

export interface AiInsight {
  summary: string;
  industry: string;
  businessModel: string;
  estimatedSize: string;
  fitScore: number;
  fitReasons: string[];
  risks: string[];
  outreachOpener: string;
  /** Which provider/model produced this, e.g. "Groq · openai/gpt-oss-120b". */
  model: string;
}

export type Tier = "hot" | "warm" | "cold";

export interface Lead {
  id: string; // normalized domain
  domain: string;
  inputName?: string;
  name: string;
  url: string | null;
  reachable: boolean;
  blockedReason?: string;
  description: string;
  foundedYear: number | null;
  yearsInBusiness: number | null;
  location: string | null;
  emails: EmailResult[];
  phones: string[];
  socials: Record<string, string>;
  people: Person[];
  tech: string[];
  hiring: boolean;
  pagesScanned: string[];
  signals: Signal[];
  score: ScoreBreakdown;
  tier: Tier;
  ai: AiInsight | null;
  fromCache: boolean;
  durationMs: number;
  error?: string;
}

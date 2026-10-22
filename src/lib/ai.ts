// An LLM reads what the scraper found and returns a structured qualification:
// summary, fit score with reasons, risks and a personalised first line for outreach.
// Two interchangeable backends: Claude (Anthropic) or Groq's free tier.

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { PRESETS } from "./presets";
import type { AiInsight, Icp } from "./types";

const InsightSchema = z.object({
  summary: z.string().describe("One sentence: what the company does and for whom."),
  industry: z.string(),
  businessModel: z.enum(["B2B", "B2C", "Mixed", "Unknown"]),
  estimatedSize: z.enum(["1-10", "11-50", "51-200", "201-1000", "1000+", "Unknown"]),
  fitScore: z.number().int().min(0).max(100),
  fitReasons: z.array(z.string()).max(3),
  risks: z.array(z.string()).max(3),
  outreachOpener: z.string().describe("A specific, non-generic first sentence for a cold email."),
});

const SYSTEM_PROMPT =
  "You qualify sales and acquisition leads from a company's own website. Judge fit only from the evidence given; when evidence is missing, say so in risks rather than guessing. fitScore: 80+ strong match on most criteria, 50-79 partial, below 50 weak or unknown. Give at most 3 fitReasons and 3 risks. The opener must reference something concrete from the site and must not invent facts.";

const GROQ_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-120b";
const CLAUDE_MODEL = "claude-opus-5-5";

export type AiProvider = "claude" | "groq" | null;

/** AI_PROVIDER forces a backend; otherwise use whichever key is configured (Claude first). */
export function aiProvider(): AiProvider {
  const forced = process.env.AI_PROVIDER?.toLowerCase();
  if (forced === "groq" && process.env.GROQ_API_KEY) return "groq";
  if (forced === "claude" && process.env.ANTHROPIC_API_KEY) return "claude";
  if (forced === "none") return null;
  if (process.env.ANTHROPIC_API_KEY) return "claude";
  if (process.env.GROQ_API_KEY) return "groq";
  return null;
}

export function aiModel(): string | null {
  const p = aiProvider();
  return p === "claude" ? CLAUDE_MODEL : p === "groq" ? GROQ_MODEL : null;
}

export function aiEnabled(): boolean {
  return aiProvider() !== null;
}

interface QualifyArgs {
  domain: string;
  name: string;
  icp: Icp;
  facts: string;
  pages: { url: string; text: string }[];
}

export async function qualifyWithAi(args: QualifyArgs): Promise<AiInsight | null> {
  const provider = aiProvider();
  if (provider === "claude") return qualifyWithClaude(args);
  if (provider === "groq") return qualifyWithGroq(args);
  return null;
}

function buildPrompt(args: QualifyArgs, textBudget: number): string {
  const preset = PRESETS[args.icp.preset];
  const icpLines = [
    `Persona: ${preset.label} (${preset.persona}). ${preset.blurb}`,
    args.icp.industries.length ? `Target industries: ${args.icp.industries.join(", ")}` : "Target industries: any",
    args.icp.locations.length ? `Target locations: ${args.icp.locations.join(", ")}` : "Target locations: any",
    args.icp.minYears ? `Minimum years in business: ${args.icp.minYears}` : "",
  ].filter(Boolean);

  // Keep the most informative text from each page, within a fixed budget.
  const perPage = Math.floor(textBudget / Math.max(1, args.pages.length));
  const corpus = args.pages.map((p) => `--- ${p.url}\n${p.text.slice(0, perPage)}`).join("\n\n");

  return `Ideal customer profile:\n${icpLines.join("\n")}\n\nCompany: ${args.name} (${args.domain})\n\nFacts extracted by the scraper:\n${args.facts}\n\nWebsite text:\n${corpus}`;
}

// ---- Claude ----------------------------------------------------------------

let anthropic: Anthropic | null = null;

async function qualifyWithClaude(args: QualifyArgs): Promise<AiInsight | null> {
  anthropic ??= new Anthropic();
  try {
    const response = await anthropic.beta.messages.parse({
      model: CLAUDE_MODEL,
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: betaZodOutputFormat(InsightSchema) },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildPrompt(args, 14000) }],
    });
    if (response.stop_reason === "refusal" || !response.parsed_output) return null;
    return { ...response.parsed_output, model: `Claude · ${CLAUDE_MODEL}` };
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) console.warn("Claude rate limited for", args.domain);
    else if (err instanceof Anthropic.APIError) console.error("Claude API error", err.status, err.message);
    else console.error("Claude call failed", err);
    return null;
  }
}

// ---- Groq (OpenAI-compatible chat completions, free tier) -------------------

// Hand-written because Groq's strict mode requires every property in `required`,
// `additionalProperties: false`, and no numeric/array bound keywords. Bounds are
// enforced afterwards by InsightSchema.
const GROQ_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "industry", "businessModel", "estimatedSize", "fitScore", "fitReasons", "risks", "outreachOpener"],
  properties: {
    summary: { type: "string", description: "One sentence: what the company does and for whom." },
    industry: { type: "string" },
    businessModel: { type: "string", enum: ["B2B", "B2C", "Mixed", "Unknown"] },
    estimatedSize: { type: "string", enum: ["1-10", "11-50", "51-200", "201-1000", "1000+", "Unknown"] },
    fitScore: { type: "integer", description: "0-100" },
    fitReasons: { type: "array", items: { type: "string" } },
    risks: { type: "array", items: { type: "string" } },
    outreachOpener: { type: "string", description: "A specific, non-generic first sentence for a cold email." },
  },
};

async function qualifyWithGroq(args: QualifyArgs): Promise<AiInsight | null> {
  // The free tier allows only a few thousand tokens per minute, so send less text.
  const body = JSON.stringify({
    model: GROQ_MODEL,
    temperature: 0.2,
    max_completion_tokens: 2000,
    ...(GROQ_MODEL.startsWith("openai/gpt-oss") ? { reasoning_effort: "low" } : {}),
    response_format: {
      type: "json_schema",
      json_schema: { name: "lead_insight", strict: GROQ_MODEL.startsWith("openai/gpt-oss"), schema: GROQ_JSON_SCHEMA },
    },
    messages: [
      { role: "system", content: `${SYSTEM_PROMPT} Respond with JSON only.` },
      { role: "user", content: buildPrompt(args, 6000) },
    ],
  });

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(30_000),
      });
      if (res.status === 429) {
        // Free-tier rate limit: wait as told (capped so the serverless call stays under 60s).
        const wait = Math.min(Number(res.headers.get("retry-after")) || 5, 15);
        console.warn(`Groq rate limited for ${args.domain}; retrying in ${wait}s`);
        await new Promise((r) => setTimeout(r, wait * 1000));
        continue;
      }
      if (!res.ok) {
        console.error("Groq API error", res.status, (await res.text()).slice(0, 300));
        return null;
      }
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const content = data.choices?.[0]?.message?.content;
      if (!content) return null;
      const parsed = InsightSchema.safeParse(normalizeInsight(JSON.parse(content)));
      if (!parsed.success) {
        console.error("Groq returned an unexpected shape", parsed.error.issues.slice(0, 3));
        return null;
      }
      return { ...parsed.data, model: `Groq · ${GROQ_MODEL}` };
    } catch (err) {
      console.error("Groq call failed", err);
      return null;
    }
  }
  return null;
}

/** Clamp the values strict mode can't bound (score range, list lengths). */
function normalizeInsight(raw: Record<string, unknown>): Record<string, unknown> {
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 3) : []);
  const score = Math.round(Number(raw.fitScore));
  return {
    ...raw,
    fitScore: Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : 0,
    fitReasons: list(raw.fitReasons),
    risks: list(raw.risks),
  };
}

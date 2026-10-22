import { NextResponse } from "next/server";
import { z } from "zod";
import { normalizeDomain } from "@/lib/normalize";
import { qualifyDomain } from "@/lib/pipeline";

// One domain per request: each lead runs in its own short serverless invocation,
// so a 500-row list scales horizontally instead of hitting one function's time limit.
export const maxDuration = 60;

const Body = z.object({
  domain: z.string().min(3).max(300),
  name: z.string().max(200).optional(),
  icp: z.object({
    preset: z.enum(["acquisition", "sales"]),
    industries: z.array(z.string().max(60)).max(20),
    locations: z.array(z.string().max(60)).max(20),
    minYears: z.number().int().min(0).max(200),
  }),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
  }
  const domain = normalizeDomain(parsed.data.domain);
  if (!domain) return NextResponse.json({ error: "Not a valid domain" }, { status: 400 });

  try {
    const lead = await qualifyDomain(domain, parsed.data.icp, parsed.data.name);
    return NextResponse.json(lead);
  } catch (err) {
    console.error("qualify failed", domain, err);
    return NextResponse.json({ error: "Qualification failed", domain }, { status: 500 });
  }
}

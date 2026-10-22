import { NextResponse } from "next/server";
import { aiModel, aiProvider } from "@/lib/ai";
import { cacheBackend } from "@/lib/cache";

export function GET() {
  return NextResponse.json({ ai: aiProvider() !== null, provider: aiProvider(), model: aiModel(), cache: cacheBackend() });
}

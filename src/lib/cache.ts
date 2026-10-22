// Two-tier cache: Neon Postgres when DATABASE_URL is set (shared across serverless
// instances and deploys), otherwise a bounded in-memory map (local dev / demo).

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

const MEMORY_LIMIT = 2000;
const memory = new Map<string, { value: unknown; expires: number }>();

let sql: NeonQueryFunction<false, false> | null = null;
let ready: Promise<void> | null = null;

function db() {
  if (!process.env.DATABASE_URL) return null;
  if (!sql) {
    sql = neon(process.env.DATABASE_URL);
    ready = (async () => {
      await sql!`CREATE TABLE IF NOT EXISTS kv_cache (
        key TEXT PRIMARY KEY,
        value JSONB NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL
      )`;
      await sql!`CREATE INDEX IF NOT EXISTS kv_cache_expires ON kv_cache (expires_at)`;
    })();
  }
  return sql;
}

export function cacheBackend(): "postgres" | "memory" {
  return process.env.DATABASE_URL ? "postgres" : "memory";
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  const hit = memory.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as T;

  const q = db();
  if (!q) return null;
  try {
    await ready;
    const rows = await q`SELECT value FROM kv_cache WHERE key = ${key} AND expires_at > now()`;
    if (rows.length === 0) return null;
    const value = rows[0].value as T;
    remember(key, value, 10 * 60_000);
    return value;
  } catch (err) {
    console.error("cacheGet failed", err);
    return null;
  }
}

export async function cacheSet(key: string, value: unknown, ttlMs: number): Promise<void> {
  remember(key, value, ttlMs);
  const q = db();
  if (!q) return;
  try {
    await ready;
    const expires = new Date(Date.now() + ttlMs).toISOString();
    await q`INSERT INTO kv_cache (key, value, expires_at)
            VALUES (${key}, ${JSON.stringify(value)}::jsonb, ${expires})
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, expires_at = EXCLUDED.expires_at`;
  } catch (err) {
    console.error("cacheSet failed", err);
  }
}

function remember(key: string, value: unknown, ttlMs: number) {
  if (memory.size >= MEMORY_LIMIT) {
    // Map iterates in insertion order, so the first key is the oldest.
    memory.delete(memory.keys().next().value!);
  }
  memory.set(key, { value, expires: Date.now() + ttlMs });
}

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const migrationPath = fileURLToPath(
  new URL(
    "../../supabase/migrations/20260823001500_phase4b_provider_payload_cache.sql",
    import.meta.url,
  ),
);
const migration = readFileSync(migrationPath, "utf8");

describe("Phase 4B provider payload cache migration", () => {
  test("stores provider data families rather than question-specific answers", () => {
    expect(migration).toContain("sports_provider_payload_cache");
    expect(migration).toContain("data_family text not null");
    expect(migration).toContain("cache_key text not null");
    expect(migration).toContain("payload jsonb not null");
    expect(migration).toContain("expires_at timestamptz not null");
    expect(migration.toLowerCase()).not.toContain("question text");
    expect(migration.toLowerCase()).not.toContain("answer text");
  });

  test("is backend-only with RLS and no browser table privileges", () => {
    expect(migration).toContain(
      "alter table public.sports_provider_payload_cache enable row level security",
    );
    expect(migration).toContain(
      "revoke all on table public.sports_provider_payload_cache from anon, authenticated",
    );
    expect(migration).toContain(
      "grant all on table public.sports_provider_payload_cache to service_role",
    );
  });

  test("has primary lookup and expiry indexes", () => {
    expect(migration).toContain("primary key (provider, data_family, cache_key)");
    expect(migration).toContain("sports_provider_payload_cache_expires_at_idx");
    expect(migration).toContain("sports_provider_payload_cache_family_expiry_idx");
  });
});

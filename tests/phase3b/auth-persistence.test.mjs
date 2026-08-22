import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../../supabase/migrations/20260821235900_phase3b_auth_user_persistence.sql",
    import.meta.url,
  ),
  "utf8",
);
const envExample = readFileSync(new URL("../../.env.example", import.meta.url), "utf8");
const browserClient = readFileSync(
  new URL("../../src/lib/supabase-browser.ts", import.meta.url),
  "utf8",
);
const store = readFileSync(new URL("../../src/lib/store.tsx", import.meta.url), "utf8");

const userTables = [
  "profiles",
  "analysis_history",
  "saved_analyses",
  "workspaces",
  "workspace_items",
];

test("Phase 3B migration creates the required user-owned tables with RLS", () => {
  for (const table of userTables) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}\\b`, "i"));
    assert.match(
      migration,
      new RegExp(`alter table public\\.${table} enable row level security`, "i"),
    );
  }
});

test("every user table has ownership policies for CRUD", () => {
  for (const table of userTables) {
    for (const command of ["select", "insert", "update", "delete"]) {
      assert.match(
        migration,
        new RegExp(
          `create policy ${table}_[a-z_]*${command === "select" ? "select" : command}[a-z_]*[\\s\\S]*?on public\\.${table} for ${command}`,
          "i",
        ),
      );
    }
  }
});

test("UPDATE policies enforce ownership before and after the change", () => {
  for (const table of userTables) {
    const ownerColumn = table === "profiles" ? "id" : "user_id";
    const updateBlock = migration.match(
      new RegExp(`create policy ${table}_update_own[\\s\\S]*?;`, "i"),
    )?.[0];
    assert.ok(updateBlock, `missing UPDATE policy for ${table}`);
    assert.match(
      updateBlock,
      new RegExp(`using \\(\\(select auth\\.uid\\(\\)\\) = ${ownerColumn}\\)`, "i"),
    );
    assert.match(
      updateBlock,
      new RegExp(`with check \\(\\(select auth\\.uid\\(\\)\\) = ${ownerColumn}\\)`, "i"),
    );
  }
});

test("authorization never relies on user_metadata", () => {
  assert.doesNotMatch(migration, /user_metadata|raw_user_meta_data/i);
  assert.match(migration, /auth\.uid\(\)/i);
});

test("history deletion preserves saved/workspace ownership columns", () => {
  const occurrences = migration.match(/on delete set null \(analysis_history_id\)/gi) ?? [];
  assert.equal(occurrences.length, 2);
});

test("browser configuration exposes only public Supabase values", () => {
  assert.match(envExample, /VITE_SUPABASE_URL=/);
  assert.match(envExample, /VITE_SUPABASE_PUBLISHABLE_KEY=/);
  assert.doesNotMatch(envExample, /VITE_SUPABASE_SECRET_KEY/);
  assert.match(browserClient, /VITE_SUPABASE_PUBLISHABLE_KEY/);
  assert.doesNotMatch(browserClient, /SUPABASE_SECRET_KEY|sb_secret_/);
});

test("authenticated user data no longer falls back to legacy localStorage", () => {
  assert.match(store, /localStorage\.removeItem\(LEGACY_STORAGE_KEY\)/);
  assert.doesNotMatch(store, /JSON\.parse\([^)]*LEGACY_STORAGE_KEY/);
  for (const table of [
    "analysis_history",
    "saved_analyses",
    "workspaces",
    "workspace_items",
    "profiles",
  ]) {
    assert.match(store, new RegExp(`from\\(\\"${table}\\"\\)`));
  }
});

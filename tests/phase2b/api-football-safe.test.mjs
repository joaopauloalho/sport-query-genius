import assert from "node:assert/strict";
import test from "node:test";

import { SafeApiFootballProvider } from "../../src/server/sports/providers/api-football-safe.server.ts";

async function withApiFootballMock(sequence, worker) {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.API_FOOTBALL_KEY;
  const calls = [];
  let cursor = 0;

  process.env.API_FOOTBALL_KEY = "test-api-football-secret";
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), headers: options.headers ?? {} });
    const item = sequence[Math.min(cursor, sequence.length - 1)];
    cursor += 1;
    return new Response(JSON.stringify(item.body), {
      status: item.status ?? 200,
      headers: item.headers ?? { "content-type": "application/json" },
    });
  };

  try {
    return await worker(calls);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.API_FOOTBALL_KEY;
    else process.env.API_FOOTBALL_KEY = originalKey;
  }
}

test("Safe API-Football retries RapidAPI header only for explicit auth failures", async () => {
  await withApiFootballMock(
    [
      { body: { response: [], errors: { token: "Invalid API key" } } },
      {
        body: {
          response: [{ team: { id: 157, name: "Bayern Munich", country: "Germany" } }],
          errors: [],
        },
      },
    ],
    async (calls) => {
      const provider = new SafeApiFootballProvider();
      const team = await provider.resolveTeam("Bayern Munich");
      assert.equal(team.id, 157);
      assert.equal(calls.length, 2);
      assert.equal(calls[0].headers["x-apisports-key"], "test-api-football-secret");
      assert.equal(calls[1].headers["x-rapidapi-key"], "test-api-football-secret");
      assert.equal(calls[1].headers["x-rapidapi-host"], "v3.football.api-sports.io");
    },
  );
});

test("Safe API-Football maps account failures without retrying another auth header", async () => {
  await withApiFootballMock(
    [{ body: { response: [], errors: { account: "Account suspended" } } }],
    async (calls) => {
      const provider = new SafeApiFootballProvider();
      await assert.rejects(
        provider.resolveTeam("Bayern Munich"),
        (error) => error?.code === "PROVIDER_UNAVAILABLE" && /suspensa|inativa/i.test(error.message),
      );
      assert.equal(calls.length, 1);
    },
  );
});

test("Safe API-Football maps quota failures to API_LIMIT_REACHED without retry", async () => {
  await withApiFootballMock(
    [{ body: { response: [], errors: { requests: "Request quota reached" } } }],
    async (calls) => {
      const provider = new SafeApiFootballProvider();
      await assert.rejects(
        provider.resolveTeam("Bayern Munich"),
        (error) => error?.code === "API_LIMIT_REACHED",
      );
      assert.equal(calls.length, 1);
    },
  );
});

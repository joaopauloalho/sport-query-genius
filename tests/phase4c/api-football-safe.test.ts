import { afterEach, describe, expect, test } from "bun:test";

import { SafeApiFootballProvider } from "../../src/server/sports/providers/api-football-safe.server";

const originalFetch = globalThis.fetch;
const originalKey = process.env.API_FOOTBALL_KEY;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.API_FOOTBALL_KEY;
  else process.env.API_FOOTBALL_KEY = originalKey;
});

type MockItem = {
  body: unknown;
  status?: number;
};

function installApiFootballMock(sequence: MockItem[]) {
  const calls: Array<{ url: string; headers: Headers }> = [];
  let cursor = 0;
  process.env.API_FOOTBALL_KEY = "test-api-football-secret";

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), headers: new Headers(init?.headers) });
    const item = sequence[Math.min(cursor, sequence.length - 1)];
    cursor += 1;
    return new Response(JSON.stringify(item.body), {
      status: item.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  return calls;
}

describe("SafeApiFootballProvider diagnostics", () => {
  test("retries RapidAPI header only for explicit auth failures", async () => {
    const calls = installApiFootballMock([
      { body: { response: [], errors: { token: "Invalid API key" } } },
      {
        body: {
          response: [{ team: { id: 157, name: "Bayern Munich", country: "Germany" } }],
          errors: [],
        },
      },
    ]);

    const provider = new SafeApiFootballProvider();
    const team = await provider.resolveTeam("Bayern Munich");

    expect(team.id).toBe(157);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.headers.get("x-apisports-key")).toBe("test-api-football-secret");
    expect(calls[1]?.headers.get("x-rapidapi-key")).toBe("test-api-football-secret");
    expect(calls[1]?.headers.get("x-rapidapi-host")).toBe("v3.football.api-sports.io");
  });

  test("maps account failures without retrying another auth header", async () => {
    const calls = installApiFootballMock([
      { body: { response: [], errors: { account: "Account suspended" } } },
    ]);

    const provider = new SafeApiFootballProvider();
    await expect(provider.resolveTeam("Bayern Munich")).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
    });
    expect(calls).toHaveLength(1);
  });

  test("maps quota failures to API_LIMIT_REACHED without retry", async () => {
    const calls = installApiFootballMock([
      { body: { response: [], errors: { requests: "Request quota reached" } } },
    ]);

    const provider = new SafeApiFootballProvider();
    await expect(provider.resolveTeam("Bayern Munich")).rejects.toMatchObject({
      code: "API_LIMIT_REACHED",
    });
    expect(calls).toHaveLength(1);
  });
});

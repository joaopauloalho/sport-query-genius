import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";

function keysOf(value: unknown): string[] {
  return value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value) : [];
}

function nestedKeySummary(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child && typeof child === "object" && !Array.isArray(child))
      .slice(0, 12)
      .map(([key, child]) => [key, keysOf(child)]),
  );
}

const getProviderDiagnostic = createServerFn({ method: "GET" }).handler(async () => {
  const bsdKey = process.env.BSD_FOOTBALL_KEY;
  const apiFootballKey = process.env.API_FOOTBALL_KEY;
  const result: Record<string, unknown> = {};

  if (!bsdKey) {
    result.bsd = { configured: false };
  } else {
    const response = await fetch(
      "https://sports.bzzoiro.com/api/player-stats/?player=1146&limit=5",
      { headers: { Authorization: `Token ${bsdKey}` } },
    );
    const payload = (await response.json().catch(() => null)) as unknown;
    const root = payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : null;
    const rows = root && Array.isArray(root.results) ? root.results : Array.isArray(payload) ? payload : [];
    const first = rows[0] ?? null;
    result.bsd = {
      configured: true,
      status: response.status,
      rootKeys: keysOf(payload),
      count: root?.count ?? rows.length,
      rowCount: rows.length,
      firstKeys: keysOf(first),
      firstNestedKeys: nestedKeySummary(first),
      first: first && typeof first === "object" ? first : null,
    };
  }

  if (!apiFootballKey) {
    result.apiFootball = { configured: false };
  } else {
    const url = new URL("https://v3.football.api-sports.io/teams");
    url.searchParams.set("search", "FC Bayern Munchen");
    const calls = [];
    for (const headers of [
      { "x-apisports-key": apiFootballKey },
      { "x-rapidapi-key": apiFootballKey, "x-rapidapi-host": "v3.football.api-sports.io" },
    ]) {
      const response = await fetch(url, { headers });
      const payload = (await response.json().catch(() => null)) as unknown;
      const root = payload && typeof payload === "object" && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : null;
      calls.push({
        auth: "x-apisports-key" in headers ? "apisports" : "rapidapi",
        status: response.status,
        rootKeys: keysOf(payload),
        errors: root?.errors ?? null,
        results: root?.results ?? null,
        responseCount: Array.isArray(root?.response) ? root.response.length : null,
        firstTeam:
          Array.isArray(root?.response) && root.response[0] && typeof root.response[0] === "object"
            ? (root.response[0] as Record<string, unknown>).team ?? null
            : null,
      });
    }
    result.apiFootball = { configured: true, calls };
  }

  return result;
});

export const Route = createFileRoute("/phase3d-provider-diagnostic")({
  loader: () => getProviderDiagnostic(),
  component: DiagnosticPage,
});

function DiagnosticPage() {
  const data = Route.useLoaderData();
  return <pre>{JSON.stringify(data, null, 2)}</pre>;
}

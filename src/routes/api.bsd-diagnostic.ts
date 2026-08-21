import { createFileRoute } from "@tanstack/react-router";

const BASE_URL = "https://sports.bzzoiro.com/api/v2";
const TEAM_ID = 167;

function summarize(payload: unknown) {
  const root = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : null;
  const results = root && Array.isArray(root.results) ? root.results : Array.isArray(payload) ? payload : [];
  const safeResults = results.slice(0, 12).map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    const r = item as Record<string, unknown>;
    return {
      id: r.id,
      event_date: r.event_date,
      status: r.status,
      home_team_id: r.home_team_id,
      home_team: r.home_team,
      away_team_id: r.away_team_id,
      away_team: r.away_team,
      home_score: r.home_score,
      away_score: r.away_score,
    };
  });

  return {
    count: root?.count ?? results.length,
    next: root?.next ?? null,
    previous: root?.previous ?? null,
    results: safeResults,
  };
}

async function fetchBsd(path: string) {
  const apiKey = process.env.BSD_FOOTBALL_KEY;
  if (!apiKey) return { error: "missing_key" };

  const response = await fetch(`${BASE_URL}${path}`, {
    headers: { Authorization: `Token ${apiKey}` },
  });

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  return {
    status: response.status,
    ok: response.ok,
    data: summarize(payload),
  };
}

export const Route = createFileRoute("/api/bsd-diagnostic")({
  server: {
    handlers: {
      GET: async () => {
        const queries = {
          teamFixturesDefault: `/teams/${TEAM_ID}/fixtures/?limit=200&offset=0`,
          teamFixturesFinished: `/teams/${TEAM_ID}/fixtures/?status=finished&limit=200&offset=0`,
          eventsTeamWindow: `/events/?team_id=${TEAM_ID}&date_from=2026-06-01&date_to=2026-08-21&limit=200&offset=0`,
          eventsTeamWindowFinished: `/events/?team_id=${TEAM_ID}&status=finished&date_from=2026-06-01&date_to=2026-08-21&limit=200&offset=0`,
          eventsTeamNameWindow: `/events/?team_name=Corinthians&date_from=2026-06-01&date_to=2026-08-21&limit=200&offset=0`,
        } as const;

        const entries = await Promise.all(
          Object.entries(queries).map(async ([key, path]) => [key, await fetchBsd(path)] as const),
        );

        return Response.json(Object.fromEntries(entries), {
          headers: {
            "Cache-Control": "no-store",
          },
        });
      },
    },
  },
});

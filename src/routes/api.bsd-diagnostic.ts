import { createFileRoute } from "@tanstack/react-router";

const BASE_URL = "https://sports.bzzoiro.com/api/v2";
const TEAM_ID = 167;
const LATEST_EVENT_IDS = [207965, 7217, 207957, 7211, 207936] as const;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

function summarizeEvents(payload: unknown) {
  const root = asRecord(payload);
  const results = root && Array.isArray(root.results) ? root.results : Array.isArray(payload) ? payload : [];
  const safeResults = results.slice(0, 12).map((item) => {
    const r = asRecord(item);
    if (!r) return item;
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

function pickStatFields(value: unknown) {
  const record = asRecord(value);
  if (!record) return null;
  return Object.fromEntries(
    Object.entries(record).filter(([key, statValue]) =>
      /(corner|shot|card)/i.test(key) &&
      (typeof statValue === "string" || typeof statValue === "number" || statValue === null),
    ),
  );
}

function summarizeStats(payload: unknown) {
  const root = asRecord(payload);
  const stats = root ? asRecord(root.stats) : null;
  const home = stats ? asRecord(stats.home) : null;
  const away = stats ? asRecord(stats.away) : null;
  const shotmap = root && Array.isArray(root.shotmap) ? root.shotmap : [];

  return {
    event_id: root?.event_id ?? null,
    rootKeys: root ? Object.keys(root) : [],
    homeKeys: home ? Object.keys(home) : [],
    awayKeys: away ? Object.keys(away) : [],
    homeRelevant: pickStatFields(home),
    awayRelevant: pickStatFields(away),
    shotmapCount: shotmap.length,
  };
}

async function fetchJson(path: string) {
  const apiKey = process.env.BSD_FOOTBALL_KEY;
  if (!apiKey) return { status: 0, ok: false, payload: null as unknown };

  const response = await fetch(`${BASE_URL}${path}`, {
    headers: { Authorization: `Token ${apiKey}` },
  });

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  return { status: response.status, ok: response.ok, payload };
}

export const Route = createFileRoute("/api/bsd-diagnostic")({
  server: {
    handlers: {
      GET: async () => {
        const eventsPath = `/events/?team_id=${TEAM_ID}&status=finished&date_from=2026-06-01&date_to=2026-08-21&limit=200&offset=0`;
        const eventsResponse = await fetchJson(eventsPath);

        const statsEntries = await Promise.all(
          LATEST_EVENT_IDS.map(async (eventId) => {
            const response = await fetchJson(`/events/${eventId}/stats/`);
            return [
              String(eventId),
              {
                status: response.status,
                ok: response.ok,
                data: summarizeStats(response.payload),
              },
            ] as const;
          }),
        );

        return Response.json(
          {
            events: {
              status: eventsResponse.status,
              ok: eventsResponse.ok,
              data: summarizeEvents(eventsResponse.payload),
            },
            stats: Object.fromEntries(statsEntries),
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      },
    },
  },
});

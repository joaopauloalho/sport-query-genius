import { createFileRoute } from "@tanstack/react-router";

const BASE_URL = "https://sports.bzzoiro.com/api/v2";

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

function competitionFields(record: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(record).filter(([key]) =>
      /(league|competition|tournament|champ|season|category|country|unique)/i.test(key),
    ),
  );
}

export const Route = createFileRoute("/api/bsd-event-shape")({
  server: {
    handlers: {
      GET: async () => {
        const key = process.env.BSD_FOOTBALL_KEY;
        if (!key) return Response.json({ error: "BSD key missing" }, { status: 503 });

        const url = new URL(`${BASE_URL}/events/`);
        url.searchParams.set("team_id", "167");
        url.searchParams.set("status", "finished");
        url.searchParams.set("date_from", "2026-07-01");
        url.searchParams.set("date_to", "2026-08-21");
        url.searchParams.set("limit", "10");
        const response = await fetch(url, { headers: { Authorization: `Token ${key}` } });
        const payload: unknown = await response.json();
        const root = asRecord(payload);
        const results = root && Array.isArray(root.results) ? root.results : [];

        return Response.json({
          status: response.status,
          events: results.slice(0, 10).map((item) => {
            const record = asRecord(item);
            if (!record) return null;
            return {
              id: record.id,
              keys: Object.keys(record),
              competitionFields: competitionFields(record),
            };
          }),
        });
      },
    },
  },
});

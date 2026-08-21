import { createFileRoute } from "@tanstack/react-router";

const BASE_URL = "https://sports.bzzoiro.com/api/v2";
const IDS = [9, 32, 35, 79] as const;

export const Route = createFileRoute("/api/bsd-league-shape")({
  server: {
    handlers: {
      GET: async () => {
        const key = process.env.BSD_FOOTBALL_KEY;
        if (!key) return Response.json({ error: "BSD key missing" }, { status: 503 });

        const entries = await Promise.all(
          IDS.map(async (id) => {
            const response = await fetch(`${BASE_URL}/leagues/${id}/`, {
              headers: { Authorization: `Token ${key}` },
            });
            let payload: unknown = null;
            try {
              payload = await response.json();
            } catch {
              payload = null;
            }
            return { id, status: response.status, payload };
          }),
        );

        return Response.json({ entries });
      },
    },
  },
});

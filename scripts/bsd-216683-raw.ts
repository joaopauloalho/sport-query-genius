const key = process.env.BSD_FOOTBALL_KEY;
if (!key) throw new Error("BSD_FOOTBALL_KEY missing");

const response = await fetch("https://sports.bzzoiro.com/api/v2/events/216683/stats/", {
  headers: { Authorization: `Token ${key}` },
});
const payload: unknown = await response.json();

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function collectRelevant(value: unknown, path = "root", out: Array<{ path: string; value: unknown }> = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectRelevant(item, `${path}[${index}]`, out));
    return out;
  }
  const record = asRecord(value);
  if (!record) return out;
  for (const [key, child] of Object.entries(record)) {
    const childPath = `${path}.${key}`;
    if (/corner|escante|shot|card|yellow|red|stat/i.test(key)) {
      if (typeof child !== "object" || child === null) out.push({ path: childPath, value: child });
    }
    if (typeof child === "object" && child !== null) collectRelevant(child, childPath, out);
  }
  return out;
}

const root = asRecord(payload);
const stats = root ? asRecord(root.stats) : null;
const home = stats ? asRecord(stats.home) : null;
const away = stats ? asRecord(stats.away) : null;

console.info(`BSD_216683_STATUS ${response.status}`);
console.info(`BSD_216683_ROOT_KEYS ${JSON.stringify(root ? Object.keys(root) : [])}`);
console.info(`BSD_216683_HOME ${JSON.stringify(home)}`);
console.info(`BSD_216683_AWAY ${JSON.stringify(away)}`);
console.info(`BSD_216683_RELEVANT ${JSON.stringify(collectRelevant(payload))}`);

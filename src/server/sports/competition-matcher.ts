const COMPETITION_ALIAS_GROUPS = [
  [
    "brasileirao",
    "brasileirão",
    "brasileirao serie a",
    "brasileirão série a",
    "campeonato brasileiro serie a",
    "campeonato brasileiro série a",
    "brazilian serie a",
  ],
  ["libertadores", "copa libertadores", "copa libertadores da america", "conmebol libertadores"],
  ["copa do brasil", "copa brasil"],
  ["champions", "champions league", "uefa champions league", "ucl"],
  ["premier league", "premier"],
  ["la liga", "laliga", "primera division", "primera división"],
] as const;

export function normalizeCompetitionName(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const aliases = new Map<string, string>();
for (const [canonical, ...values] of COMPETITION_ALIAS_GROUPS) {
  const normalizedCanonical = normalizeCompetitionName(canonical);
  aliases.set(normalizedCanonical, normalizedCanonical);
  for (const value of values) aliases.set(normalizeCompetitionName(value), normalizedCanonical);
}

export function competitionNamesEquivalent(requested: string, actual: string): boolean {
  const left = normalizeCompetitionName(requested);
  const right = normalizeCompetitionName(actual);
  if (left === right) return true;
  const leftCanonical = aliases.get(left);
  const rightCanonical = aliases.get(right);
  return Boolean(leftCanonical && rightCanonical && leftCanonical === rightCanonical);
}

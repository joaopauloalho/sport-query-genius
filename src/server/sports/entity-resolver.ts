export interface EntityCandidate {
  id: number;
  name: string;
  country?: string;
  context?: string;
}

export interface ScoredEntityCandidate extends EntityCandidate {
  score: number;
}

export type EntityResolution =
  | { status: "resolved"; candidate: EntityCandidate; score: number }
  | { status: "ambiguous"; candidates: ScoredEntityCandidate[] }
  | { status: "not_found"; candidates: ScoredEntityCandidate[] };

const CLUB_TERMS = new Set([
  "fc",
  "afc",
  "cf",
  "sc",
  "club",
  "clube",
  "football",
  "futebol",
]);

const PARTICLES = new Set(["de", "do", "da", "dos", "das", "del", "di"]);

export function normalizeFootballEntityName(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function coreTokens(value: string): string[] {
  return normalizeFootballEntityName(value)
    .split(" ")
    .filter(Boolean)
    .filter((token) => !CLUB_TERMS.has(token) && !PARTICLES.has(token));
}

function intersectionSize(left: readonly string[], right: readonly string[]): number {
  const other = new Set(right);
  return new Set(left.filter((token) => other.has(token))).size;
}

export function scoreFootballEntityName(query: string, candidate: string): number {
  const normalizedQuery = normalizeFootballEntityName(query);
  const normalizedCandidate = normalizeFootballEntityName(candidate);
  if (!normalizedQuery || !normalizedCandidate) return 0;
  if (normalizedQuery === normalizedCandidate) return 1;

  const queryTokens = coreTokens(query);
  const candidateTokens = coreTokens(candidate);
  if (queryTokens.length === 0 || candidateTokens.length === 0) return 0;

  const queryCore = queryTokens.join(" ");
  const candidateCore = candidateTokens.join(" ");
  if (queryCore === candidateCore) return 0.98;

  const intersection = intersectionSize(queryTokens, candidateTokens);
  if (intersection === 0) return 0;

  const coverage = intersection / queryTokens.length;
  const precision = intersection / candidateTokens.length;
  const union = new Set([...queryTokens, ...candidateTokens]).size;
  const jaccard = intersection / union;
  const sameFirstToken = queryTokens[0] === candidateTokens[0] ? 0.04 : 0;
  const contained =
    normalizedQuery.length >= 7 &&
    (normalizedCandidate.includes(normalizedQuery) || normalizedQuery.includes(normalizedCandidate))
      ? 0.03
      : 0;

  return Math.min(0.97, 0.52 * coverage + 0.28 * precision + 0.16 * jaccard + sameFirstToken + contained);
}

function isShortGenericQuery(query: string): boolean {
  const tokens = coreTokens(query);
  return tokens.length === 1 && tokens[0].length <= 6;
}

export function resolveFootballEntityCandidates(
  query: string,
  candidates: readonly EntityCandidate[],
): EntityResolution {
  const scored = candidates
    .map((candidate) => ({ ...candidate, score: scoreFootballEntityName(query, candidate.name) }))
    .filter((candidate) => candidate.score >= 0.55)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name) || a.id - b.id);

  if (scored.length === 0) return { status: "not_found", candidates: [] };

  if (isShortGenericQuery(query)) {
    const queryToken = coreTokens(query)[0];
    const plausible = scored.filter(
      (candidate) => coreTokens(candidate.name).includes(queryToken) && candidate.score >= 0.72,
    );
    if (plausible.length > 1) {
      return { status: "ambiguous", candidates: plausible.slice(0, 5) };
    }
  }

  const top = scored[0];
  const second = scored[1];
  const margin = second ? top.score - second.score : 1;

  if (top.score >= 0.9 && margin >= 0.08) {
    return { status: "resolved", candidate: top, score: top.score };
  }

  const plausible = scored.filter((candidate) => candidate.score >= 0.7).slice(0, 5);
  if (plausible.length >= 2) {
    return { status: "ambiguous", candidates: plausible };
  }

  return { status: "not_found", candidates: scored.slice(0, 5) };
}

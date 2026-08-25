export interface ProviderPlayerIdentity {
  provider: "BSD" | "API-FOOTBALL";
  providerPlayerId: string;
  canonicalName: string;
  teamName?: string | null;
  competitionName?: string | null;
  nationality?: string | null;
  birthDate?: string | null;
}

export type PlayerIdentityReconciliation =
  | { status: "matched"; match: ProviderPlayerIdentity; evidence: string[] }
  | { status: "ambiguous"; candidates: ProviderPlayerIdentity[]; evidence: string[] }
  | { status: "not_found"; candidates: ProviderPlayerIdentity[]; evidence: string[] };

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function equalOptional(left?: string | null, right?: string | null): boolean | null {
  if (!left || !right) return null;
  return normalize(left) === normalize(right);
}

function candidateEvidence(
  primary: ProviderPlayerIdentity,
  candidate: ProviderPlayerIdentity,
): { compatible: boolean; evidence: string[] } {
  if (normalize(primary.canonicalName) !== normalize(candidate.canonicalName)) {
    return { compatible: false, evidence: [] };
  }
  const evidence = ["canonical_name"];
  const comparisons: Array<[string, boolean | null]> = [
    ["team", equalOptional(primary.teamName, candidate.teamName)],
    ["competition", equalOptional(primary.competitionName, candidate.competitionName)],
    ["nationality", equalOptional(primary.nationality, candidate.nationality)],
    ["birth_date", equalOptional(primary.birthDate, candidate.birthDate)],
  ];
  for (const [label, result] of comparisons) {
    if (result === false) return { compatible: false, evidence: [] };
    if (result === true) evidence.push(label);
  }
  return { compatible: true, evidence };
}

export function reconcilePlayerIdentity(
  primary: ProviderPlayerIdentity,
  candidates: readonly ProviderPlayerIdentity[],
): PlayerIdentityReconciliation {
  const compatible = candidates
    .filter((candidate) => candidate.provider !== primary.provider)
    .map((candidate) => ({ candidate, ...candidateEvidence(primary, candidate) }))
    .filter((entry) => entry.compatible && entry.evidence.length >= 2);

  if (compatible.length === 1) {
    return {
      status: "matched",
      match: compatible[0].candidate,
      evidence: compatible[0].evidence,
    };
  }
  if (compatible.length > 1) {
    return {
      status: "ambiguous",
      candidates: compatible.map((entry) => entry.candidate),
      evidence: [...new Set(compatible.flatMap((entry) => entry.evidence))],
    };
  }
  return { status: "not_found", candidates: [...candidates], evidence: [] };
}

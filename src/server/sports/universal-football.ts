import type { FootballEventType, QueryScope } from "../analysis/query-plan";
import type { ProviderFixture, ResolvedTeam } from "./provider";

export type UniversalProviderName = "BSD" | "API-FOOTBALL";
export type UniversalCacheStatus = "hit" | "miss" | "mixed" | "disabled";

export interface FootballParticipant {
  id: number | null;
  name: string | null;
}

export interface FootballIncident {
  eventKey: string;
  fixtureId: number;
  eventType: Exclude<FootballEventType, "assist">;
  teamId: number | null;
  teamName: string | null;
  actor: FootballParticipant | null;
  secondaryActor: FootballParticipant | null;
  minute: number | null;
  extraTime: number | null;
  periodSecond: number | null;
  detail: string | null;
  rescinded: boolean;
  situation: string | null;
  bodyPart: string | null;
  xg: number | null;
  xgEstimated: boolean | null;
  source: UniversalProviderName;
}

export interface TeamFootballEvent {
  eventKey: string;
  fixtureId: number;
  date: string;
  timestamp: number;
  competition: string;
  teamId: number;
  teamName: string;
  opponentId: number;
  opponentName: string;
  venue: "home" | "away";
  result: string;
  eventType: FootballEventType;
  actor: FootballParticipant | null;
  secondaryActor: FootballParticipant | null;
  minute: number | null;
  extraTime: number | null;
  periodSecond: number | null;
  detail: string | null;
  rescinded: boolean;
  situation: string | null;
  bodyPart: string | null;
  xg: number | null;
  xgEstimated: boolean | null;
  source: UniversalProviderName;
}

export interface ProviderReadMeta {
  provider: UniversalProviderName;
  endpoint: string;
  dataFamily: string;
  fetchedAt: string;
  cacheStatus: UniversalCacheStatus;
}

export interface UniversalFixtureRead {
  fixtures: ProviderFixture[];
  meta: ProviderReadMeta;
}

export interface UniversalIncidentRead {
  incidents: FootballIncident[];
  meta: ProviderReadMeta;
}

export interface UniversalFootballSource {
  readonly name: UniversalProviderName;
  resolveTeam(name: string): Promise<ResolvedTeam>;
  listTeamFixtures(team: ResolvedTeam, scope: QueryScope): Promise<UniversalFixtureRead>;
  getFixtureIncidents(fixture: ProviderFixture): Promise<UniversalIncidentRead>;
  enrichGoalEvents(
    fixture: ProviderFixture,
    incidents: readonly FootballIncident[],
  ): Promise<{ incidents: FootballIncident[]; meta: ProviderReadMeta | null }>;
  getFixtureMetric(
    fixture: ProviderFixture,
    teamId: number,
    metric: "goals" | "corners" | "shots" | "shots_on_target" | "cards",
  ): Promise<number | null>;
}

export const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

export function readString(
  record: Record<string, unknown>,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export function readNumber(
  record: Record<string, unknown>,
  keys: readonly string[],
): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value.replace("%", "").trim());
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function readBoolean(record: Record<string, unknown>, keys: readonly string[]): boolean | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "boolean") return value;
    if (value === 1 || value === "1" || value === "true") return true;
    if (value === 0 || value === "0" || value === "false") return false;
  }
  return null;
}

function nested(
  record: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> | null {
  for (const key of keys) {
    const value = asRecord(record[key]);
    if (value) return value;
  }
  return null;
}

export function extractPayloadList(payload: unknown, keys: readonly string[]): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload
      .map(asRecord)
      .filter((item): item is Record<string, unknown> => item !== null);
  }
  const root = asRecord(payload);
  if (!root) return [];
  for (const key of keys) {
    if (!Array.isArray(root[key])) continue;
    return (root[key] as unknown[])
      .map(asRecord)
      .filter((item): item is Record<string, unknown> => item !== null);
  }
  return [];
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function participant(
  record: Record<string, unknown>,
  nestedKeys: readonly string[],
  idKeys: readonly string[],
  nameKeys: readonly string[],
): FootballParticipant | null {
  const object = nested(record, nestedKeys);
  const id =
    (object ? readNumber(object, ["id", "player_id"]) : null) ?? readNumber(record, idKeys);
  const name =
    (object ? readString(object, ["name", "player_name", "short_name"]) : null) ??
    readString(record, nameKeys);
  return id !== null || name !== null ? { id, name } : null;
}

function eventTeam(
  record: Record<string, unknown>,
  fixture: ProviderFixture,
): { id: number | null; name: string | null } {
  const team = nested(record, ["team"]);
  const directId =
    (team ? readNumber(team, ["id", "team_id"]) : null) ??
    readNumber(record, ["team_id", "teamId"]);
  const directName =
    (team ? readString(team, ["name", "team_name"]) : null) ??
    readString(record, ["team_name"]);
  if (directId !== null) {
    if (directId === fixture.home.id) return { id: directId, name: directName ?? fixture.home.name };
    if (directId === fixture.away.id) return { id: directId, name: directName ?? fixture.away.name };
    return { id: directId, name: directName };
  }

  const home = readBoolean(record, ["home", "is_home", "home_team"]);
  if (home === true) return fixture.home;
  if (home === false) return fixture.away;
  return { id: null, name: directName };
}

function canonicalIncidentType(record: Record<string, unknown>): FootballIncident["eventType"] | null {
  const type = normalize(
    [
      readString(record, ["incident_type", "event_type", "type", "incidentType"]) ?? "",
      readString(record, ["detail", "card_type", "decision", "reason"]) ?? "",
    ].join(" "),
  );

  if (type.includes("yellow red") || type.includes("second yellow")) return "red_card";
  if (type.includes("yellow") && type.includes("card")) return "yellow_card";
  if (type.includes("red") && type.includes("card")) return "red_card";
  if (type.includes("sub") || type.includes("replacement")) return "substitution";
  if (type.includes("var") || type.includes("video assistant")) return "var";
  if (type.includes("missed penalty") || type.includes("penalty missed")) return "penalty";
  if (type.includes("goal")) return "goal";
  if (type === "penalty") return "penalty";
  return null;
}

function parseMinute(record: Record<string, unknown>): {
  minute: number | null;
  extraTime: number | null;
  periodSecond: number | null;
} {
  const periodSecond = readNumber(record, ["period_second", "periodSecond", "second"]);
  const time = nested(record, ["time"]);
  const minute =
    (time ? readNumber(time, ["elapsed", "minute", "min"]) : null) ??
    readNumber(record, ["minute", "min", "elapsed"]);
  const extraTime =
    (time ? readNumber(time, ["extra", "added", "extra_time"]) : null) ??
    readNumber(record, ["extra_time", "added_time", "extra"]);

  return {
    minute: minute ?? (periodSecond === null ? null : Math.floor(periodSecond / 60)),
    extraTime,
    periodSecond,
  };
}

function isShootout(record: Record<string, unknown>): boolean {
  const text = normalize(
    [
      readString(record, ["detail", "situation", "sit", "period", "reason"]) ?? "",
      readString(record, ["type", "incident_type"]) ?? "",
    ].join(" "),
  );
  return text.includes("shootout") || text.includes("penalty shootout");
}

export function parseBsdIncidents(
  payload: unknown,
  fixture: ProviderFixture,
): FootballIncident[] {
  return extractPayloadList(payload, ["results", "incidents", "events", "items"])
    .map((record, index): FootballIncident | null => {
      const eventType = canonicalIncidentType(record);
      if (!eventType || isShootout(record)) return null;
      const team = eventTeam(record, fixture);
      const clock = parseMinute(record);
      const actor =
        eventType === "substitution"
          ? participant(
              record,
              ["player_in", "playerIn", "in_player"],
              ["player_in_id", "playerInId"],
              ["player_in_name", "playerInName"],
            )
          : participant(
              record,
              ["player", "scorer"],
              ["player_id", "scorer_id"],
              ["player_name", "scorer_name"],
            );
      const secondaryActor =
        eventType === "substitution"
          ? participant(
              record,
              ["player_out", "playerOut", "out_player"],
              ["player_out_id", "playerOutId"],
              ["player_out_name", "playerOutName"],
            )
          : participant(
              record,
              ["assist", "assist_player", "assisted_by"],
              ["assist_id", "assist_player_id"],
              ["assist_name", "assist_player_name"],
            );
      const rescinded = readBoolean(record, ["rescinded", "overturned", "cancelled"]) === true;
      return {
        eventKey: `${fixture.id}:${eventType}:${clock.periodSecond ?? clock.minute ?? "unknown"}:${actor?.id ?? actor?.name ?? "unknown"}:${index}`,
        fixtureId: fixture.id,
        eventType,
        teamId: team.id,
        teamName: team.name,
        actor,
        secondaryActor,
        minute: clock.minute,
        extraTime: clock.extraTime,
        periodSecond: clock.periodSecond,
        detail: readString(record, ["detail", "reason", "decision", "comments"]),
        rescinded,
        situation: null,
        bodyPart: null,
        xg: null,
        xgEstimated: null,
        source: "BSD",
      };
    })
    .filter((event): event is FootballIncident => event !== null)
    .sort((a, b) => {
      const left = a.periodSecond ?? (a.minute ?? 0) * 60 + (a.extraTime ?? 0) * 60;
      const right = b.periodSecond ?? (b.minute ?? 0) * 60 + (b.extraTime ?? 0) * 60;
      return left - right;
    });
}

export function parseApiFootballIncidents(
  payload: unknown,
  fixture: ProviderFixture,
): FootballIncident[] {
  return extractPayloadList(payload, ["response", "results", "events"])
    .map((record, index): FootballIncident | null => {
      const eventType = canonicalIncidentType(record);
      if (!eventType || isShootout(record)) return null;
      const team = eventTeam(record, fixture);
      const clock = parseMinute(record);
      const actor =
        eventType === "substitution"
          ? participant(
              record,
              ["assist", "player_in"],
              ["assist_id", "player_in_id"],
              ["assist_name", "player_in_name"],
            )
          : participant(record, ["player"], ["player_id"], ["player_name"]);
      const secondaryActor =
        eventType === "substitution"
          ? participant(
              record,
              ["player", "player_out"],
              ["player_id", "player_out_id"],
              ["player_name", "player_out_name"],
            )
          : participant(record, ["assist"], ["assist_id"], ["assist_name"]);
      return {
        eventKey: `${fixture.id}:${eventType}:${clock.minute ?? "unknown"}:${clock.extraTime ?? 0}:${actor?.id ?? actor?.name ?? "unknown"}:${index}`,
        fixtureId: fixture.id,
        eventType,
        teamId: team.id,
        teamName: team.name,
        actor,
        secondaryActor,
        minute: clock.minute,
        extraTime: clock.extraTime,
        periodSecond: clock.periodSecond,
        detail: readString(record, ["detail", "comments"]),
        rescinded: false,
        situation: null,
        bodyPart: null,
        xg: null,
        xgEstimated: null,
        source: "API-FOOTBALL",
      };
    })
    .filter((event): event is FootballIncident => event !== null);
}

function findShotmap(payload: unknown): Record<string, unknown>[] {
  const root = asRecord(payload);
  if (!root) return [];
  if (Array.isArray(root.shotmap)) {
    return root.shotmap
      .map(asRecord)
      .filter((item): item is Record<string, unknown> => item !== null);
  }
  return [];
}

export function enrichBsdGoalsWithShotmap(
  incidents: readonly FootballIncident[],
  statsPayload: unknown,
  fixture: ProviderFixture,
): FootballIncident[] {
  const shots = findShotmap(statsPayload).filter((shot) => {
    const type = normalize(readString(shot, ["type", "shot_type"]) ?? "");
    return type === "goal" && !isShootout(shot);
  });
  const used = new Set<number>();

  return incidents.map((incident) => {
    if (incident.eventType !== "goal") return { ...incident };
    const actorId = incident.actor?.id;
    const home = incident.teamId === fixture.home.id;
    const candidates = shots
      .map((shot, index) => ({ shot, index }))
      .filter(({ shot, index }) => {
        if (used.has(index)) return false;
        const shotPlayerId = readNumber(shot, ["player_id", "playerId"]);
        const shotHome = readBoolean(shot, ["home", "is_home"]);
        if (actorId !== null && actorId !== undefined && shotPlayerId !== actorId) return false;
        if (shotHome !== null && shotHome !== home) return false;
        const shotMinute = readNumber(shot, ["min", "minute"]);
        return incident.minute === null || shotMinute === null || Math.abs(shotMinute - incident.minute) <= 1;
      });
    if (candidates.length !== 1) return { ...incident };
    used.add(candidates[0].index);
    const shot = candidates[0].shot;
    return {
      ...incident,
      situation: readString(shot, ["sit", "situation", "shot_situation"]),
      bodyPart: readString(shot, ["body", "body_part", "bodyPart"]),
      xg: readNumber(shot, ["xg", "expected_goals"]),
      xgEstimated: readBoolean(shot, ["xg_estimated", "xgEstimated"]),
    };
  });
}

export function incidentToTeamEvent(
  incident: FootballIncident,
  fixture: ProviderFixture,
  team: ResolvedTeam,
  requestedType: FootballEventType,
): TeamFootballEvent | null {
  const isTeamEvent = incident.teamId === team.id;
  if (!isTeamEvent) return null;
  if (
    (requestedType === "yellow_card" || requestedType === "red_card") &&
    incident.rescinded
  ) {
    return null;
  }

  let actor = incident.actor;
  let secondaryActor = incident.secondaryActor;
  if (requestedType === "assist") {
    if (incident.eventType !== "goal" || !incident.secondaryActor) return null;
    actor = incident.secondaryActor;
    secondaryActor = incident.actor;
  } else if (incident.eventType !== requestedType) {
    return null;
  }

  const isHome = fixture.home.id === team.id;
  const opponent = isHome ? fixture.away : fixture.home;
  return {
    eventKey:
      requestedType === "assist" ? `${incident.eventKey}:assist` : incident.eventKey,
    fixtureId: fixture.id,
    date: fixture.date,
    timestamp: fixture.timestamp,
    competition: fixture.competition,
    teamId: team.id,
    teamName: team.name,
    opponentId: opponent.id,
    opponentName: opponent.name,
    venue: isHome ? "home" : "away",
    result: `${fixture.goals.home ?? "-"}-${fixture.goals.away ?? "-"}`,
    eventType: requestedType,
    actor,
    secondaryActor,
    minute: incident.minute,
    extraTime: incident.extraTime,
    periodSecond: incident.periodSecond,
    detail: incident.detail,
    rescinded: incident.rescinded,
    situation: incident.situation,
    bodyPart: incident.bodyPart,
    xg: incident.xg,
    xgEstimated: incident.xgEstimated,
    source: incident.source,
  };
}

export function normalizeFixtureStatus(status: string): "finished" | "live" | "upcoming" | "other" {
  const value = normalize(status);
  if (["finished", "ft", "aet", "pen", "match finished"].includes(value)) return "finished";
  if (["upcoming", "ns", "tbd", "scheduled"].includes(value)) return "upcoming";
  if (["live", "1h", "ht", "2h", "et", "bt", "p", "int"].includes(value)) return "live";
  return "other";
}

export function fixtureMatchesScope(
  fixture: ProviderFixture,
  team: ResolvedTeam,
  scope: QueryScope,
): boolean {
  const status = scope.status ? normalizeFixtureStatus(fixture.status) : null;
  if (scope.status && status !== scope.status) return false;
  if (scope.venue === "home" && fixture.home.id !== team.id) return false;
  if (scope.venue === "away" && fixture.away.id !== team.id) return false;
  if (scope.competition && normalize(fixture.competition) !== normalize(scope.competition)) return false;
  if (scope.opponent) {
    const opponent = fixture.home.id === team.id ? fixture.away.name : fixture.home.name;
    if (normalize(opponent) !== normalize(scope.opponent)) return false;
  }
  const day = new Date(fixture.timestamp * 1000).toISOString().slice(0, 10);
  if (scope.date_from && day < scope.date_from) return false;
  if (scope.date_to && day > scope.date_to) return false;
  return fixture.home.id === team.id || fixture.away.id === team.id;
}

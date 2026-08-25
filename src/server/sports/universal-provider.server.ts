import { AnalysisPipelineError } from "../analysis/errors";
import { AliasAwareTeamProvider } from "./alias-aware-provider.server";
import { FOOTBALL_CACHE_FAMILIES } from "./capability-registry";
import {
  canonicalizeCompetitionName,
  competitionAliases,
  getCompetitionDefinition,
  normalizeCompetitionText,
  selectProviderSeason,
  type CompetitionSeason,
} from "./competition-season-registry";
import { normalizeApiFootballFixtureStats, normalizeBsdFixtureStats } from "./fixture-stats";
import type { SportsCacheObserver } from "./cache/cache-observer";
import { getSportsCacheRepository, withSportsCache } from "./cache/sports-cache.server";
import { FilteredSportsDataProvider } from "./filtered-provider.server";
import {
  getProviderPayloadCacheRepository,
  type ProviderPayloadCacheRepository,
} from "./payload-cache.server";
import { getPhase3dSportsRepository } from "./phase3d-repository.server";
import type { ProviderFixture, ResolvedTeam, SportsDataProvider } from "./provider";
import {
  classifyApiFootballError,
  getApiFootballErrorPayload,
} from "./providers/api-football-errors";
import { SafeApiFootballProvider } from "./providers/api-football-safe.server";
import { BsdFootballV3Provider } from "./providers/bsd-football-v3.server";
import {
  asRecord,
  enrichBsdGoalsWithShotmap,
  extractPayloadList,
  fixtureMatchesScope,
  normalizeFixtureStatus,
  parseApiFootballIncidents,
  parseBsdIncidents,
  readNumber,
  readString,
  type FootballIncident,
  type ProviderFixtureScope,
  type UniversalCompetitionSeasonRead,
  type UniversalFixtureStatsRead,
  type ProviderReadMeta,
  type UniversalFootballSource,
  type UniversalFixtureRead,
  type UniversalIncidentRead,
  type UniversalProviderName,
} from "./universal-football";

const BSD_BASE_URL = "https://sports.bzzoiro.com/api/v2";
const API_FOOTBALL_BASE_URL = "https://v3.football.api-sports.io";
const TIMEOUT_MS = 15_000;
const MAX_FIXTURES = 200;

type ApiAuthHeader = "x-apisports-key" | "x-rapidapi-key";

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function fixtureDate(record: Record<string, unknown>): { date: string; timestamp: number } | null {
  const raw = readString(record, [
    "event_date",
    "start_time",
    "kickoff_at",
    "kickoff",
    "date",
    "scheduled_at",
  ]);
  if (raw) {
    const ms = Date.parse(raw);
    if (Number.isFinite(ms)) return { date: raw, timestamp: Math.floor(ms / 1000) };
  }
  const timestamp = readNumber(record, ["start_timestamp", "timestamp", "kickoff_timestamp"]);
  if (timestamp === null) return null;
  const ms = timestamp > 10_000_000_000 ? timestamp : timestamp * 1000;
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return null;
  return { date: date.toISOString(), timestamp: Math.floor(ms / 1000) };
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

function fixtureTeam(record: Record<string, unknown>, side: "home" | "away") {
  const team = nested(record, [`${side}_team`, side]);
  if (team) {
    const id = readNumber(team, ["id", "team_id"]);
    const name = readString(team, ["name", "team_name", "short_name"]);
    if (id !== null && name) return { id, name };
  }
  const id = readNumber(record, [`${side}_team_id`, `${side}_id`]);
  const name = readString(record, [`${side}_team_name`, `${side}_name`, `${side}_team`]);
  return id !== null && name ? { id, name } : null;
}

function fixtureScore(record: Record<string, unknown>, side: "home" | "away"): number | null {
  const direct = readNumber(record, [`${side}_score`, `${side}_goals`, `score_${side}`]);
  if (direct !== null) return direct;
  const score = nested(record, ["score", "scores"]);
  return score
    ? readNumber(score, [side, `${side}_score`, `${side}_goals`, `full_time_${side}`])
    : null;
}

function parseBsdFixture(
  record: Record<string, unknown>,
  leagueNames: ReadonlyMap<number, string>,
): ProviderFixture | null {
  const id = readNumber(record, ["id", "event_id", "fixture_id"]);
  const when = fixtureDate(record);
  const home = fixtureTeam(record, "home");
  const away = fixtureTeam(record, "away");
  if (id === null || !when || !home || !away) return null;
  const league = nested(record, ["league", "competition"]);
  const leagueId =
    readNumber(record, ["league_id"]) ?? (league ? readNumber(league, ["id", "league_id"]) : null);
  const competition =
    (league ? readString(league, ["name", "league_name", "competition_name"]) : null) ??
    readString(record, ["league_name", "competition_name"]) ??
    (leagueId === null ? null : leagueNames.get(leagueId)) ??
    "Competição";
  return {
    id,
    date: when.date,
    timestamp: when.timestamp,
    status: (readString(record, ["status"]) ?? "").toLowerCase(),
    competition,
    competitionId: leagueId === null ? null : String(leagueId),
    seasonId: (() => {
      const season = nested(record, ["season"]);
      const value =
        readNumber(record, ["season_id"]) ??
        (season ? readNumber(season, ["id", "season_id", "year"]) : null);
      return value === null ? null : String(value);
    })(),
    country:
      (league ? readString(league, ["country", "country_name"]) : null) ??
      readString(record, ["country", "country_name"]),
    home,
    away,
    goals: { home: fixtureScore(record, "home"), away: fixtureScore(record, "away") },
  };
}

function parseApiFixture(record: Record<string, unknown>): ProviderFixture | null {
  const fixture = nested(record, ["fixture"]) ?? record;
  const league = nested(record, ["league"]);
  const teams = nested(record, ["teams"]);
  const homeRecord = teams ? nested(teams, ["home"]) : null;
  const awayRecord = teams ? nested(teams, ["away"]) : null;
  const goals = nested(record, ["goals"]);
  const id = readNumber(fixture, ["id", "fixture_id"]);
  const when = fixtureDate(fixture);
  const homeId = homeRecord ? readNumber(homeRecord, ["id"]) : null;
  const awayId = awayRecord ? readNumber(awayRecord, ["id"]) : null;
  const homeName = homeRecord ? readString(homeRecord, ["name"]) : null;
  const awayName = awayRecord ? readString(awayRecord, ["name"]) : null;
  if (id === null || !when || homeId === null || awayId === null || !homeName || !awayName) {
    return null;
  }
  const statusRecord = nested(fixture, ["status"]);
  return {
    id,
    date: when.date,
    timestamp: when.timestamp,
    status:
      (statusRecord ? readString(statusRecord, ["short", "long"]) : null) ??
      readString(fixture, ["status"]) ??
      "",
    competition: (league ? readString(league, ["name"]) : null) ?? "Competição",
    competitionId: league ? String(readNumber(league, ["id"]) ?? "") || null : null,
    seasonId: league ? String(readNumber(league, ["season"]) ?? "") || null : null,
    country: league ? readString(league, ["country"]) : null,
    home: { id: homeId, name: homeName },
    away: { id: awayId, name: awayName },
    goals: {
      home: goals ? readNumber(goals, ["home"]) : null,
      away: goals ? readNumber(goals, ["away"]) : null,
    },
  };
}

function truthyBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1" || value === "true") return true;
  if (value === 0 || value === "0" || value === "false") return false;
  return null;
}

function countryName(record: Record<string, unknown>): string | null {
  const country = asRecord(record.country);
  return (
    (country ? readString(country, ["name", "country_name"]) : null) ??
    readString(record, ["country_name", "country"])
  );
}

function matchesCompetitionName(candidate: string, requested: string): boolean {
  const wanted = new Set(competitionAliases(requested).map(normalizeCompetitionText));
  return wanted.has(normalizeCompetitionText(candidate));
}

function chooseCompetitionRow(
  rows: readonly Record<string, unknown>[],
  requested: string,
): Record<string, unknown> | null {
  const definition = getCompetitionDefinition(requested);
  const matches = rows.filter((row) => {
    const league = asRecord(row.league) ?? row;
    const name = readString(league, ["name", "league_name", "competition_name"]);
    if (!name || !matchesCompetitionName(name, requested)) return false;
    if (!definition?.countryHint) return true;
    const country = countryName(row) ?? countryName(league);
    return (
      country === null ||
      normalizeCompetitionText(country) === normalizeCompetitionText(definition.countryHint)
    );
  });
  return matches.length === 1 ? matches[0] : null;
}

function providerSeasonLabel(startDate: string, endDate: string, fallback: string): string {
  const start = startDate.slice(0, 4);
  const end = endDate.slice(0, 4);
  if (/^\d{4}$/.test(start) && /^\d{4}$/.test(end)) {
    return start === end ? start : `${start}/${end.slice(2)}`;
  }
  return fallback;
}

function flattenCoverage(
  value: unknown,
  prefix = "",
  result: Record<string, boolean | null> = {},
): Record<string, boolean | null> {
  const record = asRecord(value);
  if (!record) return result;
  for (const [key, child] of Object.entries(record)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const boolean = truthyBoolean(child);
    if (boolean !== null) result[path] = boolean;
    else if (child === null) result[path] = null;
    else if (asRecord(child)) flattenCoverage(child, path, result);
  }
  return result;
}

function parseBsdSeasons(
  payload: unknown,
  competitionId: string,
  competition: string,
  country: string | null,
): CompetitionSeason[] {
  return extractPayloadList(payload, ["results", "seasons", "items"])
    .map((row): CompetitionSeason | null => {
      const id = readNumber(row, ["id", "season_id", "year"]);
      const startDate = readString(row, ["start_date", "start", "date_start"]);
      const endDate = readString(row, ["end_date", "end", "date_end"]);
      if (id === null || !startDate || !endDate) return null;
      const rawLabel = readString(row, ["name", "label"]) ?? String(id);
      return {
        provider: "BSD",
        competitionId,
        seasonId: String(id),
        label: providerSeasonLabel(startDate, endDate, rawLabel),
        startDate,
        endDate,
        current: truthyBoolean(row.is_current ?? row.current) === true,
        country,
        coverage: flattenCoverage(row.coverage),
        competition,
      };
    })
    .filter((season): season is CompetitionSeason => season !== null);
}

function parseApiSeasons(
  row: Record<string, unknown>,
  competitionId: string,
  competition: string,
): CompetitionSeason[] {
  const country = countryName(row);
  const seasons = Array.isArray(row.seasons) ? row.seasons : [];
  return seasons
    .map(asRecord)
    .filter((season): season is Record<string, unknown> => season !== null)
    .map((season): CompetitionSeason | null => {
      const year = readNumber(season, ["year"]);
      const startDate = readString(season, ["start"]);
      const endDate = readString(season, ["end"]);
      if (year === null || !startDate || !endDate) return null;
      return {
        provider: "API-FOOTBALL",
        competitionId,
        seasonId: String(year),
        label: providerSeasonLabel(startDate, endDate, String(year)),
        startDate,
        endDate,
        current: truthyBoolean(season.current) === true,
        country,
        coverage: flattenCoverage(season.coverage),
        competition,
      };
    })
    .filter((season): season is CompetitionSeason => season !== null);
}

function cacheKey(path: string, params: Record<string, string | number>): string {
  const query = Object.entries(params)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");
  return query ? `${path}?${query}` : path;
}

async function cachedRead<T>(params: {
  repository: ProviderPayloadCacheRepository | null;
  observer?: SportsCacheObserver;
  provider: UniversalProviderName;
  endpoint: string;
  dataFamily: string;
  key: string;
  ttlMs: number;
  load: () => Promise<T>;
}): Promise<{ payload: T; meta: ProviderReadMeta }> {
  if (params.repository) {
    try {
      const cached = await params.repository.get<T>(params.provider, params.dataFamily, params.key);
      if (cached) {
        params.observer?.cacheHit(params.provider, params.dataFamily);
        return {
          payload: cached.payload,
          meta: {
            provider: params.provider,
            endpoint: params.endpoint,
            dataFamily: params.dataFamily,
            fetchedAt: cached.fetchedAt,
            cacheStatus: "hit",
          },
        };
      }
      params.observer?.cacheMiss(params.provider, params.dataFamily);
    } catch (error) {
      console.warn("[provider-payload-cache] read failed; provider remains authoritative", {
        provider: params.provider,
        dataFamily: params.dataFamily,
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  } else {
    params.observer?.cacheMiss(params.provider, params.dataFamily);
  }

  params.observer?.providerCall(params.provider, params.dataFamily);
  const payload = await params.load();
  const fetchedAt = new Date().toISOString();
  if (params.repository) {
    try {
      const stored = await params.repository.set({
        provider: params.provider,
        dataFamily: params.dataFamily,
        cacheKey: params.key,
        payload,
        ttlMs: params.ttlMs,
      });
      return {
        payload,
        meta: {
          provider: params.provider,
          endpoint: params.endpoint,
          dataFamily: params.dataFamily,
          fetchedAt: stored.fetchedAt,
          cacheStatus: "miss",
        },
      };
    } catch (error) {
      console.warn("[provider-payload-cache] write failed; provider result kept", {
        provider: params.provider,
        dataFamily: params.dataFamily,
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  }
  return {
    payload,
    meta: {
      provider: params.provider,
      endpoint: params.endpoint,
      dataFamily: params.dataFamily,
      fetchedAt,
      cacheStatus: params.repository ? "miss" : "disabled",
    },
  };
}

function wrapIdentityProvider(
  provider: SportsDataProvider,
  observer?: SportsCacheObserver,
): SportsDataProvider {
  return new FilteredSportsDataProvider(
    new AliasAwareTeamProvider(
      withSportsCache(provider, observer),
      getPhase3dSportsRepository(),
      getSportsCacheRepository(),
      observer,
    ),
  );
}

abstract class BaseUniversalSource implements UniversalFootballSource {
  abstract readonly name: UniversalProviderName;

  constructor(
    protected readonly identityProvider: SportsDataProvider,
    protected readonly observer?: SportsCacheObserver,
    protected readonly payloadCache = getProviderPayloadCacheRepository(),
  ) {}

  resolveTeam(name: string): Promise<ResolvedTeam> {
    return this.identityProvider.resolveTeam(name);
  }

  abstract listTeamFixtures(
    team: ResolvedTeam,
    scope: ProviderFixtureScope,
  ): Promise<UniversalFixtureRead>;
  abstract getFixtureIncidents(fixture: ProviderFixture): Promise<UniversalIncidentRead>;
  abstract enrichGoalEvents(
    fixture: ProviderFixture,
    incidents: readonly FootballIncident[],
  ): Promise<{ incidents: FootballIncident[]; meta: ProviderReadMeta | null }>;

  async getFixtureMetric(
    fixture: ProviderFixture,
    teamId: number,
    metric: "goals" | "corners" | "shots" | "shots_on_target" | "cards",
  ): Promise<number | null> {
    const match = await this.identityProvider.getFixtureMetric(fixture, teamId, metric);
    return match?.value ?? null;
  }

  protected async persistFixtures(fixtures: readonly ProviderFixture[]): Promise<void> {
    const repository = getSportsCacheRepository();
    if (!repository || fixtures.length === 0) return;
    try {
      await repository.upsertFixtures(this.name, fixtures);
    } catch (error) {
      console.warn("[universal-football] fixture persistence failed; provider result kept", {
        provider: this.name,
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  }
}

export class BsdUniversalFootballSource extends BaseUniversalSource {
  readonly name = "BSD" as const;
  private leagueNamesPromise: Promise<Map<number, string>> | null = null;
  private fixtureStatsReads = new Map<
    number,
    Promise<{ payload: unknown; meta: ProviderReadMeta }>
  >();

  private async request(
    path: string,
    params: Record<string, string | number> = {},
  ): Promise<unknown> {
    const apiKey = process.env.BSD_FOOTBALL_KEY;
    if (!apiKey) {
      throw new AnalysisPipelineError(
        "PROVIDER_UNAVAILABLE",
        "A BSD Football API não está configurada no servidor.",
      );
    }
    const url = new URL(`${BSD_BASE_URL}${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        headers: { Authorization: `Token ${apiKey}` },
        signal: controller.signal,
      });
      if (response.status === 429) {
        throw new AnalysisPipelineError(
          "API_LIMIT_REACHED",
          "O limite de requisições da BSD Football API foi atingido.",
        );
      }
      if (!response.ok) {
        throw new AnalysisPipelineError(
          "PROVIDER_UNAVAILABLE",
          `A BSD Football API falhou ao consultar ${path} (HTTP ${response.status}).`,
        );
      }
      return (await response.json()) as unknown;
    } catch (error) {
      if (error instanceof AnalysisPipelineError) throw error;
      throw new AnalysisPipelineError(
        "PROVIDER_UNAVAILABLE",
        "A BSD Football API não respondeu à consulta universal.",
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private async leagueNames(): Promise<Map<number, string>> {
    if (!this.leagueNamesPromise) {
      const params = { limit: 200, offset: 0 };
      this.leagueNamesPromise = cachedRead({
        repository: this.payloadCache,
        observer: this.observer,
        provider: this.name,
        endpoint: "/leagues/",
        dataFamily: "league_season",
        key: cacheKey("/leagues/", params),
        ttlMs: FOOTBALL_CACHE_FAMILIES.league_season.ttlMs,
        load: () => this.request("/leagues/", params),
      }).then(({ payload }) => {
        const result = new Map<number, string>();
        for (const row of extractPayloadList(payload, ["results", "leagues", "items"])) {
          const id = readNumber(row, ["id", "league_id"]);
          const name = readString(row, ["name", "league_name"]);
          if (id !== null && name) result.set(id, name);
        }
        return result;
      });
    }
    return this.leagueNamesPromise;
  }

  async resolveCompetitionSeason(
    competition: string,
    season: string,
  ): Promise<UniversalCompetitionSeasonRead> {
    const leagueParams = { limit: 200, offset: 0 };
    const leagueRead = await cachedRead({
      repository: this.payloadCache,
      observer: this.observer,
      provider: this.name,
      endpoint: "/leagues/",
      dataFamily: "league_season",
      key: cacheKey("/leagues/", leagueParams),
      ttlMs: FOOTBALL_CACHE_FAMILIES.league_season.ttlMs,
      load: () => this.request("/leagues/", leagueParams),
    });
    const row = chooseCompetitionRow(
      extractPayloadList(leagueRead.payload, ["results", "leagues", "items"]),
      competition,
    );
    if (!row) {
      throw new AnalysisPipelineError(
        "DATA_INSUFFICIENT",
        `A BSD não resolveu de forma inequívoca a competição "${competition}".`,
      );
    }
    const league = asRecord(row.league) ?? row;
    const leagueId = readNumber(league, ["id", "league_id"]);
    if (leagueId === null) {
      throw new AnalysisPipelineError(
        "DATA_INSUFFICIENT",
        "A BSD não informou o ID real da competição.",
      );
    }
    const canonical = canonicalizeCompetitionName(competition);
    const country = countryName(row) ?? countryName(league);
    const endpoint = `/leagues/${leagueId}/seasons/`;
    const read = await cachedRead({
      repository: this.payloadCache,
      observer: this.observer,
      provider: this.name,
      endpoint,
      dataFamily: "league_season",
      key: endpoint,
      ttlMs: FOOTBALL_CACHE_FAMILIES.league_season.ttlMs,
      load: () => this.request(endpoint),
    });
    const seasons = parseBsdSeasons(read.payload, String(leagueId), canonical, country);
    const resolved = selectProviderSeason(seasons, season);
    if (!resolved) {
      throw new AnalysisPipelineError(
        "DATA_INSUFFICIENT",
        `A BSD não confirmou a temporada "${season}" de ${canonical}; nenhuma janela de calendário foi inferida.`,
      );
    }
    return { season: resolved, meta: read.meta };
  }

  private fixtureStatsPayload(
    fixture: ProviderFixture,
  ): Promise<{ payload: unknown; meta: ProviderReadMeta }> {
    const existing = this.fixtureStatsReads.get(fixture.id);
    if (existing) return existing;
    const endpoint = `/events/${fixture.id}/stats/`;
    const ttlMs =
      normalizeFixtureStatus(fixture.status) === "finished"
        ? FOOTBALL_CACHE_FAMILIES.finished_match_detail.ttlMs
        : FOOTBALL_CACHE_FAMILIES.team_stats.ttlMs;
    const read = cachedRead({
      repository: this.payloadCache,
      observer: this.observer,
      provider: this.name,
      endpoint,
      dataFamily: "fixture_stats",
      key: endpoint,
      ttlMs,
      load: () => this.request(endpoint),
    });
    this.fixtureStatsReads.set(fixture.id, read);
    return read;
  }

  async getFixtureStats(
    fixture: ProviderFixture,
    teamId: number,
  ): Promise<UniversalFixtureStatsRead> {
    const read = await this.fixtureStatsPayload(fixture);
    return {
      snapshot: normalizeBsdFixtureStats(read.payload, fixture, teamId, read.meta.fetchedAt),
      meta: read.meta,
    };
  }

  async listTeamFixtures(
    team: ResolvedTeam,
    scope: ProviderFixtureScope,
  ): Promise<UniversalFixtureRead> {
    const now = new Date();
    const status = scope.status ?? "finished";
    const from = scope.date_from
      ? new Date(`${scope.date_from}T00:00:00.000Z`)
      : new Date(now.getTime());
    const to = scope.date_to ? new Date(`${scope.date_to}T23:59:59.999Z`) : new Date(now.getTime());
    if (!scope.date_from) {
      if (status === "upcoming") from.setUTCDate(from.getUTCDate() - 1);
      else from.setUTCDate(from.getUTCDate() - 730);
    }
    if (!scope.date_to && status === "upcoming") to.setUTCDate(to.getUTCDate() + 365);

    const params: Record<string, string | number> = {
      team_id: team.id,
      status,
      date_from: formatDate(from),
      date_to: formatDate(to),
      limit: MAX_FIXTURES,
      offset: 0,
    };
    if (scope.providerCompetitionId) params.league_id = scope.providerCompetitionId;
    if (scope.providerSeasonId) params.season_id = scope.providerSeasonId;
    const read = await cachedRead({
      repository: this.payloadCache,
      observer: this.observer,
      provider: this.name,
      endpoint: "/events/",
      dataFamily: "fixtures",
      key: cacheKey("/events/", params),
      ttlMs: FOOTBALL_CACHE_FAMILIES.fixtures.ttlMs,
      load: () => this.request("/events/", params),
    });
    const leagues = await this.leagueNames();
    const fixtures = extractPayloadList(read.payload, ["results", "events", "items"])
      .map((row) => parseBsdFixture(row, leagues))
      .filter((fixture): fixture is ProviderFixture => fixture !== null)
      .filter((fixture) => fixtureMatchesScope(fixture, team, { ...scope, status }))
      .sort((a, b) => a.timestamp - b.timestamp);
    await this.persistFixtures(fixtures);
    return { fixtures, meta: read.meta };
  }

  async getFixtureIncidents(fixture: ProviderFixture): Promise<UniversalIncidentRead> {
    const endpoint = `/events/${fixture.id}/incidents/`;
    const ttlMs =
      normalizeFixtureStatus(fixture.status) === "finished"
        ? FOOTBALL_CACHE_FAMILIES.incidents_finished.ttlMs
        : FOOTBALL_CACHE_FAMILIES.incidents_live.ttlMs;
    const read = await cachedRead({
      repository: this.payloadCache,
      observer: this.observer,
      provider: this.name,
      endpoint,
      dataFamily: "incidents",
      key: endpoint,
      ttlMs,
      load: () => this.request(endpoint),
    });
    return { incidents: parseBsdIncidents(read.payload, fixture), meta: read.meta };
  }

  async enrichGoalEvents(
    fixture: ProviderFixture,
    incidents: readonly FootballIncident[],
  ): Promise<{ incidents: FootballIncident[]; meta: ProviderReadMeta | null }> {
    if (!incidents.some((incident) => incident.eventType === "goal")) {
      return { incidents: [...incidents], meta: null };
    }
    try {
      const read = await this.fixtureStatsPayload(fixture);
      return {
        incidents: enrichBsdGoalsWithShotmap(incidents, read.payload, fixture),
        meta: read.meta,
      };
    } catch {
      return { incidents: [...incidents], meta: null };
    }
  }
}

function apiAuthHeaders(header: ApiAuthHeader, apiKey: string): Record<string, string> {
  if (header === "x-rapidapi-key") {
    return {
      "x-rapidapi-key": apiKey,
      "x-rapidapi-host": "v3.football.api-sports.io",
    };
  }
  return { "x-apisports-key": apiKey };
}

function shouldRetryApiAuth(response: Response, payload: unknown): boolean {
  if (response.status === 401 || response.status === 403) return true;
  const errorPayload = getApiFootballErrorPayload(payload);
  return errorPayload !== null && classifyApiFootballError(errorPayload) === "auth";
}

function apiPayloadHasErrors(payload: unknown): boolean {
  return getApiFootballErrorPayload(payload) !== null;
}

export class ApiFootballUniversalSource extends BaseUniversalSource {
  readonly name = "API-FOOTBALL" as const;
  private fixtureStatsReads = new Map<
    number,
    Promise<{ payload: unknown; meta: ProviderReadMeta }>
  >();

  private async request(
    path: string,
    params: Record<string, string | number> = {},
  ): Promise<unknown> {
    const apiKey = process.env.API_FOOTBALL_KEY;
    if (!apiKey) {
      throw new AnalysisPipelineError(
        "PROVIDER_UNAVAILABLE",
        "A API-FOOTBALL não está configurada no servidor.",
      );
    }
    const url = new URL(`${API_FOOTBALL_BASE_URL}${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));

    const perform = async (
      header: ApiAuthHeader,
    ): Promise<{ response: Response; payload: unknown }> => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const response = await fetch(url, {
          headers: apiAuthHeaders(header, apiKey),
          signal: controller.signal,
        });
        let payload: unknown = null;
        try {
          payload = (await response.json()) as unknown;
        } catch {
          // HTTP handling below remains deterministic without a JSON body.
        }
        return { response, payload };
      } catch {
        throw new AnalysisPipelineError(
          "PROVIDER_UNAVAILABLE",
          "A API-FOOTBALL não respondeu à consulta universal.",
        );
      } finally {
        clearTimeout(timeout);
      }
    };

    let result = await perform("x-apisports-key");
    if (result.response.status === 429) {
      throw new AnalysisPipelineError(
        "API_LIMIT_REACHED",
        "O limite de requisições da API-FOOTBALL foi atingido.",
      );
    }
    if (shouldRetryApiAuth(result.response, result.payload)) {
      result = await perform("x-rapidapi-key");
    }
    if (result.response.status === 429) {
      throw new AnalysisPipelineError(
        "API_LIMIT_REACHED",
        "O limite de requisições da API-FOOTBALL foi atingido.",
      );
    }
    if (!result.response.ok || apiPayloadHasErrors(result.payload)) {
      const errorPayload = getApiFootballErrorPayload(result.payload);
      const kind = errorPayload === null ? "provider" : classifyApiFootballError(errorPayload);
      const code = kind === "limit" ? "API_LIMIT_REACHED" : "PROVIDER_UNAVAILABLE";
      throw new AnalysisPipelineError(
        code,
        `A API-FOOTBALL recusou ${path} (${kind}). Nenhum retry fora do fallback de autenticação foi feito para preservar quota.`,
      );
    }
    return result.payload;
  }

  async resolveCompetitionSeason(
    competition: string,
    season: string,
  ): Promise<UniversalCompetitionSeasonRead> {
    const canonical = canonicalizeCompetitionName(competition);
    const params = { search: canonical };
    const read = await cachedRead({
      repository: this.payloadCache,
      observer: this.observer,
      provider: this.name,
      endpoint: "/leagues",
      dataFamily: "league_season",
      key: cacheKey("/leagues", params),
      ttlMs: FOOTBALL_CACHE_FAMILIES.league_season.ttlMs,
      load: () => this.request("/leagues", params),
    });
    const row = chooseCompetitionRow(
      extractPayloadList(read.payload, ["response", "results"]),
      competition,
    );
    if (!row) {
      throw new AnalysisPipelineError(
        "DATA_INSUFFICIENT",
        `A API-FOOTBALL não resolveu de forma inequívoca a competição "${competition}".`,
      );
    }
    const league = asRecord(row.league) ?? row;
    const leagueId = readNumber(league, ["id"]);
    if (leagueId === null) {
      throw new AnalysisPipelineError(
        "DATA_INSUFFICIENT",
        "A API-FOOTBALL não informou o ID real da competição.",
      );
    }
    const seasons = parseApiSeasons(row, String(leagueId), canonical);
    const resolved = selectProviderSeason(seasons, season);
    if (!resolved) {
      throw new AnalysisPipelineError(
        "DATA_INSUFFICIENT",
        `A API-FOOTBALL não confirmou a temporada "${season}" de ${canonical}; nenhuma janela de calendário foi inferida.`,
      );
    }
    return { season: resolved, meta: read.meta };
  }

  private fixtureStatsPayload(
    fixture: ProviderFixture,
  ): Promise<{ payload: unknown; meta: ProviderReadMeta }> {
    const existing = this.fixtureStatsReads.get(fixture.id);
    if (existing) return existing;
    const endpoint = "/fixtures/statistics";
    const params = { fixture: fixture.id };
    const ttlMs =
      normalizeFixtureStatus(fixture.status) === "finished"
        ? FOOTBALL_CACHE_FAMILIES.finished_match_detail.ttlMs
        : FOOTBALL_CACHE_FAMILIES.team_stats.ttlMs;
    const read = cachedRead({
      repository: this.payloadCache,
      observer: this.observer,
      provider: this.name,
      endpoint,
      dataFamily: "fixture_stats",
      key: cacheKey(endpoint, params),
      ttlMs,
      load: () => this.request(endpoint, params),
    });
    this.fixtureStatsReads.set(fixture.id, read);
    return read;
  }

  async getFixtureStats(
    fixture: ProviderFixture,
    teamId: number,
  ): Promise<UniversalFixtureStatsRead> {
    const read = await this.fixtureStatsPayload(fixture);
    return {
      snapshot: normalizeApiFootballFixtureStats(
        read.payload,
        fixture,
        teamId,
        read.meta.fetchedAt,
      ),
      meta: read.meta,
    };
  }

  async listTeamFixtures(
    team: ResolvedTeam,
    scope: ProviderFixtureScope,
  ): Promise<UniversalFixtureRead> {
    const status = scope.status ?? "finished";
    const params: Record<string, string | number> = { team: team.id };
    if (scope.providerCompetitionId) params.league = scope.providerCompetitionId;
    if (scope.providerSeasonId) params.season = scope.providerSeasonId;
    if (scope.date_from) params.from = scope.date_from;
    if (scope.date_to) params.to = scope.date_to;
    if (!scope.date_from && !scope.date_to && !scope.providerSeasonId) {
      if (status === "upcoming") params.next = MAX_FIXTURES;
      else if (status === "finished") params.last = MAX_FIXTURES;
    }
    params.status =
      status === "finished" ? "FT-AET-PEN" : status === "upcoming" ? "NS-TBD" : "1H-HT-2H-ET-BT-P";

    const read = await cachedRead({
      repository: this.payloadCache,
      observer: this.observer,
      provider: this.name,
      endpoint: "/fixtures",
      dataFamily: "fixtures",
      key: cacheKey("/fixtures", params),
      ttlMs: FOOTBALL_CACHE_FAMILIES.fixtures.ttlMs,
      load: () => this.request("/fixtures", params),
    });
    const fixtures = extractPayloadList(read.payload, ["response", "results"])
      .map(parseApiFixture)
      .filter((fixture): fixture is ProviderFixture => fixture !== null)
      .filter((fixture) => fixtureMatchesScope(fixture, team, { ...scope, status }))
      .sort((left, right) => left.timestamp - right.timestamp);
    await this.persistFixtures(fixtures);
    return { fixtures, meta: read.meta };
  }

  async getFixtureIncidents(fixture: ProviderFixture): Promise<UniversalIncidentRead> {
    const endpoint = "/fixtures/events";
    const params = { fixture: fixture.id };
    const finished = normalizeFixtureStatus(fixture.status) === "finished";
    const read = await cachedRead({
      repository: this.payloadCache,
      observer: this.observer,
      provider: this.name,
      endpoint,
      dataFamily: "incidents",
      key: cacheKey(endpoint, params),
      ttlMs: finished
        ? FOOTBALL_CACHE_FAMILIES.incidents_finished.ttlMs
        : FOOTBALL_CACHE_FAMILIES.incidents_live.ttlMs,
      load: () => this.request(endpoint, params),
    });
    return { incidents: parseApiFootballIncidents(read.payload, fixture), meta: read.meta };
  }

  async enrichGoalEvents(
    _fixture: ProviderFixture,
    incidents: readonly FootballIncident[],
  ): Promise<{ incidents: FootballIncident[]; meta: ProviderReadMeta | null }> {
    return { incidents: [...incidents], meta: null };
  }
}

export function createUniversalFootballSources(
  observer?: SportsCacheObserver,
  allowedProviders?: readonly UniversalProviderName[],
): UniversalFootballSource[] {
  const sources: UniversalFootballSource[] = [];
  const allowed = (name: UniversalProviderName) =>
    !allowedProviders || allowedProviders.includes(name);
  if (process.env.BSD_FOOTBALL_KEY && allowed("BSD")) {
    sources.push(
      new BsdUniversalFootballSource(
        wrapIdentityProvider(new BsdFootballV3Provider(), observer),
        observer,
      ),
    );
  }
  if (process.env.API_FOOTBALL_KEY && allowed("API-FOOTBALL")) {
    sources.push(
      new ApiFootballUniversalSource(
        wrapIdentityProvider(new SafeApiFootballProvider(), observer),
        observer,
      ),
    );
  }
  return sources;
}

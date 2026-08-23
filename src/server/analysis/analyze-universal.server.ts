import type {
  HeadToHeadAnalysisResult,
  MatchListAnalysisResult,
  TeamEventListAnalysisResult,
  UniversalAnalysisIntent,
} from "@/lib/universal-analysis";
import type { AnalysisOverrides } from "@/lib/analysis-request";
import type { SportsCacheObserver } from "@/server/sports/cache/cache-observer";
import type { ProviderFixture, ResolvedTeam } from "@/server/sports/provider";
import { createUniversalFootballSources } from "@/server/sports/universal-provider.server";
import {
  incidentToTeamEvent,
  type ProviderReadMeta,
  type TeamFootballEvent,
  type UniversalFootballSource,
} from "@/server/sports/universal-football";

import { aggregateNumericValues, aggregateRatio } from "./aggregation";
import { AnalysisPipelineError } from "./errors";
import { queryPlanSchema, queryPlanSignature, type QueryPlan } from "./query-plan";

const EVENT_CONCURRENCY = 4;
const DEFAULT_MATCH_COUNT = 5;
const EVENT_HISTORY_LIMIT = 200;

function canTryNextSource(error: unknown): boolean {
  return (
    error instanceof AnalysisPipelineError &&
    ["TEAM_NOT_FOUND", "PROVIDER_UNAVAILABLE", "API_LIMIT_REACHED", "DATA_INSUFFICIENT"].includes(
      error.code,
    )
  );
}

async function firstSuccessful<T>(
  sources: readonly UniversalFootballSource[],
  worker: (source: UniversalFootballSource) => Promise<T>,
): Promise<T> {
  if (sources.length === 0) {
    throw new AnalysisPipelineError(
      "PROVIDER_UNAVAILABLE",
      "Nenhum provider universal de futebol está configurado no servidor.",
    );
  }
  let lastError: unknown = null;
  for (const source of sources) {
    try {
      return await worker(source);
    } catch (error) {
      if (!canTryNextSource(error)) throw error;
      lastError = error;
      console.warn("[universal-query] capability-aware fallback", {
        provider: source.name,
        reason: error instanceof AnalysisPipelineError ? error.code : "unknown",
      });
    }
  }
  if (lastError instanceof AnalysisPipelineError) throw lastError;
  throw new AnalysisPipelineError(
    "PROVIDER_UNAVAILABLE",
    "Os providers configurados não conseguiram executar a capability solicitada.",
  );
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function run() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, limit), items.length) }, () => run()),
  );
  return results;
}

function applyUniversalOverrides(plan: QueryPlan, overrides?: AnalysisOverrides): QueryPlan {
  if (!overrides) return plan;
  const scope = {
    ...plan.scope,
    ...(overrides.match_count !== undefined ? { last_matches: overrides.match_count } : {}),
    ...(overrides.venue !== undefined ? { venue: overrides.venue } : {}),
    ...(Object.prototype.hasOwnProperty.call(overrides, "competition")
      ? overrides.competition
        ? { competition: overrides.competition }
        : { competition: undefined }
      : {}),
  };
  return queryPlanSchema.parse({ ...plan, scope });
}

function matchCount(plan: QueryPlan): number {
  return plan.scope.last_matches ?? plan.scope.limit ?? DEFAULT_MATCH_COUNT;
}

function selectFixtures(
  fixtures: readonly ProviderFixture[],
  count: number,
  status: "finished" | "live" | "upcoming",
): ProviderFixture[] {
  const ordered = [...fixtures].sort((a, b) => a.timestamp - b.timestamp);
  if (status === "upcoming") return ordered.slice(0, count);
  return ordered.slice(-count);
}

function resultForTeam(fixture: ProviderFixture, team: ResolvedTeam) {
  const isHome = fixture.home.id === team.id;
  const goalsFor = isHome ? fixture.goals.home : fixture.goals.away;
  const goalsAgainst = isHome ? fixture.goals.away : fixture.goals.home;
  const outcome =
    goalsFor === null || goalsAgainst === null
      ? null
      : goalsFor > goalsAgainst
        ? ("V" as const)
        : goalsFor < goalsAgainst
          ? ("D" as const)
          : ("E" as const);
  return {
    fixture_id: String(fixture.id),
    date: fixture.date,
    status: fixture.status,
    competition: fixture.competition,
    home_team: { id: String(fixture.home.id), name: fixture.home.name },
    away_team: { id: String(fixture.away.id), name: fixture.away.name },
    home_goals: fixture.goals.home,
    away_goals: fixture.goals.away,
    opponent: isHome ? fixture.away.name : fixture.home.name,
    venue: isHome ? ("home" as const) : ("away" as const),
    result: `${fixture.goals.home ?? "-"}-${fixture.goals.away ?? "-"}`,
    outcome,
  };
}

function universalIntent(params: {
  plan: QueryPlan;
  team: ResolvedTeam;
  compare?: ResolvedTeam;
  count: number;
  status: "finished" | "live" | "upcoming";
}): UniversalAnalysisIntent {
  return {
    sport: "football",
    query_kind: params.plan.query_kind as UniversalAnalysisIntent["query_kind"],
    entity_type: "team",
    entity_name: params.team.name,
    entity_id: String(params.team.id),
    compare_with: params.compare
      ? { entity_name: params.compare.name, entity_id: String(params.compare.id) }
      : null,
    ...(params.plan.event_type ? { event_type: params.plan.event_type } : {}),
    metric: params.plan.metric ?? null,
    aggregation: params.plan.aggregation ?? null,
    match_count: params.count,
    competition: params.plan.scope.competition ?? null,
    venue: params.plan.scope.venue,
    status: params.status,
  };
}

function combineMeta(items: readonly ProviderReadMeta[]): {
  endpoint: string;
  family: string;
  fetchedAt: string;
  cacheStatus: "hit" | "miss" | "mixed" | "disabled" | "unknown";
} {
  if (items.length === 0) {
    return {
      endpoint: "unknown",
      family: "unknown",
      fetchedAt: new Date().toISOString(),
      cacheStatus: "unknown",
    };
  }
  const statuses = new Set(items.map((item) => item.cacheStatus));
  return {
    endpoint: Array.from(new Set(items.map((item) => item.endpoint))).join(" + "),
    family: Array.from(new Set(items.map((item) => item.dataFamily))).join(" + "),
    fetchedAt: items
      .map((item) => item.fetchedAt)
      .sort()
      .at(-1)!,
    cacheStatus: statuses.size === 1 ? items[0].cacheStatus : "mixed",
  };
}

function eventWithinHalf(event: TeamFootballEvent, half: QueryPlan["scope"]["half"]): boolean {
  if (half === "full" || event.minute === null) return true;
  return half === "first" ? event.minute <= 45 : event.minute > 45;
}

function eventRelatedQuestions(eventType: QueryPlan["event_type"], teamName: string): string[] {
  if (eventType === "goal") {
    return [
      `Quem deu assistência para os gols do ${teamName}?`,
      `Quem tomou cartão amarelo no ${teamName} nos últimos 5 jogos?`,
      `Quais foram os últimos 5 jogos do ${teamName}?`,
    ];
  }
  if (eventType === "assist") {
    return [
      `Quem fez gol do ${teamName} nos últimos 5 jogos?`,
      `Quais gols do ${teamName} tiveram assistência?`,
      `Quais foram os últimos 5 jogos do ${teamName}?`,
    ];
  }
  return [
    `Quem fez gol do ${teamName} nos últimos 5 jogos?`,
    `Quais foram os últimos 5 jogos do ${teamName}?`,
    `Quem foi expulso pelo ${teamName} recentemente?`,
  ];
}

async function analyzeTeamEvents(params: {
  question: string;
  plan: QueryPlan;
  source: UniversalFootballSource;
}): Promise<TeamEventListAnalysisResult> {
  const { plan, source } = params;
  if (!plan.event_type) {
    throw new AnalysisPipelineError(
      "QUESTION_NOT_UNDERSTOOD",
      "A lista de eventos não informou o tipo de evento.",
    );
  }
  if (plan.scope.status === "live" || plan.scope.status === "upcoming") {
    throw new AnalysisPipelineError(
      "UNSUPPORTED_CAPABILITY",
      "A Phase 4B executa listas de eventos de partidas concluídas; eventos ao vivo ficam no executor live.",
    );
  }
  const team = await source.resolveTeam(plan.entity.name);
  const scope = { ...plan.scope, status: "finished" as const };
  const fixturesRead = await source.listTeamFixtures(team, scope);
  const requestedMatches = plan.scope.last_matches;
  const requestedEvents = plan.scope.limit;
  const selected = requestedMatches
    ? selectFixtures(fixturesRead.fixtures, requestedMatches, "finished")
    : selectFixtures(fixturesRead.fixtures, EVENT_HISTORY_LIMIT, "finished");
  if (requestedMatches && selected.length < requestedMatches) {
    throw new AnalysisPipelineError(
      "DATA_INSUFFICIENT",
      `${source.name} encontrou ${selected.length} de ${requestedMatches} partidas concluídas para o filtro solicitado. Nenhuma partida de outro filtro foi usada para completar a amostra.`,
    );
  }

  const reads = await mapWithConcurrency(selected, EVENT_CONCURRENCY, async (fixture) => {
    const incidentRead = await source.getFixtureIncidents(fixture);
    const enriched =
      plan.event_type === "goal" || plan.event_type === "assist"
        ? await source.enrichGoalEvents(fixture, incidentRead.incidents)
        : { incidents: incidentRead.incidents, meta: null };
    return { fixture, incidentRead, enriched };
  });

  const events = reads
    .flatMap(({ fixture, enriched }) =>
      enriched.incidents
        .map((incident) => incidentToTeamEvent(incident, fixture, team, plan.event_type!))
        .filter((event): event is TeamFootballEvent => event !== null),
    )
    .filter((event) => eventWithinHalf(event, plan.scope.half))
    .sort((a, b) => b.timestamp - a.timestamp || (b.periodSecond ?? 0) - (a.periodSecond ?? 0));
  const limited = requestedEvents ? events.slice(0, requestedEvents) : events;
  if (requestedEvents && limited.length < requestedEvents) {
    throw new AnalysisPipelineError(
      "DATA_INSUFFICIENT",
      `Foram comprovados ${limited.length} de ${requestedEvents} eventos solicitados no histórico consultado. O servidor não completou a lista com evento estimado ou inventado.`,
    );
  }

  const metadata = combineMeta([
    fixturesRead.meta,
    ...reads.flatMap(({ incidentRead, enriched }) =>
      enriched.meta ? [incidentRead.meta, enriched.meta] : [incidentRead.meta],
    ),
  ]);
  const missing = limited.filter(
    (event) =>
      event.minute === null ||
      (["goal", "assist", "yellow_card", "red_card", "substitution", "penalty"].includes(
        event.eventType,
      ) &&
        !event.actor?.name),
  ).length;
  const intent = universalIntent({
    plan,
    team,
    count: requestedMatches ?? selected.length,
    status: "finished",
  }) as TeamEventListAnalysisResult["intent"];
  const cacheKey = `v4b|${source.name}|${team.id}|${queryPlanSignature(plan)}`;

  return {
    result_type: "event_list",
    id: `${cacheKey}-${Date.now()}`,
    cache_key: cacheKey,
    question: params.question,
    created_at: new Date().toISOString(),
    intent,
    team: { id: String(team.id), name: team.name },
    events: limited.map((event) => ({
      event_key: event.eventKey,
      fixture_id: String(event.fixtureId),
      event_type: event.eventType,
      date: event.date,
      opponent: event.opponentName,
      competition: event.competition,
      venue: event.venue,
      result: event.result,
      minute: event.minute,
      extra_time: event.extraTime,
      period_second: event.periodSecond,
      player_id:
        event.actor?.id === null || event.actor?.id === undefined ? null : String(event.actor.id),
      player_name: event.actor?.name ?? null,
      secondary_player_id:
        event.secondaryActor?.id === null || event.secondaryActor?.id === undefined
          ? null
          : String(event.secondaryActor.id),
      secondary_player_name: event.secondaryActor?.name ?? null,
      detail: event.detail,
      rescinded: event.rescinded,
      situation: event.situation,
      body_part: event.bodyPart,
      xg: event.xg,
      xg_estimated: event.xgEstimated,
      source: event.source,
    })),
    related: eventRelatedQuestions(plan.event_type, team.name),
    source: { provider: source.name, updated_at: metadata.fetchedAt, missing },
    provenance: {
      provider: source.name,
      source_endpoint: metadata.endpoint,
      data_family: metadata.family,
      fetched_at: metadata.fetchedAt,
      cache_status: metadata.cacheStatus,
      sample_size: selected.length,
      missing_values: missing,
      resolved_entity_ids: [String(team.id)],
      competition: plan.scope.competition ?? null,
      season: plan.scope.season ?? null,
    },
    demo: false,
  };
}

async function analyzeMatchList(params: {
  question: string;
  plan: QueryPlan;
  source: UniversalFootballSource;
}): Promise<MatchListAnalysisResult> {
  const { plan, source } = params;
  const team = await source.resolveTeam(plan.entity.name);
  const status = plan.query_kind === "schedule" ? "upcoming" : (plan.scope.status ?? "finished");
  if (status === "live") {
    throw new AnalysisPipelineError(
      "UNSUPPORTED_CAPABILITY",
      "Status ao vivo é executado pela capability live_status, não por match_list nesta fase.",
    );
  }
  const count = matchCount(plan);
  const fixturesRead = await source.listTeamFixtures(team, { ...plan.scope, status });
  const matches = selectFixtures(fixturesRead.fixtures, count, status);
  if ((plan.scope.last_matches || plan.scope.limit) && matches.length < count) {
    throw new AnalysisPipelineError(
      "DATA_INSUFFICIENT",
      `${source.name} encontrou ${matches.length} de ${count} partidas para o filtro solicitado. Nenhuma partida incompatível foi usada para completar a lista.`,
    );
  }
  if (matches.length === 0) {
    throw new AnalysisPipelineError(
      "DATA_INSUFFICIENT",
      `Nenhuma partida ${status === "upcoming" ? "futura" : "concluída"} foi encontrada para os filtros solicitados.`,
    );
  }
  const summaries = matches.map((fixture) => ({
    ...resultForTeam(fixture, team),
    source: source.name,
  }));
  const missing =
    status === "finished"
      ? matches.filter((fixture) => fixture.goals.home === null || fixture.goals.away === null)
          .length
      : 0;
  const intent = universalIntent({
    plan,
    team,
    count: matches.length,
    status,
  }) as MatchListAnalysisResult["intent"];
  const cacheKey = `v4b|${source.name}|${team.id}|${queryPlanSignature(plan)}`;
  return {
    result_type: "match_list",
    id: `${cacheKey}-${Date.now()}`,
    cache_key: cacheKey,
    question: params.question,
    created_at: new Date().toISOString(),
    intent,
    team: { id: String(team.id), name: team.name },
    matches: summaries,
    related:
      status === "upcoming"
        ? [
            `Quais foram os últimos 5 jogos do ${team.name}?`,
            `Quais próximos jogos do ${team.name} são em casa?`,
          ]
        : [
            `Quem fez gol do ${team.name} nos últimos 5 jogos?`,
            `Qual é o próximo jogo do ${team.name}?`,
          ],
    source: { provider: source.name, updated_at: fixturesRead.meta.fetchedAt, missing },
    provenance: {
      provider: source.name,
      source_endpoint: fixturesRead.meta.endpoint,
      data_family: fixturesRead.meta.dataFamily,
      fetched_at: fixturesRead.meta.fetchedAt,
      cache_status: fixturesRead.meta.cacheStatus,
      sample_size: matches.length,
      missing_values: missing,
      resolved_entity_ids: [String(team.id)],
      competition: plan.scope.competition ?? null,
      season: plan.scope.season ?? null,
    },
    demo: false,
  };
}

function h2hOutcome(fixture: ProviderFixture, primary: ResolvedTeam): "a" | "b" | "draw" | null {
  const primaryHome = fixture.home.id === primary.id;
  const primaryGoals = primaryHome ? fixture.goals.home : fixture.goals.away;
  const otherGoals = primaryHome ? fixture.goals.away : fixture.goals.home;
  if (primaryGoals === null || otherGoals === null) return null;
  if (primaryGoals === otherGoals) return "draw";
  return primaryGoals > otherGoals ? "a" : "b";
}

async function h2hMetricValues(params: {
  source: UniversalFootballSource;
  fixtures: readonly ProviderFixture[];
  primary: ResolvedTeam;
  metric: QueryPlan["metric"];
}): Promise<(number | null)[]> {
  const { metric } = params;
  if (!metric) return [];
  if (metric === "both_teams_scored") {
    return params.fixtures.map((fixture) =>
      fixture.goals.home === null || fixture.goals.away === null
        ? null
        : fixture.goals.home > 0 && fixture.goals.away > 0
          ? 1
          : 0,
    );
  }
  if (["wins", "draws", "losses"].includes(metric)) {
    return params.fixtures.map((fixture) => {
      const outcome = h2hOutcome(fixture, params.primary);
      if (outcome === null) return null;
      if (metric === "wins") return outcome === "a" ? 1 : 0;
      if (metric === "draws") return outcome === "draw" ? 1 : 0;
      return outcome === "b" ? 1 : 0;
    });
  }
  if (["goals_for", "goals_against", "goal_difference"].includes(metric)) {
    return params.fixtures.map((fixture) => {
      const primaryHome = fixture.home.id === params.primary.id;
      const goalsFor = primaryHome ? fixture.goals.home : fixture.goals.away;
      const goalsAgainst = primaryHome ? fixture.goals.away : fixture.goals.home;
      if (goalsFor === null || goalsAgainst === null) return null;
      if (metric === "goals_for") return goalsFor;
      if (metric === "goals_against") return goalsAgainst;
      return goalsFor - goalsAgainst;
    });
  }
  const legacyMetric =
    metric === "corners" || metric === "cards" || metric === "shots" || metric === "shots_on_target"
      ? metric
      : null;
  if (!legacyMetric) {
    throw new AnalysisPipelineError(
      "UNSUPPORTED_CAPABILITY",
      `A métrica ${metric} está no catálogo universal, mas ainda não possui execução H2H determinística na Phase 4B.`,
    );
  }
  return mapWithConcurrency(params.fixtures, EVENT_CONCURRENCY, (fixture) =>
    params.source.getFixtureMetric(fixture, params.primary.id, legacyMetric),
  );
}

async function analyzeHeadToHead(params: {
  question: string;
  plan: QueryPlan;
  source: UniversalFootballSource;
}): Promise<HeadToHeadAnalysisResult> {
  const { plan, source } = params;
  if (!plan.compare_with || plan.compare_with.type !== "team") {
    throw new AnalysisPipelineError(
      "QUESTION_NOT_UNDERSTOOD",
      "Head-to-head exige dois times resolvidos de forma conservadora.",
    );
  }
  const [primary, compare] = await Promise.all([
    source.resolveTeam(plan.entity.name),
    source.resolveTeam(plan.compare_with.name),
  ]);
  if (primary.id === compare.id) {
    throw new AnalysisPipelineError(
      "QUESTION_NOT_UNDERSTOOD",
      "Head-to-head exige dois times diferentes.",
    );
  }
  const count = matchCount(plan);
  const fixturesRead = await source.listTeamFixtures(primary, {
    ...plan.scope,
    status: "finished",
    opponent: undefined,
  });
  const meetings = fixturesRead.fixtures
    .filter(
      (fixture) =>
        (fixture.home.id === primary.id && fixture.away.id === compare.id) ||
        (fixture.away.id === primary.id && fixture.home.id === compare.id),
    )
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-count);
  if (meetings.length < count) {
    throw new AnalysisPipelineError(
      "DATA_INSUFFICIENT",
      `${source.name} encontrou ${meetings.length} de ${count} confrontos diretos solicitados. Nenhum adversário diferente foi usado para completar a amostra.`,
    );
  }

  let teamAWins = 0;
  let draws = 0;
  let teamBWins = 0;
  let teamAGoals = 0;
  let teamBGoals = 0;
  let bothScored = 0;
  let scoreMissing = 0;
  for (const fixture of meetings) {
    const primaryHome = fixture.home.id === primary.id;
    const aGoals = primaryHome ? fixture.goals.home : fixture.goals.away;
    const bGoals = primaryHome ? fixture.goals.away : fixture.goals.home;
    if (aGoals === null || bGoals === null) {
      scoreMissing += 1;
      continue;
    }
    teamAGoals += aGoals;
    teamBGoals += bGoals;
    if (aGoals > bGoals) teamAWins += 1;
    else if (aGoals < bGoals) teamBWins += 1;
    else draws += 1;
    if (aGoals > 0 && bGoals > 0) bothScored += 1;
  }
  if (scoreMissing > 0 && !plan.metric) {
    throw new AnalysisPipelineError(
      "DATA_INSUFFICIENT",
      `${scoreMissing} de ${meetings.length} confrontos concluídos não possuem placar conhecido. O resumo H2H não foi completado artificialmente.`,
    );
  }

  const metricValues = await h2hMetricValues({
    source,
    fixtures: meetings,
    primary,
    metric: plan.metric,
  });
  let requestedValue: number | null = null;
  let metricMissing = 0;
  let metricSample = 0;
  if (plan.metric) {
    const aggregation = plan.aggregation ?? "total";
    if (
      (aggregation === "percentage" || aggregation === "rate") &&
      plan.metric !== "both_teams_scored"
    ) {
      throw new AnalysisPipelineError(
        "UNSUPPORTED_CAPABILITY",
        `${aggregation} exige um denominador semântico explícito; esta métrica H2H ainda não define um nesta fase.`,
      );
    }
    if (
      plan.metric === "both_teams_scored" &&
      (aggregation === "percentage" || aggregation === "rate")
    ) {
      const numerator = metricValues.some((value) => value === null)
        ? null
        : metricValues
            .filter((value): value is number => value !== null)
            .reduce((sum, value) => sum + value, 0);
      const aggregate = aggregateRatio(numerator, meetings.length, aggregation);
      requestedValue = aggregate.value;
      metricMissing = metricValues.filter((value) => value === null).length;
      metricSample = metricValues.length - metricMissing;
    } else if (plan.metric === "both_teams_scored" && aggregation === "count") {
      metricMissing = metricValues.filter((value) => value === null).length;
      metricSample = metricValues.length - metricMissing;
      requestedValue =
        metricMissing === 0
          ? metricValues
              .filter((value): value is number => value !== null)
              .reduce((sum, value) => sum + value, 0)
          : null;
    } else {
      const aggregate = aggregateNumericValues(
        metricValues,
        aggregation as "total" | "average" | "median" | "minimum" | "maximum" | "count",
      );
      requestedValue = aggregate.value;
      metricMissing = aggregate.coverage.missing;
      metricSample = aggregate.coverage.known;
    }
    if (requestedValue === null) {
      throw new AnalysisPipelineError(
        "DATA_INSUFFICIENT",
        `${metricSample} de ${meetings.length} confrontos possuem a métrica ${plan.metric}. A agregação solicitada exige cobertura completa e não foi estimada.`,
      );
    }
  }

  const summaries = meetings.map((fixture) => ({
    ...resultForTeam(fixture, primary),
    source: source.name,
  }));
  const cacheKey = `v4b|${source.name}|${primary.id}|${compare.id}|${queryPlanSignature(plan)}`;
  const intent = universalIntent({
    plan,
    team: primary,
    compare,
    count: meetings.length,
    status: "finished",
  }) as HeadToHeadAnalysisResult["intent"];
  const knownScores = meetings.length - scoreMissing;
  return {
    result_type: "head_to_head",
    id: `${cacheKey}-${Date.now()}`,
    cache_key: cacheKey,
    question: params.question,
    created_at: new Date().toISOString(),
    intent,
    teams: {
      primary: { id: String(primary.id), name: primary.name },
      compare: { id: String(compare.id), name: compare.name },
    },
    summary: {
      meetings: meetings.length,
      team_a_wins: teamAWins,
      draws,
      team_b_wins: teamBWins,
      team_a_goals: teamAGoals,
      team_b_goals: teamBGoals,
      both_teams_scored: bothScored,
      average_total_goals:
        knownScores > 0 ? Math.round(((teamAGoals + teamBGoals) / knownScores) * 100) / 100 : null,
      requested_metric: plan.metric ?? null,
      requested_aggregation: plan.aggregation ?? null,
      requested_value: requestedValue,
      metric_sample_size: plan.metric ? metricSample : knownScores,
      metric_missing_values: plan.metric ? metricMissing : scoreMissing,
    },
    meetings: summaries,
    related: [
      `Quem ganhou mais nos últimos 10 confrontos entre ${primary.name} e ${compare.name}?`,
      `Qual a média de gols do ${primary.name} contra o ${compare.name}?`,
      `Qual a média de escanteios do ${primary.name} contra o ${compare.name}?`,
    ],
    source: {
      provider: source.name,
      updated_at: fixturesRead.meta.fetchedAt,
      missing: plan.metric ? metricMissing : scoreMissing,
    },
    provenance: {
      provider: source.name,
      source_endpoint:
        plan.metric && ["corners", "cards", "shots", "shots_on_target"].includes(plan.metric)
          ? `${fixturesRead.meta.endpoint} + fixture statistics`
          : fixturesRead.meta.endpoint,
      data_family: plan.metric
        ? `${fixturesRead.meta.dataFamily} + head_to_head_metrics`
        : fixturesRead.meta.dataFamily,
      fetched_at: fixturesRead.meta.fetchedAt,
      cache_status: fixturesRead.meta.cacheStatus,
      sample_size: meetings.length,
      missing_values: plan.metric ? metricMissing : scoreMissing,
      resolved_entity_ids: [String(primary.id), String(compare.id)],
      competition: plan.scope.competition ?? null,
      season: plan.scope.season ?? null,
    },
    demo: false,
  };
}

export function isPhase4bUniversalPlan(plan: QueryPlan): boolean {
  return (
    plan.entity.type === "team" &&
    ["event_list", "match_list", "schedule", "head_to_head"].includes(plan.query_kind)
  );
}

export async function analyzeUniversalQueryPlanWithSources(params: {
  question: string;
  plan: QueryPlan;
  overrides?: AnalysisOverrides;
  observer?: SportsCacheObserver;
  sources: readonly UniversalFootballSource[];
}): Promise<TeamEventListAnalysisResult | MatchListAnalysisResult | HeadToHeadAnalysisResult> {
  const plan = applyUniversalOverrides(params.plan, params.overrides);
  return firstSuccessful(params.sources, async (source) => {
    if (plan.query_kind === "event_list") {
      return analyzeTeamEvents({ question: params.question, plan, source });
    }
    if (plan.query_kind === "match_list" || plan.query_kind === "schedule") {
      return analyzeMatchList({ question: params.question, plan, source });
    }
    if (plan.query_kind === "head_to_head") {
      return analyzeHeadToHead({ question: params.question, plan, source });
    }
    throw new AnalysisPipelineError(
      "UNSUPPORTED_CAPABILITY",
      `A capability ${plan.entity.type}/${plan.query_kind} ainda não pertence ao executor Phase 4B.`,
    );
  });
}

export async function analyzeUniversalQueryPlan(params: {
  question: string;
  plan: QueryPlan;
  overrides?: AnalysisOverrides;
  observer?: SportsCacheObserver;
}): Promise<TeamEventListAnalysisResult | MatchListAnalysisResult | HeadToHeadAnalysisResult> {
  return analyzeUniversalQueryPlanWithSources({
    ...params,
    sources: createUniversalFootballSources(params.observer),
  });
}

export type UniversalResultQueryKind = "event_list" | "match_list" | "schedule" | "head_to_head";
export type UniversalEventType =
  | "goal"
  | "assist"
  | "yellow_card"
  | "red_card"
  | "substitution"
  | "var"
  | "penalty";

export interface UniversalAnalysisIntent {
  sport: "football";
  query_kind: UniversalResultQueryKind;
  entity_type: "team" | "player";
  entity_name: string;
  entity_id: string;
  compare_with?: { entity_name: string; entity_id: string } | null;
  event_type?: UniversalEventType;
  metric?: string | null;
  aggregation?: string | null;
  match_count: number;
  competition: string | null;
  venue: "all" | "home" | "away";
  status: "finished" | "live" | "upcoming";
}

export interface AnalysisProvenance {
  provider: string;
  source_endpoint: string;
  data_family: string;
  fetched_at: string;
  cache_status: "hit" | "miss" | "mixed" | "disabled" | "unknown";
  sample_size: number;
  missing_values: number;
  resolved_entity_ids: string[];
  competition: string | null;
  season: string | null;
  providers_attempted?: string[];
  fallback_occurred?: boolean;
  data_families?: string[];
  coverage?: {
    fixtures: number;
    supported: string[];
    observed: Record<string, number>;
    missing: Record<string, number>;
  } | null;
  resolved_competition_id?: string | null;
  resolved_season_id?: string | null;
  resolved_season_label?: string | null;
}

export interface TeamAnalysisEvent {
  event_key: string;
  fixture_id: string;
  event_type: UniversalEventType;
  date: string;
  opponent: string;
  competition: string;
  venue: "home" | "away";
  result: string;
  minute: number | null;
  extra_time: number | null;
  period_second: number | null;
  player_id: string | null;
  player_name: string | null;
  secondary_player_id: string | null;
  secondary_player_name: string | null;
  detail: string | null;
  rescinded: boolean;
  situation: string | null;
  body_part: string | null;
  xg: number | null;
  xg_estimated: boolean | null;
  source: string;
}

export interface TeamEventListAnalysisResult {
  result_type: "event_list";
  id: string;
  cache_key: string;
  question: string;
  created_at: string;
  intent: UniversalAnalysisIntent & { query_kind: "event_list"; entity_type: "team"; event_type: UniversalEventType };
  team: { id: string; name: string };
  events: TeamAnalysisEvent[];
  related: string[];
  source: { provider: string; updated_at: string; missing: number };
  provenance: AnalysisProvenance;
  demo: false;
}

export interface AnalysisFixtureSummary {
  fixture_id: string;
  date: string;
  status: string;
  competition: string;
  home_team: { id: string; name: string };
  away_team: { id: string; name: string };
  home_goals: number | null;
  away_goals: number | null;
  opponent: string;
  venue: "home" | "away";
  result: string;
  outcome: "V" | "E" | "D" | null;
  source: string;
  metric?: { key: string; value: number; unit: string; observed: true } | null;
}

export interface MatchListAnalysisResult {
  result_type: "match_list";
  id: string;
  cache_key: string;
  question: string;
  created_at: string;
  intent: UniversalAnalysisIntent & { query_kind: "match_list" | "schedule" };
  team: { id: string; name: string };
  player?: { id: string; name: string };
  matches: AnalysisFixtureSummary[];
  related: string[];
  source: { provider: string; updated_at: string; missing: number };
  provenance: AnalysisProvenance;
  demo: false;
}

export interface HeadToHeadSummary {
  meetings: number;
  team_a_wins: number;
  draws: number;
  team_b_wins: number;
  team_a_goals: number;
  team_b_goals: number;
  both_teams_scored: number;
  average_total_goals: number | null;
  requested_metric: string | null;
  requested_aggregation: string | null;
  requested_value: number | null;
  metric_sample_size: number;
  metric_missing_values: number;
}

export interface HeadToHeadAnalysisResult {
  result_type: "head_to_head";
  id: string;
  cache_key: string;
  question: string;
  created_at: string;
  intent: UniversalAnalysisIntent & { query_kind: "head_to_head"; entity_type: "team" };
  teams: {
    primary: { id: string; name: string };
    compare: { id: string; name: string };
  };
  summary: HeadToHeadSummary;
  meetings: AnalysisFixtureSummary[];
  related: string[];
  source: { provider: string; updated_at: string; missing: number };
  provenance: AnalysisProvenance;
  demo: false;
}

export type UniversalAnalysisResult =
  | TeamEventListAnalysisResult
  | MatchListAnalysisResult
  | HeadToHeadAnalysisResult;

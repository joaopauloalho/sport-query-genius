export type ApiFootballErrorKind = "account" | "auth" | "limit" | "plan" | "parameter" | "provider";

function serializeApiErrors(errors: unknown): string {
  try {
    return JSON.stringify(errors).toLowerCase();
  } catch {
    return String(errors).toLowerCase();
  }
}

function hasErrorValue(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length > 0;
  return true;
}

export function getApiFootballErrorPayload(payload: unknown): unknown | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;

  for (const key of ["errors", "error", "message"] as const) {
    if (hasErrorValue(record[key])) return record[key];
  }

  return null;
}

export function classifyApiFootballError(errors: unknown): ApiFootballErrorKind {
  const serialized = serializeApiErrors(errors);

  if (/suspend|suspended|disabled|inactive|deactivat|blocked/.test(serialized)) {
    return "account";
  }
  if (/request|limit|rate|quota|too many/.test(serialized)) return "limit";
  if (/plan|upgrade|paid|subscription|subscribe|entitlement/.test(serialized)) return "plan";
  if (/token|api.?key|authentication|unauthorized|forbidden|access denied/.test(serialized)) {
    return "auth";
  }
  if (/parameter|required|invalid|field/.test(serialized)) return "parameter";
  return "provider";
}

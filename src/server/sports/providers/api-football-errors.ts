export type ApiFootballErrorKind =
  | "account"
  | "auth"
  | "limit"
  | "plan"
  | "parameter"
  | "provider";

function serializeApiErrors(errors: unknown): string {
  try {
    return JSON.stringify(errors).toLowerCase();
  } catch {
    return String(errors).toLowerCase();
  }
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

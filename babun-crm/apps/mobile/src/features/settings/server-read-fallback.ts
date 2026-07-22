export interface ServerReadError {
  code?: string;
  message?: string;
  details?: string;
}

/**
 * Only transport failures may use a tenant-scoped read cache. PostgreSQL,
 * PostgREST, validation and RLS errors must stay visible.
 */
export function isConfirmedNetworkUnavailable(
  error: ServerReadError,
): boolean {
  if (error.code === "NETWORK_ERROR") return true;
  const text = `${error.message ?? ""} ${error.details ?? ""}`;
  return /(?:network request failed|failed to fetch|fetch failed|internet connection appears to be offline|network connection was lost)/i.test(
    text,
  );
}

/** Calendar settings existed before the native role split, while the safe
 * operational RPC is introduced by a forward-only migration. During that
 * rolling window only an actually missing table/function may use the cache;
 * RLS and validation failures must remain visible. */
export function isMissingCalendarSettingsContract(
  error: ServerReadError,
): boolean {
  if (
    error.code === "42P01" ||
    error.code === "42883" ||
    error.code === "PGRST202" ||
    error.code === "PGRST205"
  ) {
    return true;
  }
  const text = `${error.message ?? ""} ${error.details ?? ""}`;
  return /could not find (?:the table|the function).*(?:calendar_settings|read_operational_calendar_settings_safe)|relation ["']?calendar_settings["']? does not exist|function .*read_operational_calendar_settings_safe.*does not exist/i.test(
    text,
  );
}

/** SMS templates moved from the legacy tenant blob behind two narrow RPCs.
 * During a rolling deploy the read cache may bridge an actually missing RPC,
 * but permission, validation and database failures must remain visible. */
export function isMissingSmsTemplatesContract(
  error: ServerReadError,
): boolean {
  if (error.code === "42883" || error.code === "PGRST202") return true;
  const text = `${error.message ?? ""} ${error.details ?? ""}`;
  return /could not find the function.*(?:read|write)_sms_templates_safe|function .*?(?:read|write)_sms_templates_safe.*does not exist/i.test(
    text,
  );
}

function isMissingTableContract(
  error: ServerReadError,
  tableName: string,
): boolean {
  if (error.code === "42P01" || error.code === "PGRST205") return true;
  const text = `${error.message ?? ""} ${error.details ?? ""}`;
  return new RegExp(
    `could not find the table.*${tableName}|relation ["']?${tableName}["']? does not exist`,
    "i",
  ).test(text);
}

export function isMissingLoyaltySettingsContract(
  error: ServerReadError,
): boolean {
  return isMissingTableContract(error, "tenant_loyalty_settings");
}

export function isMissingPersonalEventTypesContract(
  error: ServerReadError,
): boolean {
  return isMissingTableContract(error, "personal_event_types");
}

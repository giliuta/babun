// Ответ `create_company` — лист без зависимостей: его читают хук и тест.

export interface CreatedCompany {
  tenantId: string;
  teamId: string;
  trial: boolean;
}

/** Ответ `create_company` — без доверия к форме. */
export function createdCompanyFrom(data: unknown): CreatedCompany {
  const row = (data ?? {}) as { tenant_id?: unknown; team_id?: unknown; trial?: unknown };
  if (typeof row.tenant_id !== "string" || typeof row.team_id !== "string") {
    throw new Error("Не удалось создать компанию");
  }
  return { tenantId: row.tenant_id, teamId: row.team_id, trial: row.trial === true };
}

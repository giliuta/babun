import {
  effectiveVatSettings,
  type VatMode,
  type VatOverride,
  type VatSettings,
} from "@babun/shared/local/finance/vat";

// ЧТО ГОВОРИТ СТРОКА НДС СЧЁТА — чистой функцией, одной на оба режима листа
// счёта: создание и правку.
//
// Разбор багов счетов 2026-09-15: пока настройки НДС грузились (холодный старт,
// нет сети, ошибка), страница счёта утверждала «Компания не работает с НДС» —
// `undefined` читался как «выключено». Незагруженное — не ответ, и говорить за
// компанию до ответа нельзя. Вторая дыра: у команды со ставкой 0% подпись
// обещала «НДС включён в цену · 0%», а сервер при нулевой ставке налог не пишет
// вовсе (`fill_transaction_vat`).

export const VAT_ZERO_RATE_HINT = "Ставка команды 0% — налог не начисляется";

export type AccountVatView =
  | { kind: "loading" }
  | { kind: "failed" }
  | { kind: "company-off" }
  | { kind: "switch"; value: boolean; hint: string | undefined };

export function accountVatView(input: {
  company: { data: VatSettings | undefined; failed: boolean };
  overrides: {
    data: readonly (VatOverride & { teamId: string })[] | undefined;
    failed: boolean;
  };
  /** Команда счёта; `null` — наследовать нечего, кроме компании. */
  teamId: string | null;
  accountMode: VatMode | "on" | null | undefined;
  /** Подпись действующего налога («НДС включён в цену · 19%»). */
  summary: (v: VatSettings) => string;
}): AccountVatView {
  const { company, overrides, teamId } = input;
  if (!company.data) return { kind: company.failed ? "failed" : "loading" };
  if (company.data.mode === "off" || company.data.rate <= 0) {
    return { kind: "company-off" };
  }
  // Счёт команды наследует её режим и ставку — без переопределений ответ был бы
  // ответом компании, то есть мог соврать.
  if (teamId && !overrides.data) {
    return { kind: overrides.failed ? "failed" : "loading" };
  }
  const effective = effectiveVatSettings(
    company.data,
    teamId ? overrides.data?.find((o) => o.teamId === teamId) : undefined,
    input.accountMode,
  );
  const value = effective.mode !== "off";
  return {
    kind: "switch",
    value,
    hint: !value
      ? undefined
      : effective.rate > 0
        ? input.summary(effective)
        : VAT_ZERO_RATE_HINT,
  };
}

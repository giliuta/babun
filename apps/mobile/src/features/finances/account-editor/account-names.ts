import type { Account } from "@babun/shared/local/finance/account";

// ДУБЛЬ ИМЕНИ СЧЁТА — чистой функцией, без листа.
//
// Жило внутри листа создания и не имело ни одного теста, хотя это единственная
// преграда между человеком и двумя «Кассами» одной команды: две такие строки
// неразличимы и в операции, и в переводе, деньги оседают не на том счёте.
// Границы совпадают с уникальными индексами базы (`ux_accounts_team_name`,
// `ux_accounts_company_name`), а проверка идёт ДО отправки (аудит счетов
// 2026-09-10): база отвечала отказом уже после круга по сети.

/** Латиница → кириллица по звучанию: в проде у одной команды уже живёт
 *  «Kasa», а рядом заводят «Кассу». */
const TRANSLIT: Record<string, string> = {
  a: "а", b: "б", c: "к", d: "д", e: "е", f: "ф", g: "г", h: "х", i: "и",
  j: "й", k: "к", l: "л", m: "м", n: "н", o: "о", p: "п", q: "к", r: "р",
  s: "с", t: "т", u: "у", v: "в", w: "в", x: "кс", y: "у", z: "з",
};

/** Ключ сравнения имён. Регистр, раскладка и сдвоенные буквы («Kasa» ↔
 *  «Касса») не должны рождать два счёта, которые потом не различить. */
export function nameKey(name: string): string {
  let out = "";
  for (const ch of name.trim().toLowerCase()) out += TRANSLIT[ch] ?? ch;
  return out.replace(/(.)\1+/g, "$1");
}

export type NamedAccount = Pick<Account, "name" | "brigade_id" | "is_active">;

/** Счёт той же команды с тем же именем — В ТОМ ЧИСЛЕ ЗАКРЫТЫЙ: имя остаётся
 *  за ним, и база не даст завести второй. Пустое имя дублем не бывает. */
export function findDuplicateName<A extends NamedAccount>(
  accounts: readonly A[],
  name: string,
  teamId: string | null,
): A | null {
  const key = nameKey(name);
  if (!key) return null;
  return (
    accounts.find((a) => a.brigade_id === teamId && nameKey(a.name) === key) ??
    null
  );
}

/** Что сказать о дубле под полем имени. У закрытого счёта — куда идти: его
 *  можно открыть снова, а не только придумывать другое имя. */
export function duplicateNameNote(
  duplicate: NamedAccount | null,
  teamName: string | null,
): string | null {
  if (!duplicate) return null;
  if (!duplicate.is_active) {
    return `Счёт «${duplicate.name}» с таким названием закрыт, но имя осталось за ним. Откройте его снова или назовите новый иначе.`;
  }
  const owner = teamName ? `У команды «${teamName}»` : "У вас";
  return `${owner} уже есть счёт «${duplicate.name}». Два счёта с одним названием потом не различить — дайте новому другое имя.`;
}

import { formatCountRu } from "@babun/shared/common/utils/plural-ru";

// «ВО ВСЕХ КОМАНДАХ» — ПОВТОРНОЕ НАЖАТИЕ БЕЗОПАСНО.
//
// Категории по командам заводятся по одной, и обрыв связи посреди цикла
// оставляет часть команд с категорией, а часть без. Повтор обязан дозавести
// недостающее, а не задвоить уже созданное: перед вставкой команды, у которых
// такая категория (тот же вид и то же имя) уже есть, пропускаются.

interface CategoryLike {
  team_id: string | null;
  type: string;
  name: string;
}

/** Имя для сравнения: регистр и пробелы по краям — не отличие. */
const nameOf = (name: string): string => name.trim().toLowerCase();

/** Команды из `teamIds`, у которых категории `name` вида `kind` ещё нет. */
export function teamsMissingCategory(
  existing: readonly CategoryLike[],
  teamIds: readonly string[],
  kind: string,
  name: string,
): string[] {
  const key = nameOf(name);
  const have = new Set(
    existing
      .filter((category) => category.type === kind && nameOf(category.name) === key)
      .map((category) => category.team_id),
  );
  return teamIds.filter((teamId) => !have.has(teamId));
}

/** «в 1 команде», «в 2 командах», «в 5 командах». */
const IN_TEAMS: [string, string, string] = ["команде", "командах", "командах"];

/** Итог цикла: `null` — всё прошло гладко и сказать нечего (одна команда, или
 *  каждой завели новую). Иначе — честные цифры: сколько создано, у скольких
 *  категория уже была, на чём оборвалось. */
export function fanoutSummary(r: {
  created: number;
  skipped: number;
  total: number;
  failed: boolean;
}): { title: string; message: string } | null {
  const created = formatCountRu(r.created, IN_TEAMS);
  const skipped = formatCountRu(r.skipped, IN_TEAMS);
  if (r.failed) {
    const left = r.total - r.skipped - r.created;
    return {
      title: "Создано не везде",
      message:
        `Категория создана в ${created}, ещё ${left} не получилось.`
        + " Нажмите «Создать категорию» ещё раз — созданное не задвоится.",
    };
  }
  if (r.skipped > 0) {
    return r.created > 0
      ? { title: "Категория создана", message: `Создана в ${created}; в ${skipped} она уже была.` }
      : { title: "Категория уже есть", message: "Во всех командах она уже была — ничего нового не создано." };
  }
  return null;
}

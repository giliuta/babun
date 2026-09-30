import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { QueryClient } from "@tanstack/react-query";

import {
  knownTenantsForSwitch,
  sweepQueryCacheOnSwitch,
} from "./switch-cache-sweep";

const here = dirname(fileURLToPath(import.meta.url));
const read = (path: string): string => readFileSync(resolve(here, path), "utf8");

// ЧТО ИМЕННО ЗДЕСЬ ДОКАЗЫВАЕТСЯ, И ЧЕГО ЗДЕСЬ НЕ ДОКАЗЫВАЕТСЯ.
//
// Владелец жаловался, что переход между компаниями «очень долго открывается».
// Причина была в том, что чистка выбрасывала данные, уже лежавшие на
// устройстве, и экран заново ждал сеть.
//
// Проверить это глазами ЧЕСТНО НЕ ВЫШЛО НИ У КОГО. Снимок экрана через
// несколько секунд после тапа не отличает тёплый кэш от быстрой сети: и там и
// там на картинке записи. Сессия 005 сначала подтвердила починку таким снимком
// и сама же своё подтверждение сняла — семи секунд хватало, чтобы успела
// ответить сеть. Мой круг на симуляторе страдал тем же.
//
// Поэтому здесь проверяется МЕХАНИЗМ, а не время: пережили ли чистку записи в
// кэше запросов. Это ровно та величина, которая ломалась, и она измеряется
// однозначно. Скорость на глаз остаётся наблюдением, а не доказательством.
const AIRFIX = "2bc7907e-b149-44a9-92ff-a5e73403031c";
const GILIUTA = "11365a87-bef9-4f6c-a030-b15083fe646b";

/** НАСТОЯЩАЯ чистка перехода, а не её копия. Раньше здесь стояли строки,
 *  повторённые из `wipeFastStores` «дословно», — и сторожили они копию: верни
 *  в `auth-clear.ts` пометку «протухло» на весь кэш, копия бы не заметила.
 *  Теперь `auth-clear.ts` зовёт лист `switch-cache-sweep.ts`, и тест зовёт
 *  его же. */
function sweepOnSwitch(qc: QueryClient, knownTenantIds: string[]): void {
  sweepQueryCacheOnSwitch(qc, knownTenantIds);
}

function seedBothCompanies(): QueryClient {
  const qc = new QueryClient();
  qc.setQueryData(["appointments", AIRFIX, "owner"], ["запись AirFix"]);
  qc.setQueryData(["appointments", GILIUTA, "master"], ["запись Giliuta"]);
  qc.setQueryData(["teams", AIRFIX, "owner"], ["Y&D"]);
  qc.setQueryData(["teams", GILIUTA, "master"], ["Команда 1"]);
  // Ключ БЕЗ компании: такой мог бы показать карточку клиента прежней фирмы.
  qc.setQueryData(["client", "c-1"], { name: "Клиент прежней компании" });
  // Лента календарей — одна на все компании и единственный переключатель.
  qc.setQueryData(["my-calendars", "user-1"], ["Y&D", "Команда 1"]);
  return qc;
}

describe("переход не выбрасывает скачанное", () => {
  test("КРУГ A → B → A: обе компании остаются тёплыми", () => {
    const qc = seedBothCompanies();
    const known = [AIRFIX, GILIUTA];

    // Уходим в Giliuta.
    sweepOnSwitch(qc, known);
    assert.deepEqual(
      qc.getQueryData(["appointments", GILIUTA, "master"]),
      ["запись Giliuta"],
      "компания назначения обязана остаться тёплой",
    );
    assert.deepEqual(
      qc.getQueryData(["appointments", AIRFIX, "owner"]),
      ["запись AirFix"],
      "ПОКИДАЕМАЯ компания тоже: иначе обратный путь снова холодный",
    );

    // Возвращаемся в AirFix.
    sweepOnSwitch(qc, known);
    assert.deepEqual(
      qc.getQueryData(["appointments", AIRFIX, "owner"]),
      ["запись AirFix"],
      "на возврате записи обязаны быть на месте — это и была жалоба владельца",
    );
    assert.deepEqual(qc.getQueryData(["teams", AIRFIX, "owner"]), ["Y&D"]);
  });

  test("РЕГРЕССИЯ, КОТОРАЯ УЖЕ БЫЛА: беречь только компанию назначения — мало", () => {
    // Первая версия правки передавала ОДНУ компанию, и именно это оставляло
    // обратный путь холодным. Тест держит границу: если список снова сузят до
    // назначения, здесь станет видно.
    const qc = seedBothCompanies();
    sweepOnSwitch(qc, [GILIUTA]);
    assert.equal(
      qc.getQueryData(["appointments", AIRFIX, "owner"]),
      undefined,
      "так вело себя сломанное поведение — тест описывает его, а не требует",
    );

    const fixed = seedBothCompanies();
    sweepOnSwitch(fixed, [GILIUTA, AIRFIX]);
    assert.deepEqual(
      fixed.getQueryData(["appointments", AIRFIX, "owner"]),
      ["запись AirFix"],
    );
  });

  test("ЛЕНТА КАЛЕНДАРЕЙ переживает переход: это единственная дверь обратно", () => {
    const qc = seedBothCompanies();
    sweepOnSwitch(qc, [AIRFIX, GILIUTA]);
    assert.deepEqual(
      qc.getQueryData(["my-calendars", "user-1"]),
      ["Y&D", "Команда 1"],
      "без ленты ряд чипов пуст до ответа сети, а без сети вернуться нечем",
    );
  });

  test("запрос, не называющий ни одной моей компании, сносится", () => {
    const qc = seedBothCompanies();
    sweepOnSwitch(qc, [AIRFIX, GILIUTA]);
    assert.equal(
      qc.getQueryData(["client", "c-1"]),
      undefined,
      "ключ без компании мог бы показать клиента прежней фирмы",
    );
  });

  test("чужая компания в списке не делает чужие данные видимыми", () => {
    // Сторож смысла: беречь — не значит показывать. Ключ с ЧУЖОЙ компанией
    // переживёт чистку, но прочитать его сможет только запрос с тем же
    // ключом, то есть та же компания. Проверяем, что ключи не слипаются.
    const qc = seedBothCompanies();
    sweepOnSwitch(qc, [AIRFIX, GILIUTA]);
    assert.notDeepEqual(
      qc.getQueryData(["appointments", AIRFIX, "owner"]),
      qc.getQueryData(["appointments", GILIUTA, "master"]),
    );
  });
});

const queryState = (qc: QueryClient, queryKey: readonly unknown[]) =>
  qc.getQueryCache().find({ queryKey, exact: true })?.state;

describe("переход не снимает свежесть (владелец 2026-09-15: «загружается с задержкой»)", () => {
  // Пометка «протухло» на весь кэш делала каждый смонтированный экран залпом в
  // сеть: 17–20 запросов в очереди бесплатного плана по 3–5 с. Верни её в
  // чистку — эти тесты упадут.
  test("ключи компаний после чистки НЕ протухшие: первый кадр рисуется из памяти", () => {
    const qc = seedBothCompanies();
    sweepOnSwitch(qc, [AIRFIX, GILIUTA]);
    for (const key of [
      ["appointments", GILIUTA, "master"],
      ["teams", GILIUTA, "master"],
      ["appointments", AIRFIX, "owner"],
    ]) {
      const state = queryState(qc, key);
      assert.equal(state?.isInvalidated, false, `${key.join("/")} помечен протухшим`);
    }
    const query = qc
      .getQueryCache()
      .find({ queryKey: ["appointments", GILIUTA, "master"], exact: true });
    assert.equal(query?.isStaleByTime(60_000), false);
  });

  test("РОЛЬ, положенная ДО чистки, переживает её свежей — без крутилки прав", () => {
    const qc = seedBothCompanies();
    qc.setQueryData(["current-role", GILIUTA], "master");
    sweepOnSwitch(qc, [AIRFIX, GILIUTA]);
    assert.equal(qc.getQueryData(["current-role", GILIUTA]), "master");
    assert.equal(queryState(qc, ["current-role", GILIUTA])?.isInvalidated, false);
  });

  test("ДВОЙНЫЕ ЧИПЫ: лента календарей перечитывается, а не донашивается", () => {
    // Флаг «активная» в ленте считается от заголовка. Не перечитай её — и в
    // ряду свои календари новой компании дважды, а покидаемой нет.
    const qc = seedBothCompanies();
    sweepOnSwitch(qc, [AIRFIX, GILIUTA]);
    assert.equal(queryState(qc, ["my-calendars", "user-1"])?.isInvalidated, true);
  });
});

describe("компании человека для чистки — из ленты в памяти", () => {
  test("все компании ленты плюс обе стороны перехода, без повторов", () => {
    assert.deepEqual(
      knownTenantsForSwitch({
        target: GILIUTA,
        leaving: AIRFIX,
        calendars: [{ tenantId: AIRFIX }, { tenantId: GILIUTA }, { tenantId: "t-3" }],
      }).sort(),
      [AIRFIX, GILIUTA, "t-3"].sort(),
    );
  });

  test("ленты нет — хватает двух компаний перехода", () => {
    assert.deepEqual(
      knownTenantsForSwitch({ target: GILIUTA, leaving: AIRFIX, calendars: undefined }),
      [GILIUTA, AIRFIX],
    );
    assert.deepEqual(
      knownTenantsForSwitch({ target: GILIUTA, leaving: null, calendars: undefined }),
      [GILIUTA],
    );
  });
});

describe("проводка перехода в коде", () => {
  test("auth-clear зовёт настоящую чистку и не метит протухшим весь кэш", () => {
    // Комментарии вырезаются: разбор над чисткой называет снятый вызов по
    // имени, и сторож обязан смотреть на код, а не на его историю.
    const authClear = read("auth-clear.ts").replace(/^\s*\/\/.*$/gm, "");
    assert.match(authClear, /sweepQueryCacheOnSwitch\(queryClient, knownTenantIds\)/);
    assert.doesNotMatch(
      authClear,
      /invalidateQueries\(\s*\{\s*refetchType/,
      "пометка «протухло» на весь кэш вернула залп запросов после перехода",
    );
  });

  test("ПОРЯДОК: выбор календаря, роль и фаза дообновления — до смены компании; getSession нет", () => {
    const switching = read("../features/settings/switch-tenant.ts");
    const setActive = switching.indexOf("setActiveTenantId(userId, tenantId)");
    assert.notEqual(setActive, -1);
    for (const before of [
      "writeTenantPref(CALENDAR_VIEW_PREF, tenantId, { teamId: opts.viewTeamId })",
      "queryClient.setQueryData(currentRoleQueryKey(tenantId), opts.role)",
      "beginSwitchRevalidation(tenantId, knownTenantIds)",
    ]) {
      const at = switching.indexOf(before);
      assert.notEqual(at, -1, `нет строки ${before}`);
      assert.ok(at < setActive, `${before} стоит после смены компании`);
    }
    assert.doesNotMatch(
      switching,
      /\.getSession\(/,
      "getSession на пути перехода — асинхронный шаг между тапом и сменой компании",
    );
  });

  test("выбор календаря пишется в той же форме, что читает календарь", () => {
    const switching = read("../features/settings/switch-tenant.ts");
    const calendar = read("../../app/(dashboard)/(home)/index.tsx");
    assert.match(switching, /const CALENDAR_VIEW_PREF = "calendar\.view";/);
    assert.match(
      calendar,
      /readTenantPref<\{ teamId\?: string \| null \}>\("calendar\.view", tenantId\)/,
    );
    assert.match(calendar, /writeTenantPref\("calendar\.view", tenantId, \{\s*teamId:/);
  });

  test("лента не зовёт onPickOwn замыканием тапа — оно знает покидаемую компанию", () => {
    const workspaces = read("../features/settings/workspaces.ts");
    assert.equal(
      workspaces.split("opts.onPickOwn(").length - 1,
      1,
      "onPickOwn из замыкания тапа записал бы выбор под компанию, из которой уходим",
    );
    assert.match(workspaces, /optsRef\.current\.onPickOwn\(arrival\.teamId\)/);
    assert.match(workspaces, /viewTeamId: teamId/);
  });

  test("полоса загрузки молчит, пока идёт тихое дообновление", () => {
    const calendar = read("../../app/(dashboard)/(home)/index.tsx");
    assert.match(
      calendar,
      /<LoadingBar\s+visible=\{isRefetching && !pull\.refreshing && !silentRevalidating\}/,
    );
    // Подпиской, а не чтением модуля в рендере: конец очереди экран не
    // перерисовал бы, и настоящее перечитывание, начатое в ней, шло бы без полосы.
    assert.match(calendar, /const silentRevalidating = useSilentRevalidating\(\);/);
    const revalidate = read("./switch-revalidate.ts");
    assert.match(
      revalidate,
      /useSyncExternalStore\(\s*subscribeSwitchRevalidation,\s*isSilentRevalidating/,
    );
  });
});

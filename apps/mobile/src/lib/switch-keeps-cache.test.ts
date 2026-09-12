import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { QueryClient } from "@tanstack/react-query";

import { querySurvivesSwitch } from "./tenant-query-keys";

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

/** Та же строка, что стоит в `wipeFastStores`. Повторена дословно: сама
 *  функция тянет supabase, уведомления и MMKV, которым в юнит-тесте делать
 *  нечего, а предикат импортируется настоящий. */
function sweepOnSwitch(qc: QueryClient, knownTenantIds: string[]): void {
  qc.removeQueries({
    predicate: (q) => !querySurvivesSwitch(q.queryKey, knownTenantIds),
  });
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

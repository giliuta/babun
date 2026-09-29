import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  blankDraft,
  draftPayload,
  draftProblem,
  emptyFieldsWarning,
  fromReady,
  READY_TEMPLATES,
  parseTeamTemplates,
  uniqueByBody,
  usesWindow,
  whenWords,
  windowWords,
  withTrigger,
  type TemplateDraft,
} from "./sms-team-templates";

const ready = (patch: Partial<TemplateDraft>): TemplateDraft => ({
  ...blankDraft("t1"),
  name: "Напоминание",
  body: "[Имя], завтра в [Время]",
  ...patch,
});

describe("шаблоны SMS команды", () => {
  test("ответ базы разбирается, мусор отбрасывается", () => {
    const list = parseTeamTemplates([
      {
        id: "a",
        team_id: "t1",
        name: "Накануне",
        body: "[Имя], завтра",
        trigger: "day_before",
        hours: null,
        at_time: "18:00",
        months: null,
        send_from: 8,
        send_to: 21,
        enabled: false,
        position: 1,
      },
      { id: "b", team_id: "t1", body: "x", trigger: "что-то" },
      { team_id: "t1", body: "без id" },
      null,
    ]);
    assert.equal(list.length, 2);
    assert.equal(list[0].atTime, "18:00");
    assert.equal(list[0].enabled, false);
    assert.equal(list[1].trigger, "manual");
    assert.equal(list[1].name, "Шаблон");
    assert.equal(list[1].sendFrom, 8);
  });

  test("«когда» одной строкой", () => {
    const w = (p: Partial<TemplateDraft>) => whenWords({ trigger: "manual", hours: null, atTime: null, months: null, ...p });
    assert.equal(w({}), "Только вручную");
    assert.equal(w({ trigger: "created" }), "Сразу после записи");
    assert.equal(w({ trigger: "before", hours: 24 }), "За сутки до визита");
    assert.equal(w({ trigger: "before", hours: 48 }), "За 2 дня до визита");
    assert.equal(w({ trigger: "before", hours: 3 }), "За 3 часа до визита");
    assert.equal(w({ trigger: "day_before", atTime: "18:00" }), "Накануне в 18:00");
    assert.equal(w({ trigger: "after", hours: 2 }), "Через 2 часа после визита");
    assert.equal(w({ trigger: "repeat", months: 6 }), "Через 6 месяцев после визита");
    assert.equal(w({ trigger: "cancelled" }), "При отмене записи");
  });

  test("окно отправки словами и где оно действует", () => {
    assert.equal(windowWords(8, 21), "с 08:00 до 21:00");
    assert.equal(windowWords(0, 24), "Круглосуточно");
    assert.equal(windowWords(9, 24), "с 09:00 до 24:00");
    assert.equal(usesWindow("created"), true);
    assert.equal(usesWindow("before"), true);
    assert.equal(usesWindow("day_before"), false);
    assert.equal(usesWindow("manual"), false);
  });

  test("смена «когда» ставит ходовой срок и чистит чужой", () => {
    const before = withTrigger(ready({}), "before");
    assert.equal(before.hours, 24);
    const dayBefore = withTrigger(before, "day_before");
    assert.deepEqual([dayBefore.hours, dayBefore.atTime, dayBefore.months], [null, "18:00", null]);
    assert.equal(withTrigger(dayBefore, "after").hours, 2);
    assert.equal(withTrigger(dayBefore, "repeat").months, 6);
    const kept = withTrigger(ready({ trigger: "before", hours: 3 }), "before");
    assert.equal(kept.hours, 3);
  });

  test("черновик проверяется так же, как база", () => {
    assert.equal(draftProblem(ready({})), null);
    assert.equal(draftProblem(ready({ name: "  " })), "Назовите шаблон");
    assert.equal(draftProblem(ready({ body: "" })), "Напишите текст");
    assert.equal(draftProblem(ready({ trigger: "before", hours: null })), "Выберите, за сколько до визита");
    assert.equal(draftProblem(ready({ trigger: "before", hours: 200 })), "Выберите, за сколько до визита");
    assert.equal(draftProblem(ready({ trigger: "day_before", atTime: "25:00" })), "Выберите время накануне");
    assert.equal(draftProblem(ready({ trigger: "repeat", months: 0 })), "Выберите, через сколько месяцев");
    assert.equal(draftProblem(ready({ sendFrom: 21, sendTo: 8 })), "Окно отправки: «с» раньше, чем «до»");
  });

  test("в базу уходит только срок выбранного «когда»", () => {
    const payload = draftPayload(ready({ trigger: "day_before", atTime: "18:00", hours: 24, months: 3 }));
    assert.deepEqual(
      [payload.hours, payload.at_time, payload.months, payload.team_id, "id" in payload],
      [null, "18:00", null, "t1", false],
    );
    assert.equal(draftPayload(ready({ id: "x" })).id, "x");
  });

  test("предупреждение о полях, которых у записи может не быть", () => {
    assert.equal(emptyFieldsWarning("[Имя], завтра в [Время]"), null);
    assert.equal(emptyFieldsWarning("Адрес: [Адрес]"), "Если у записи нет адреса, SMS не уйдёт");
    assert.equal(
      emptyFieldsWarning("[Услуга] по [Адрес], [Цена]"),
      "Если у записи нет услуги, адреса или цены, SMS не уйдёт",
    );
    assert.equal(emptyFieldsWarning("[Address]"), "Если у записи нет адреса, SMS не уйдёт");
  });

  test("одинаковые тексты двух команд — одна строка", () => {
    const list = uniqueByBody([{ body: "A" }, { body: " A " }, { body: "B" }, { body: "" }]);
    assert.deepEqual(list.map((x) => x.body), ["A", "B"]);
  });

  test("готовые шаблоны сохраняются как есть и уходят каждому", () => {
    for (const ready of READY_TEMPLATES) {
      const draft = fromReady(blankDraft("t1"), ready);
      assert.equal(draftProblem(draft), null, ready.name);
      assert.equal(emptyFieldsWarning(draft.body), null, ready.name);
    }
    const soon = fromReady(blankDraft("t1"), READY_TEMPLATES.find((x) => x.name === "За 2 часа")!);
    assert.deepEqual([soon.trigger, soon.hours], ["before", 2]);
  });
});

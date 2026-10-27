import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  FOREIGN_PREFIX,
  applyCalendarOrder,
  calendarChipName,
  calendarOrderKey,
  composeCalendarChips,
  type ChipSourceCalendar,
} from "./calendar-chips";

// Чужой чип узнаётся по адресу (`@компания:команда`), а не по виду: с 1.10
// команды партнёра рисуются так же, как свои.
const foreign = (chip: { id: string } | undefined) => !!chip?.id.startsWith(FOREIGN_PREFIX);

const AIRFIX = "2bc7907e-b149-44a9-92ff-a5e73403031c";
const GILIUTA = "11365a87-bef9-4f6c-a030-b15083fe646b";

const yd = (isActive: boolean): ChipSourceCalendar => ({
  tenantId: AIRFIX, tenantName: "AirFix LTD", teamId: "team-yd",
  teamName: "Y&D", teamColor: null, isActive,
});
const k1 = (isActive: boolean): ChipSourceCalendar => ({
  tenantId: GILIUTA, tenantName: "Giliuta", teamId: "team-k1",
  teamName: "Команда 1", teamColor: null, isActive,
});
const names = (chips: { name: string }[]) => chips.map((c) => c.name);

describe("лента календарей — состав от компании устройства", () => {
  // Ровно кадр, который видела соседняя сессия: человек вернулся в AirFix, а
  // список ещё прежний и считает активной Giliuta. По флагу сервера ряд вышел
  // «Y&D, Y&D» без «Команды 1».
  test("возврат с устаревшим флагом: ни дубля, ни пропажи", () => {
    const chips = composeCalendarChips({
      own: [{ id: "team-yd", name: "Y&D" }],
      myCalendars: [yd(false), k1(true)],
      activeTenantId: AIRFIX,
    });
    assert.deepEqual(names(chips), ["Y&D", "Команда 1"]);
    assert.equal(foreign(chips.find((c) => c.name === "Y&D")), false);
    assert.equal(foreign(chips.find((c) => c.name === "Команда 1")), true);
  });

  test("уход с устаревшим флагом — зеркально", () => {
    const chips = composeCalendarChips({
      own: [{ id: "team-k1", name: "Команда 1" }],
      myCalendars: [yd(true), k1(false)],
      activeTenantId: GILIUTA,
    });
    assert.deepEqual(names(chips), ["Y&D", "Команда 1"]);
    assert.equal(foreign(chips.find((c) => c.name === "Y&D")), true);
    assert.equal(foreign(chips.find((c) => c.name === "Команда 1")), false);
  });

  test("порядок один и тот же, где бы человек ни стоял", () => {
    const inAirfix = composeCalendarChips({
      own: [{ id: "team-yd", name: "Y&D" }],
      myCalendars: [yd(true), k1(false)],
      activeTenantId: AIRFIX,
    });
    const inGiliuta = composeCalendarChips({
      own: [{ id: "team-k1", name: "Команда 1" }],
      myCalendars: [yd(false), k1(true)],
      activeTenantId: GILIUTA,
    });
    assert.deepEqual(names(inAirfix), names(inGiliuta));
  });

  test("компания устройства ещё неизвестна — берётся флаг, а не «всё чужое»", () => {
    const chips = composeCalendarChips({
      own: [{ id: "team-yd", name: "Y&D" }],
      myCalendars: [yd(true), k1(false)],
      activeTenantId: null,
    });
    assert.deepEqual(names(chips), ["Y&D", "Команда 1"]);
  });
});

describe("порядок человека (владелец 11.10: «менять местами календари»)", () => {
  const chips = [
    { id: "t1", name: "Личный" },
    { id: "t2", name: "Y&D" },
    { id: "@B:x", name: "Чужая" },
  ];

  test("ключ одинаков по обе стороны перехода", () => {
    assert.equal(calendarOrderKey("t1", "A"), "A:t1");
    assert.equal(calendarOrderKey("@B:x", "A"), "B:x");
    assert.equal(calendarOrderKey("t1", null), null);
  });

  test("названные — в его порядке, новые — следом в заводском", () => {
    const out = applyCalendarOrder(chips, "A", ["B:x", "A:t2"]);
    assert.deepEqual(out.map((c) => c.name), ["Чужая", "Y&D", "Личный"]);
  });

  test("порядка нет или компания не известна — заводской", () => {
    assert.deepEqual(applyCalendarOrder(chips, "A", null), chips);
    assert.deepEqual(applyCalendarOrder(chips, null, ["B:x"]), chips);
  });

  test("composeCalendarChips держит порядок и после перехода в другой аккаунт", () => {
    const myCalendars = [
      { tenantId: "A", tenantName: "Мой", teamId: "t1", teamName: "Личный", teamColor: null, isActive: true },
      { tenantId: "B", tenantName: "Брат", teamId: "x", teamName: "Чужая", teamColor: null, isActive: false },
    ];
    const order = ["B:x", "A:t1"];
    const inA = composeCalendarChips({ own: [{ id: "t1", name: "Личный" }], myCalendars, activeTenantId: "A", order });
    const inB = composeCalendarChips({ own: [{ id: "x", name: "Чужая" }], myCalendars, activeTenantId: "B", order });
    assert.deepEqual(inA.map((c) => c.name), ["Чужая", "Личный"]);
    assert.deepEqual(inB.map((c) => c.name), ["Чужая", "Личный"]);
  });
});

// Календарь, названный почтой, в узком чипе обрезался в «babun.app+r…».
describe("подпись календаря, названного почтой", () => {
  const me = { email: "babun.app+review@gmail.com", name: "Анна" };

  test("свой — именем из профиля", () => {
    assert.equal(calendarChipName("babun.app+review@gmail.com", me), "Анна");
  });

  test("почта сверяется без регистра и пробелов", () => {
    assert.equal(calendarChipName(" Babun.App+Review@Gmail.com ", me), "Анна");
  });

  test("без имени в профиле — «Личный»", () => {
    assert.equal(calendarChipName("babun.app+review@gmail.com", { email: me.email }), "Личный");
  });

  test("чужая почта — «Личный», а не моё имя", () => {
    assert.equal(calendarChipName("other@mail.com", me), "Личный");
  });

  test("обычное имя не меняется", () => {
    assert.equal(calendarChipName("Y&D", me), "Y&D");
    assert.equal(calendarChipName("Команда @ Лимассол", me), "Команда @ Лимассол");
  });

  test("лента подписывает и свой, и чужой чип", () => {
    const chips = composeCalendarChips({
      own: [{ id: "team-p", name: "babun.app+review@gmail.com" }],
      myCalendars: [
        { tenantId: AIRFIX, tenantName: "AirFix LTD", teamId: "team-p",
          teamName: "babun.app+review@gmail.com", teamColor: null, isActive: true },
        { ...k1(false), teamName: "dima@airfix.cy" },
      ],
      activeTenantId: AIRFIX,
      viewer: me,
    });
    assert.deepEqual(names(chips), ["Анна", "Личный"]);
  });
});

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  createTierDraft,
  displayValue,
  draftValue,
  economicsDraftFromService,
  nextDuration,
  parseDurationTiers,
  parsePriceTiers,
  validateServiceEconomics,
} from "./economics";
import { costPerUnit } from "@babun/shared/local/services";

describe("service tier compatibility", () => {
  test("reads current and legacy JSON while ignoring malformed rows", () => {
    assert.deepEqual(
      parsePriceTiers(
        JSON.stringify([
          { min_quantity: "3", unit_price: "9,5" },
          { min_qty: 2, price_per_unit: 12 },
          { min_qty: 1, price_per_unit: 1 },
          { min_qty: 4, price_per_unit: -1 },
          null,
        ]),
      ),
      [
        { min_qty: 2, price_per_unit: 12 },
        { min_qty: 3, price_per_unit: 9.5 },
      ],
    );
    assert.deepEqual(
      parseDurationTiers([
        { threshold: 5, total_duration: 120 },
        { min_qty: 3, total_duration_minutes: "90" },
        { min_qty: 3, duration_minutes: 80 },
        { min_qty: 4, duration_minutes: 12.5 },
      ]),
      [
        { min_qty: 3, duration_minutes: 80 },
        { min_qty: 5, duration_minutes: 120 },
      ],
    );
    assert.deepEqual(parsePriceTiers("not-json"), []);
    assert.deepEqual(parseDurationTiers({ broken: true }), []);
  });

  test("migrates a valid legacy bulk pair into the editor", () => {
    const draft = economicsDraftFromService({
      bulk_threshold: 4,
      bulk_price: 25,
      price_tiers: null,
      duration_tiers: null,
    });
    assert.deepEqual(
      draft.tiers.map(({ minQuantity, rowPrice, totalDuration }) => ({
        minQuantity,
        rowPrice,
        totalDuration,
      })),
      // ЗА ВСЁ, А НЕ ЗА ШТУКУ: 25 за единицу при пороге 4 человек видит как
      // «100» — то же число, названное так, как он его диктует.
      [{ minQuantity: "4", rowPrice: "100", totalDuration: "" }],
    );
  });
});

describe("сумма за строку ходит туда и обратно без потерь", () => {
  test("«100 за три» возвращается ровно сотней, а не 99,99", () => {
    // Круг, ради которого вся правка и затевалась: клининговой компании «3
    // комнаты стоит 100» неудобно вписывать как 33.33.
    const typed = {
      tiers: [
        {
          id: "three",
          minQuantity: "3",
          rowPrice: "100",
          rowCost: "0",
          totalDuration: "",
        },
      ],
    };
    const saved = validateServiceEconomics(typed).value;
    assert.ok(saved);
    // В базу уехало за одну — с полным хвостом, без округления до копеек:
    // округли здесь, и обратный путь дал бы 99,99.
    assert.equal(saved.price_tiers?.[0]?.min_qty, 3);
    assert.ok(Math.abs((saved.price_tiers?.[0]?.price_per_unit ?? 0) - 100 / 3) < 1e-12);

    const reopened = economicsDraftFromService({
      price_tiers: saved.price_tiers,
      duration_tiers: null,
    });
    assert.equal(reopened.tiers[0]?.rowPrice, "100");
  });

  test("правка количества не двигает напечатанную сумму", () => {
    // Человек вписал «100 за три» и передумал: пусть будет за четыре. Сумма,
    // на которую он смотрит, обязана остаться сотней — меняется цена за штуку,
    // а не число на экране.
    const afterQtyEdit = {
      tiers: [
        {
          id: "row",
          minQuantity: "4",
          rowPrice: "100",
          rowCost: "0",
          totalDuration: "",
        },
      ],
    };
    const saved = validateServiceEconomics(afterQtyEdit).value;
    assert.equal(saved?.price_tiers?.[0]?.price_per_unit, 25);
  });
});

describe("расход ступени — за одну, туда и обратно (аудит шестерёнки 03.10)", () => {
  test("ступень «от 3 · €10 за одну» открывается десяткой и сохраняется десяткой", () => {
    const draft = economicsDraftFromService({
      price_tiers: [{ min_qty: 3, price_per_unit: 40 }],
      duration_tiers: null,
      cost_tiers: [{ min_qty: 3, cost_per_unit: 10 }],
    });
    assert.equal(draft.tiers[0]?.rowCost, "10");
    const untouched = validateServiceEconomics(draft).value;
    assert.equal(untouched?.cost_tiers?.[0]?.cost_per_unit, 10);

    // Набрали 12 «за одну» — в базу уходит 12, а не 4.
    const typed = validateServiceEconomics({
      ...draft,
      tiers: draft.tiers.map((tier) => ({ ...tier, rowCost: "12" })),
    }).value;
    assert.equal(typed?.cost_tiers?.[0]?.cost_per_unit, 12);
  });

  test("новая ступень берёт расход базы за одну, а не половину", () => {
    const saved = validateServiceEconomics({
      tiers: [
        { id: "n", minQuantity: "2", rowPrice: "90", rowCost: "5", totalDuration: "" },
      ],
    }).value;
    assert.equal(saved?.cost_tiers?.[0]?.cost_per_unit, 5);
  });
});

describe("нулевой расход ступени — явный ноль, а не «как выше»", () => {
  test("набранный 0 сохраняется ступенью и обнуляет расход на этом количестве", () => {
    const saved = validateServiceEconomics({
      tiers: [
        { id: "a", minQuantity: "3", rowPrice: "120", rowCost: "0", totalDuration: "" },
      ],
    }).value;
    assert.deepEqual(saved?.cost_tiers, [{ min_qty: 3, cost_per_unit: 0 }]);
    const service = {
      cost_per_unit: 5,
      cost_tiers: saved?.cost_tiers,
      price_tiers: saved?.price_tiers,
    };
    assert.equal(costPerUnit(service, 3), 0);
    assert.equal(costPerUnit(service, 2), 5);
    assert.equal(economicsDraftFromService(service).tiers[0]?.rowCost, "0");
  });

  test("ступень без своего расхода открывается действующим расходом, а не нулём", () => {
    // Иначе лист показал бы «0», а пересохранение без единой правки
    // записало бы ноль вместо унаследованного расхода.
    const service = {
      cost_per_unit: 5,
      cost_tiers: [],
      price_tiers: [{ min_qty: 3, price_per_unit: 40 }],
    };
    const draft = economicsDraftFromService(service);
    assert.equal(draft.tiers[0]?.rowCost, "5");
    const resaved = validateServiceEconomics(draft).value;
    assert.equal(
      costPerUnit({ ...service, cost_tiers: resaved?.cost_tiers }, 3),
      costPerUnit(service, 3),
    );
  });

  test("стёртый расход ступени — «как выше», ступень расхода не пишется", () => {
    const saved = validateServiceEconomics({
      tiers: [
        { id: "a", minQuantity: "3", rowPrice: "120", rowCost: "", totalDuration: "" },
      ],
    }).value;
    assert.deepEqual(saved?.cost_tiers, []);
  });
});

describe("service economics validation", () => {
  test("rejects duplicate thresholds, negative values, and empty tiers", () => {
    const result = validateServiceEconomics({
      tiers: [
        {
          id: "a",
          minQuantity: "1",
          rowPrice: "-3",
          rowCost: "0",
          totalDuration: "12.5",
        },
        {
          id: "b",
          minQuantity: "3",
          rowPrice: "",
          rowCost: "0",
          totalDuration: "",
        },
        {
          id: "c",
          minQuantity: "3",
          rowPrice: "8",
          rowCost: "0",
          totalDuration: "90",
        },
      ],
    });

    assert.equal(result.value, null);
    assert.ok(result.errors.tiers.a?.minQuantity);
    assert.ok(result.errors.tiers.a?.rowPrice);
    assert.ok(result.errors.tiers.a?.totalDuration);
    assert.ok(result.errors.tiers.b?.row);
    assert.equal(result.errors.tiers.b?.minQuantity, "Такое количество уже есть");
    assert.equal(result.errors.tiers.c?.minQuantity, "Такое количество уже есть");
  });

  test("sorts tiers and keeps independent price and duration ladders", () => {
    const result = validateServiceEconomics({
      tiers: [
        {
          id: "five",
          minQuantity: "5",
          rowPrice: "40",
          rowCost: "",
          totalDuration: "",
        },
        {
          id: "three",
          minQuantity: "3",
          rowPrice: "",
          rowCost: "",
          totalDuration: "90",
        },
      ],
    });

    // ЗЕРКАЛО ОПТА — ЯВНЫЙ НОЛЬ, а не копия первой цены: иначе убранная
    // лестница воскресала из легаси-ветки `rowPrice` при частичном патче.
    assert.deepEqual(result.value, {
      // В базу уезжает ЗА ОДНУ: 40 за пять — это 8 за штуку. Форма хранения
      // не менялась, поменялся только язык, которым спрашивают человека.
      price_tiers: [{ min_qty: 5, price_per_unit: 8 }],
      duration_tiers: [{ min_qty: 3, duration_minutes: 90 }],
      cost_tiers: [],
      bulk_threshold: 0,
      bulk_price: 0,
    });
  });
});

describe("линза «за всё ↔ за одну»", () => {
  test("показ делит сумму строки на количество", () => {
    assert.equal(displayValue("135", 3, "unit"), "45");
    assert.equal(displayValue("135", 3, "total"), "135");
  });

  test("первая строка не делится ни в каком режиме", () => {
    assert.equal(displayValue("50", 1, "unit"), "50");
  });

  test("ТУДА И ОБРАТНО БЕЗ ПОТЕРИ КОПЕЙКИ — главное свойство линзы", () => {
    // 100 за три показывается как 33,33; пока человек не напечатал своё,
    // черновик держит точную сотню, и обратно выходит именно она.
    const shown = displayValue("100", 3, "unit");
    assert.equal(shown, "33.33");
    assert.equal(draftValue(shown, 3, "unit"), "99.99");
    // Но черновик не трогали — значит в базу уедет исходное число.
    assert.equal(displayValue("100", 3, "total"), "100");
  });

  test("набранное в режиме «за одну» умножается на количество", () => {
    assert.equal(draftValue("45", 3, "unit"), "135");
    assert.equal(draftValue("45", 3, "total"), "45");
  });

  test("пустое остаётся пустым: пусто — это не ноль", () => {
    assert.equal(displayValue("", 3, "unit"), "");
    assert.equal(draftValue("", 3, "unit"), "");
  });
});


describe("время новой строки продолжает шаг (владелец 11.10)", () => {
  const tier = (totalDuration: string) => ({
    id: totalDuration, minQuantity: "", rowPrice: "", rowCost: "0", totalDuration,
  });
  test("+30 мин, +30 мин → следующая ещё +30", () => {
    assert.equal(nextDuration([tier("60"), tier("90")], 30), 120);
  });
  test("две подряд одинаковые → следующая такая же", () => {
    assert.equal(nextDuration([tier("60"), tier("60")], 30), 60);
  });
  test("строка одна → её время, без умножения", () => {
    assert.equal(nextDuration([], 45), 45);
  });
  test("первая ступень после базы: шаг от базы", () => {
    assert.equal(nextDuration([tier("50")], 30), 70);
  });
  test("убывающий шаг не уводит ниже нуля", () => {
    assert.equal(nextDuration([tier("10")], 60), 0);
  });
  test("createTierDraft берёт это время", () => {
    assert.equal(createTierDraft([tier("60"), tier("90")], 30).totalDuration, "120");
  });
});

test("барабан времени у строки посередине не уносит лист вниз (11.10)", async () => {
  const { dirname, resolve } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const { readModuleSource } = await import("@/lib/module-source");
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readModuleSource(resolve(here, "ServiceSheet.tsx"), resolve(here, "service-sheet"));
  assert.match(src, /const lastId = economics\.tiers\[economics\.tiers\.length - 1\]\?\.id \?\? "base";\s*if \(id && id === lastId\) \{/);
  assert.match(src, /if \(id\) Keyboard\.dismiss\(\);/);
});


test("«Убрать» строку количества убирает сразу — без вопроса поверх листа (11.10)", async () => {
  // Вопрос рисуется своим Modal поверх Modal листа услуги — iOS его не
  // показывает, и кнопка молчала. Строка — черновик листа, спрашивать незачем.
  const { dirname, resolve } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const { readModuleSource } = await import("@/lib/module-source");
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readModuleSource(resolve(here, "ServiceLadder.tsx"), resolve(here, "service-ladder"));
  assert.doesNotMatch(src, /confirmThen\(|confirmAction\(|chooseOption\(/);
  assert.match(src, /onAction=\{\(\) => onRemove\(id\)\}/);
});

test("шаблоны новой услуги — значком в шапке ЛИСТА, список и заполнение в том же листе (11.10)", async () => {
  // Значок в самой шторке справа: нажал шаблон — и в этой же шторке
  // появляется вся услуга. Второе окно поверх листа iOS не показывает.
  const { dirname, resolve } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const here = dirname(fileURLToPath(import.meta.url));
  const { readModuleSource } = await import("@/lib/module-source");
  // The route is a door; the price list lives in `price-list/`.
  const page = readModuleSource(resolve(here, "../../../app/(dashboard)/cabinet/services.tsx"), resolve(here, "price-list"));
  assert.match(page, /const isOwner = useDataRole\(\)\.data === "owner";/);
  assert.match(page, /if \(!isOwner \|\| !activeTeamId\) return \[\];/);
  assert.match(page, /templates=\{readOnly \? undefined : templates\}/);
  assert.doesNotMatch(page, /CopyPlus|chooseOption\(/);
  const sheet = readModuleSource(resolve(here, "ServiceSheet.tsx"), resolve(here, "service-sheet"));
  assert.match(sheet, /const canPickTemplate = !service && \(templates\?\.length \?\? 0\) > 0;/);
  assert.match(sheet, /\{picking \? \(\s*<TemplateList/);
  assert.match(sheet, /<TemplatesHeaderButton picking=\{picking\}/);
  assert.match(sheet, /seedFields\(from, from\.name\);/);
  assert.match(sheet, /\? \{ copied_from_service_id: template\.id \}/);
  assert.doesNotMatch(sheet, /chooseOption\(|confirmThen\(/);
});

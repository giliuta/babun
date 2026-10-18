import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createBlankClient } from "@babun/shared/local/clients";
import { buildBlastSms, buildSequentialSms, bulkBodyFor, bulkProblem } from "./bulk-sms";

// Рассылка знает о каждом получателе только его имя и имя компании. Поля
// записи ([Дата], [Время], [Ссылка]) и долг ей взять неоткуда: вырезанное
// поле давало клиенту «Анна, ждём вас в .». Шаблон с ними рассылка не
// отправляет и говорит почему; [Компания] подставляется.

const anna = createBlankClient({ id: "c1", full_name: "Анна Петрова", phone: "99123456" });
const emoji = createBlankClient({ id: "c2", full_name: "🌸🌸", phone: "99654321" });

describe("текст рассылки", () => {
  test("[Имя] и [Компания] подставляются", () => {
    assert.equal(bulkBodyFor("[Имя], вас ждёт [Компания]", anna, "AirFix"), "Анна, вас ждёт AirFix");
    assert.equal(bulkBodyFor("Скидки от [Company]", anna, "AirFix"), "Скидки от AirFix");
  });

  test("поля записи не вырезаются молча — такой текст не уходит", () => {
    assert.equal(bulkBodyFor("[Имя], ждём вас [Дата] в [Время].", anna, "AirFix"), null);
    assert.equal(bulkProblem("[Имя], ждём вас [Дата] в [Время].", [anna], "AirFix"), "В рассылке есть только [Имя] и [Компания] — уберите другие поля");
    assert.equal(bulkProblem("[Имя], привет от [Компания]", [anna], "AirFix"), null);
  });

  test("имя из одних эмодзи — получатель пропускается, а не «Здравствуйте, !»", () => {
    assert.equal(bulkBodyFor("Здравствуйте, [Имя]!", emoji, null), null);
    const plan = buildSequentialSms("Здравствуйте, [Имя]!", [anna, emoji], null, "ios");
    assert.deepEqual(plan.map((p) => p.client.id), ["c1"]);
  });

  test("всем сразу — с компанией, без полей записи", () => {
    assert.equal(
      buildBlastSms("Скидки от [Компания]", [anna, emoji], "AirFix", "ios")?.url,
      `sms:99123456,99654321&body=${encodeURIComponent("Скидки от AirFix")}`,
    );
    assert.equal(buildBlastSms("Ждём вас [Дата]", [anna], "AirFix", "ios"), null);
  });

  test("длиннее 3 SMS с именами — не отправляется", () => {
    const long = `[Имя], ${"я".repeat(196)}`;
    assert.equal(bulkProblem(long, [createBlankClient({ full_name: "Аня" })], null), null);
    assert.equal(
      bulkProblem(long, [createBlankClient({ full_name: "Александра" })], null),
      "С подставленными именами текст длиннее 3 SMS — сократите его",
    );
  });
});

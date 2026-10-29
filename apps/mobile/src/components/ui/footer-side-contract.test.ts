import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { FOOTER_SIDE } from "./tokens";

// КНОПКА ФУТЕРА — ОДНОЙ ШИРИНЫ НА СТРАНИЦЕ И В ЛИСТЕ (AGENTS 7.1). Пока поля
// задавал каждый футер сам, их было четыре: 14 у записи и клиента, 16 у
// большинства листов, 20 у страниц и десятка листов, 32–36 там, где лист с
// полями добавлял свои. Число одно — `FOOTER_SIDE`, держат его `PageFooter`
// и `SheetFooter`; обёртка футера листа без полей берёт то же число.

const here = dirname(fileURLToPath(import.meta.url));
const mobile = resolve(here, "../../..");
const read = (p: string) => readFileSync(resolve(mobile, p), "utf8");

/** Выражение пропа `footer={…}` целиком — по парности скобок: окно в
 *  N символов цепляло тело листа, а длинный футер в него не помещался. */
function footerProps(s: string): { at: number; body: string }[] {
  const out: { at: number; body: string }[] = [];
  for (const m of s.matchAll(/footer=\{/g)) {
    const from = m.index + m[0].length;
    let depth = 1;
    let i = from;
    for (; i < s.length && depth > 0; i += 1) {
      if (s[i] === "{") depth += 1;
      else if (s[i] === "}") depth -= 1;
    }
    out.push({ at: m.index, body: s.slice(from, i - 1) });
  }
  return out;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(name)) out.push(p);
  }
  return out;
}

// Чужие зоны этой пачки: правятся своими сессиями, сторож о них помнит.
const PENDING = new Set([
  "app/(dashboard)/cabinet/people/index.tsx",
  "src/features/calendar/DayFinanceSheet.tsx",
  "src/features/cabinet/ChangeDetailSheet.tsx",
  "src/features/sms/SmsMessageSheet.tsx",
  "src/features/sms/SmsSendSheet.tsx",
  "src/features/sms/SmsTemplateSheet.tsx",
  "src/features/sms/SmsTermSheet.tsx",
  "src/features/sms/SmsTextField.tsx",
  "src/features/sms/SmsTopupSheet.tsx",
]);

const files = [...walk(resolve(mobile, "src")), ...walk(resolve(mobile, "app"))].map((f) =>
  relative(mobile, f),
);

test("число одно, и его держат оба футера", () => {
  assert.equal(FOOTER_SIDE, 20);
  assert.match(read("src/components/ui/PageFooter.tsx"), /horizontal: FOOTER_SIDE/);
  assert.match(read("src/components/ui/bottom-sheet/SheetFooter.tsx"), /paddingHorizontal: padded \? FOOTER_SIDE : 0/);
  for (const own of ["src/features/clients/ClientScreenFooter.tsx", "src/features/appointments/book-form/BookFooter.tsx"]) {
    assert.match(read(own), /paddingHorizontal: PAGE_FOOTER_PADDING\.horizontal/, own);
  }
});

test("футер листа не заводит свою ширину кнопки", () => {
  const offenders: string[] = [];
  for (const f of files) {
    if (PENDING.has(f)) continue;
    const s = read(f);
    for (const { at, body } of footerProps(s)) {
      // Обёртка футера — первый `View` выражения; глубже — уже содержимое.
      const wrapper = /^[^<]*<View\b[^>]*>/.exec(body)?.[0] ?? "";
      if (/paddingHorizontal: (?:GUTTER|SIDE|1[46]|20)\b|className="px-/.test(wrapper)) {
        offenders.push(`${f}:${s.slice(0, at).split("\n").length}`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test("геометрию PageFooter не копируют руками", () => {
  const offenders = files.filter(
    (f) => !PENDING.has(f) && /paddingHorizontal: 20, paddingTop: 8, paddingBottom: 10\b/.test(read(f)),
  );
  assert.deepEqual(offenders, []);
});

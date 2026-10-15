import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { readModuleSource } from "@/lib/module-source";

// ЛИСТ С ЗАЩИТОЙ ЗАКРЫТИЯ ЗАКРЫВАЕТСЯ И БЕЗ СЕТИ (13.10). `useGuardedClose`
// не закрывает лист, пока идёт запись (`busy` = `isPending`). Запись в режиме
// сети по умолчанию без связи встаёт на ПАУЗУ — `isPending` не гаснет никогда,
// и лист не закрывался ни «Назад», ни тапом мимо, ни свайпом. Записи этих
// листов обязаны падать ошибкой (`NEVER_PAUSE` / `networkMode: "always"`).
// Слой данных — тонкий вход плюс папка того же имени (`sms-account/`,
// `queries/`, `local-settings/`): читаем их одним текстом.
const src = (f: string) => readModuleSource(join(__dirname, "../..", f));

function mutationOf(file: string, head: string): string {
  const text = src(file);
  const start = text.indexOf(head);
  assert.ok(start >= 0, `${file}: нет ${head}`);
  const call = text.indexOf("useMutation({", start);
  return text.slice(call, call + 400);
}

const GUARDED = [
  ["features/sms/sms-account.ts", "export function useSaveTeamTemplate()"],
  ["features/services/queries.ts", "export function useCreateService()"],
  ["features/reference/queries.ts", "export function useCreateCity()"],
  ["features/reference/queries.ts", "function useRefUpdate<"],
  ["features/reference/queries.ts", "function useRefDelete("],
  ["features/settings/local-settings.ts", "export function useSavePersonalEventTypes()"],
] as const;

test("записи листов с защитой закрытия не встают на паузу без сети", () => {
  for (const [file, head] of GUARDED) {
    assert.match(mutationOf(file, head), /\.\.\.NEVER_PAUSE|networkMode: "always"/, `${file} ${head}`);
  }
});

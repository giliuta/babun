import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

// Страница файлов клиента держит фото записей своим запросом
// (`client-visit-photos`, `staleTime` четыре минуты). Добавленное или
// удалённое в записи фото обязано сбросить и его — иначе на странице клиента
// стоит удалённый снимок, а новый не появляется до истечения кэша.

const source = readFileSync(join(__dirname, "appointment-photos.ts"), "utf8");

function settledBody(hook: string): string {
  const start = source.indexOf(`export function ${hook}(`);
  assert.ok(start >= 0, hook);
  const next = source.indexOf("export function ", start + 1);
  const body = source.slice(start, next < 0 ? undefined : next);
  const settled = body.indexOf("onSettled:");
  assert.ok(settled >= 0, `${hook} has onSettled`);
  return body.slice(settled, body.indexOf("meta:", settled));
}

const CLIENT_FILES = /invalidateQueries\(\{ queryKey: \["client-visit-photos", tenantId\] \}\)/;

function helperBody(): string {
  const start = source.indexOf("function settlePhotos(");
  if (start < 0) return "";
  return source.slice(start, source.indexOf("\n}\n", start));
}

describe("appointment photo mutations refresh the client files page", () => {
  for (const hook of ["useUploadAppointmentPhotos", "useDeleteAppointmentPhoto"]) {
    test(hook, () => {
      const settled = settledBody(hook);
      const direct = CLIENT_FILES.test(settled);
      const viaHelper = /settlePhotos\(/.test(settled) && CLIENT_FILES.test(helperBody());
      assert.ok(direct || viaHelper, settled);
    });
  }
});

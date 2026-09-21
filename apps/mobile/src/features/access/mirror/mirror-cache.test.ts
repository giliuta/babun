import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  clientsQueryKey,
  sourceClientQueryKey,
  sourceClientTagsQueryKey,
  sourceClientsQueryKey,
  tenantQueryKey,
} from "@/lib/company-query-keys";
import { isMirrorClientKey } from "./mirror-cache";

// Ключи сюда приходят НЕ руками, а от настоящих билдеров: правило чистки
// однажды уже разошлось с формой ключа — знало список (`["clients", tenantId,
// view]`) и не знало карточку (`["client", id, tenantId, view]`), и каждый
// открытый в зеркале клиент оставался в памяти после выхода.

const TENANT = "tenant-1";
const VIEW = "member:user-7";

describe("что стирать после выхода из зеркала", () => {
  test("список, теги и карточка зеркала — стираются", () => {
    assert.equal(isMirrorClientKey(sourceClientsQueryKey(TENANT, VIEW)), true, "список");
    assert.equal(isMirrorClientKey(sourceClientTagsQueryKey(TENANT, VIEW)), true, "теги");
    assert.equal(
      isMirrorClientKey(sourceClientQueryKey("client-9", TENANT, VIEW)),
      true,
      "карточка",
    );
  });

  test("свои ключи не трогаем", () => {
    assert.equal(isMirrorClientKey(clientsQueryKey(TENANT, "owner")), false);
    assert.equal(isMirrorClientKey(sourceClientsQueryKey(TENANT, "own")), false);
    assert.equal(isMirrorClientKey(sourceClientQueryKey("client-9", TENANT, "own")), false);
    assert.equal(isMirrorClientKey(tenantQueryKey(TENANT, "owner")), false);
    assert.equal(isMirrorClientKey(["appointments", TENANT, "owner"]), false);
  });

  test("похожий, но чужой ключ не стирается", () => {
    // Вид «member:…» на третьем месте у карточки — это id клиента, а не вид.
    assert.equal(isMirrorClientKey(["client", VIEW, TENANT, "own"]), false);
    assert.equal(isMirrorClientKey([]), false);
  });
});

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import * as companyKeys from "@/lib/company-query-keys";
import { clientKeys } from "./query-keys";

// Right-hand sides are the literal arrays the hooks wrote inline before the
// factories existed. Compared as strings: element order and `null` matter.
const T = "2bc7907e-b149-44a9-92ff-a5e73403031c";
const same = (a: readonly unknown[], b: readonly unknown[]) =>
  assert.equal(JSON.stringify(a), JSON.stringify(b));

describe("client query keys keep their shape", () => {
  test("prefixes writes invalidate by", () => {
    same(clientKeys.all(), ["clients"]);
    same(clientKeys.cardAll(), ["client"]);
    same(clientKeys.card("c-1"), ["client", "c-1"]);
    same(clientKeys.tagAll(), ["client-tags"]);
    same(clientKeys.memberAll(), ["client-members"]);
    same(clientKeys.membersOfTenant(T), ["client-members", T]);
    same(clientKeys.membersOfTenant(null), ["client-members", null]);
    same(clientKeys.attachmentAll(), ["client-attachments"]);
    same(clientKeys.trashedAll(), ["trashed-clients"]);
  });

  test("feature-local full keys", () => {
    same(clientKeys.attachments(T, "c-1"), ["client-attachments", T, "c-1"]);
    same(clientKeys.trashed(T, "owner"), ["trashed-clients", T, "owner"]);
    same(clientKeys.trashed(null, "role-pending"), ["trashed-clients", null, "role-pending"]);
  });

  test("prefetched full keys are the shared ones, not copies", () => {
    assert.equal(clientKeys.list, companyKeys.clientsQueryKey);
    assert.equal(clientKeys.sourceList, companyKeys.sourceClientsQueryKey);
    assert.equal(clientKeys.sourceCard, companyKeys.sourceClientQueryKey);
    assert.equal(clientKeys.tags, companyKeys.clientTagsQueryKey);
    assert.equal(clientKeys.sourceTags, companyKeys.sourceClientTagsQueryKey);
  });

  test("every prefix is a prefix of the full key it refreshes", () => {
    const starts = (prefix: readonly unknown[], key: readonly unknown[]) =>
      same(key.slice(0, prefix.length), prefix);
    starts(clientKeys.all(), clientKeys.list(T, "owner"));
    starts(clientKeys.all(), clientKeys.sourceList(T, "member:view"));
    starts(clientKeys.card("c-1"), clientKeys.sourceCard("c-1", T, "owner"));
    starts(clientKeys.cardAll(), clientKeys.sourceCard("c-1", T, "owner"));
    starts(clientKeys.tagAll(), clientKeys.tags(T, "owner"));
    starts(clientKeys.membersOfTenant(T), ["client-members", T, "group-1"]);
    starts(clientKeys.attachmentAll(), clientKeys.attachments(T, "c-1"));
    starts(clientKeys.trashedAll(), clientKeys.trashed(T, "owner"));
  });
});

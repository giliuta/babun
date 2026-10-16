// The offline queue builds its own INSERT row for a client (`makeServerRow`),
// the online path uses `clientToInsert`. A column the offline row forgets is
// lost when the queued create reaches the server, so every column the online
// row can send must also be in the offline one.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createBlankClient } from "../local/clients";
import { clientToInsert } from "../db/repositories/clients";
import { makeServerRow } from "./clientsCached";

describe("offline client row", () => {
  test("carries every column of the online insert", () => {
    const client = createBlankClient({
      id: "00000000-0000-4000-8000-000000000001",
      full_name: "Anna",
      team_id: "00000000-0000-4000-8000-000000000002",
      requisites: [
        {
          id: "r1",
          legal_name: "Anna Ltd",
          vat_number: null,
          reg_number: null,
          billing_address: null,
          is_default: true,
        },
      ],
      memberships: [{ group_id: "00000000-0000-4000-8000-000000000003", role: "tenant" }],
      created_at: "2026-10-13T00:00:00.000Z",
    });
    const online = Object.keys(clientToInsert(client, "tenant"));
    const offline = new Set(
      Object.keys(makeServerRow(client, "tenant", client.id, "2026-10-13T00:00:00.000Z")),
    );
    const missing = online.filter((key) => !offline.has(key));
    assert.deepEqual(missing, []);
  });
});

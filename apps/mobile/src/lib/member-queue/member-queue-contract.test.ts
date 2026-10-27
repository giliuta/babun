// ОЧЕРЕДЬ СОТРУДНИКА ПОДКЛЮЧЕНА ВЕЗДЕ, ГДЕ ОН ПИШЕТ. Правила очереди держит
// `plan.test.ts`, хранилище — `member-queue.test.ts` в shared; здесь — что
// каждая дверь сотрудника идёт через `sendOrQueue` тем же вызовом сервера,
// отправщик знает каждый вид, а очередь видна и стирается вместе с прочими.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const MOBILE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function source(relative: string): string {
  return readFileSync(path.join(MOBILE_ROOT, relative), "utf8");
}

/** Кусок исходника от `start` до первого `end` после него. */
function slice(text: string, start: string, end: string): string {
  const at = text.indexOf(start);
  assert.ok(at >= 0, `missing ${start}`);
  const stop = text.indexOf(end, at + start.length);
  return text.slice(at, stop < 0 ? undefined : stop);
}

describe("member offline queue wiring", () => {
  test("every master door goes through sendOrQueue with the same server call", () => {
    const update = slice(source("src/features/calendar/mutations/update.ts"), 'if (role === "master")', "if (role !== \"owner\"");
    assert.match(update, /sendOrQueue\(\{[\s\S]*kind: "update"[\s\S]*supabase\.rpc\("member_appointment_update"/);

    const mutations = source("src/features/calendar/mutations.ts");
    const create = slice(mutations, "export function useCreateAppointment", "onMutate:");
    assert.match(create, /kind: "create"[\s\S]*supabase\.rpc\("member_appointment_create"/);
    const del = slice(mutations, "export function useDeleteAppointment", "onSuccess:");
    assert.match(del, /kind: "delete"[\s\S]*supabase\.rpc\("member_appointment_delete"/);
    const trash = slice(mutations, "export function useTrashAppointment", "onSuccess:");
    assert.match(trash, /kind: "trash"[\s\S]*send: \(\) => trashAppointment\(supabase, id\)/);

    const copy = source("src/features/calendar/mutations/member.ts");
    assert.match(copy, /kind: "copy"[\s\S]*supabase\.rpc\("member_appointment_copy", args\)/);

    const pay = source("src/features/appointments/payment-mutations.ts");
    assert.match(pay, /kind: "pay"[\s\S]*send: \(\) => recordAppointmentPayment\(supabase, input\)/);
    assert.match(pay, /kind: "unpay"[\s\S]*send: \(\) => cancelAppointmentPayment\(supabase, input\)/);
    // Оплату и снятие владелец пишет как прежде — очередь только у сотрудника.
    assert.match(pay, /if \(role !== "master" \|\| !tenantId\) return recordAppointmentPayment/);

    const photos = source("src/features/appointments/appointment-photos.ts");
    assert.match(photos, /if \(role === "master"\) return uploadOrQueueMemberPhotos/);
    assert.match(source("src/features/appointments/pending-files.ts"), /isMemberQueueRunning\(\) \? uploadOrQueueMemberPhotos/);
  });

  test("the sender knows every kind the doors enqueue", () => {
    const senders = source("src/features/appointments/member-queue-senders.ts");
    const table = slice(senders, "export const MEMBER_OP_SENDERS", "};");
    for (const kind of ["update", "create", "copy", "delete", "trash", "pay", "unpay", "photos"]) {
      assert.match(table, new RegExp(`\\b${kind}: send`), kind);
    }
  });

  test("runtime runs for the master on the phone, refusals reach a toast", () => {
    const providers = source("src/providers/AppProviders.tsx");
    assert.match(providers, /role !== "master"\) return;\s*return startMemberQueueRuntime\(memberQueueHost\(queryClient\)\)/);
    assert.match(source("app/_layout.tsx"), /<ToastProvider>\s*<MemberQueueToasts \/>/);
  });

  test("the master sees «Синхронизация»; sign-out warns about and evicts his queue", () => {
    const cabinet = source("app/(dashboard)/cabinet/index.tsx");
    assert.match(cabinet, /const showSync = role === "owner" \|\| role === "dispatcher" \|\| role === "master";/);
    assert.match(cabinet, /useMemberQueue\(tenantId\)\.length/);
    assert.match(source("app/(dashboard)/cabinet/sync.tsx"), /<MemberQueueCards ops=\{memberOps\}/);
    assert.match(source("src/lib/auth-clear.ts"), /\(await queueDepth\(\)\) \+ \(await memberQueueDepth\(\)\)/);
    assert.match(source("src/lib/evict-company.ts"), /await clearMemberOpsOfTenant\(tenantId\);/);
  });

  test("a re-read keeps queued edits on screen", () => {
    const queries = source("src/features/calendar/queries.ts");
    assert.match(queries, /return scope \? list : withQueuedMemberOps\(list, tenantId\);/);
  });
});

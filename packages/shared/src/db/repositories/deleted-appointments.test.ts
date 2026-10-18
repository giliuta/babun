// «УДАЛЁННЫЕ ЗАПИСИ» ЧИТАЮТСЯ ДВЕРЬЮ, А НЕ ТАБЛИЦЕЙ. Снимок записи в ящике
// хранит цену, клиента, адрес и токены ссылки клиента и оценки мастера;
// колонки `appointment` и `dependents` приложению закрыты, а сотруднику
// снимок отдаётся через маску его блоков. Прямой `select` этих колонок
// упал бы на правах — экран остался бы пустым, — а вернувшийся обход маски
// снова показал бы сотруднику суммы и токены.
import { describe, expect, it } from "bun:test";
import { listDeletedAppointments } from "./deleted-appointments";

const ROW = {
  id: "11111111-1111-4111-8111-111111111111",
  team_id: "team-a",
  kind: "work",
  created_by: "22222222-2222-4222-8222-222222222222",
  deleted_at: "2026-10-18T10:00:00+00:00",
  purge_at: "2026-11-17T10:00:00+00:00",
  deleted_by: "22222222-2222-4222-8222-222222222222",
  photo_paths: ["tenant/appointment/a.jpg", 7],
  appointment: {
    id: "11111111-1111-4111-8111-111111111111",
    tenant_id: "33333333-3333-4333-8333-333333333333",
    team_id: "team-a",
    kind: "work",
    date: "2026-10-18",
    time_start: "10:00",
    time_end: "11:00",
    status: "scheduled",
    total_amount: 0,
    services: [],
  },
};

function trashSupabase() {
  const calls: { rpc: [string, unknown][]; tables: string[] } = { rpc: [], tables: [] };
  const supabase = {
    rpc(name: string, args: unknown) {
      calls.rpc.push([name, args]);
      return Promise.resolve({ data: [ROW], error: null });
    },
    from(table: string) {
      calls.tables.push(table);
      throw new Error(`прямое чтение таблицы ${table}`);
    },
  };
  return { supabase: supabase as never, calls };
}

describe("ящик удалённых записей", () => {
  it("читается функцией с маской прав, а не таблицей", async () => {
    const { supabase, calls } = trashSupabase();
    const rows = await listDeletedAppointments(supabase);
    expect(calls.tables).toEqual([]);
    expect(calls.rpc).toEqual([["list_deleted_appointments", {}]]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(ROW.id);
    expect(rows[0]?.teamId).toBe("team-a");
    expect(rows[0]?.appointment.id).toBe(ROW.id);
  });

  it("берёт из снимка только строковые пути фото", async () => {
    const { supabase } = trashSupabase();
    const [row] = await listDeletedAppointments(supabase);
    expect(row?.photoPaths).toEqual(["tenant/appointment/a.jpg"]);
  });

  it("календарь передаёт серверу, а не режет у себя", async () => {
    const { supabase, calls } = trashSupabase();
    await listDeletedAppointments(supabase, "team-a");
    expect(calls.rpc).toEqual([["list_deleted_appointments", { p_team_id: "team-a" }]]);
  });
});

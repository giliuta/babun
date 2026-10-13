import { useMemo } from "react";
import type { Client, ClientTag } from "@babun/shared/local/clients";
import type { Appointment } from "@babun/shared/local/appointments";
import type { ClientsScope } from "@/session/clients-company";
import type { Team } from "@/features/reference/queries";
import type { GuestSources } from "@/features/clients/guest-sources";
import { withClientHistory } from "@/features/clients/member-history";
import { useMemberClientHistory } from "@/features/clients/use-member-history";
import { useCalendarVisibility } from "@/session/workspaces";
import { useTenantId } from "@/lib/tenant";
import { uniqueById } from "./list-derive";

/** One list of several companies: rows, appointments, teams and tags glued
 *  by id, each row knowing its company. */
export function useListMerge({
  scope,
  data,
  guests,
  ownAppointments,
  ownTeams,
  ownTags,
}: {
  scope: ClientsScope | null;
  data: Client[] | undefined;
  guests: GuestSources;
  ownAppointments: Appointment[];
  ownTeams: Team[];
  ownTags: ClientTag[];
}) {
  // ОДИН СПИСОК ИЗ НЕСКОЛЬКИХ КОМПАНИЙ. Строка знает свою компанию: по ней
  // открывается карточка и по ней решается, что со строкой можно.
  const clients = useMemo(
    () => uniqueById([...(data ?? []), ...guests.list.flatMap((guest) => guest.clients)]),
    [data, guests.list],
  );
  const guestOf = useMemo(() => {
    const byClient = new Map<string, ClientsScope>();
    for (const guest of guests.list) {
      for (const client of guest.clients) byClient.set(client.id, guest.scope);
    }
    return byClient;
  }, [guests.list]);
  // У сотрудника визиты клиентов — ещё и «Историей записей» (01.10):
  // календарь открывает клиента записи только около записи.
  const ownHistory = useMemberClientHistory(scope, data);
  const appointments = useMemo(
    () =>
      uniqueById([
        ...withClientHistory(ownAppointments, ownHistory),
        ...guests.list.flatMap((guest) => guest.appointments),
      ]),
    [ownAppointments, ownHistory, guests.list],
  );
  // Склейка справочников идёт ПО ИДЕНТИФИКАТОРУ: одна и та же компания может
  // прийти и своим хуком, и гостевым источником (её календарь открыт), а два
  // одинаковых ключа в списке — это и предупреждение React, и две одинаковые
  // строки в фильтре.
  // Скрытого календаря (владелец 04.10) в ленте команд клиентов нет.
  const { isHidden } = useCalendarVisibility();
  const visibilityTenantId = useTenantId();
  const teams = useMemo(
    () =>
      uniqueById([
        ...ownTeams.filter((team) => !isHidden(visibilityTenantId, team.id)),
        ...guests.list.flatMap((guest) =>
          guest.teams.filter((team) => !isHidden(guest.scope.tenantId, team.id)),
        ),
      ]),
    [ownTeams, guests.list, isHidden, visibilityTenantId],
  );
  const tags = useMemo(
    () => uniqueById([...ownTags, ...guests.list.flatMap((guest) => guest.tags)]),
    [ownTags, guests.list],
  );
  return { clients, guestOf, appointments, teams, tags };
}

/** A team of the ribbon — own or a guest company's. */
export type ListTeam = ReturnType<typeof useListMerge>["teams"][number];

import { useCallback, useMemo } from "react";
import type { Client } from "@babun/shared/local/clients";
import {
  clientMemberOf,
  clientsById,
  linkLine,
} from "@babun/shared/local/selectors/client-links";
import { useClients } from "@/features/clients/queries";
import {
  LinkPickerSheet,
  type LinkDraft,
} from "@/features/clients/LinkPickerSheet";

// ДВЕРЬ СВЯЗИ СТРАНИЦЫ КЛИЕНТА — шторка выбора человека с готовым вопросом
// (STORY-086). Ход «лист → шторка → связь» и что делать с выбором — в
// `ClientPeopleDoor.tsx`; здесь только сама шторка и строки «чей он».

/** Что спрашивает дверь связи: вопрос словами того места, где его задают, и
 *  то, что дверь уже решила за человека (роль, место). */
export interface LinkDoorAsk {
  title: string;
  role: string;
  locationId?: string;
}

/** ШТОРКА ВЫБОРА ЧЕЛОВЕКА СО СТРОКОЙ «ЧЕЙ ОН» ПОД КАЖДЫМ ИМЕНЕМ.
 *
 *  Отдельным компонентом — ради справочника: строку собирает общий
 *  построитель `linkLine` по КАРТЕ ВСЕХ карточек (связь названа именем
 *  ДРУГОГО клиента, и в самой строке его нет). Карта строится один раз на
 *  список, а не по клиенту на строку, и только пока дверь открыта. */
export function LinkDoor({
  ask,
  visible,
  group,
  onPick,
  onCreate,
  onClose,
  onExited,
}: {
  ask: LinkDoorAsk;
  visible: boolean;
  group: Client;
  onPick: (member: Client, link: LinkDraft) => void;
  onCreate: (prefill: { name?: string; phone?: string }, link: LinkDraft) => void;
  onClose: () => void;
  onExited: () => void;
}) {
  const { data: directory = [] } = useClients();
  // Строки считаются ОДИН раз на справочник: шторка спрашивает `linkFor`
  // трижды на строку (подпись, её наличие, озвучка) и заново на каждую букву
  // поиска — у владельца это сотни имён.
  const lines = useMemo(() => {
    const byId = clientsById(directory);
    const map = new Map<string, string>();
    for (const client of directory) {
      const text = linkLine(clientMemberOf(client, byId))?.text;
      if (text) map.set(client.id, text);
    }
    return map;
  }, [directory]);
  const linkFor = useCallback((client: Client) => lines.get(client.id), [lines]);
  return (
    <LinkPickerSheet
      visible={visible}
      title={ask.title}
      group={group}
      role={ask.role}
      locationId={ask.locationId}
      linkFor={linkFor}
      onPick={onPick}
      onCreate={onCreate}
      onClose={onClose}
      onExited={onExited}
    />
  );
}

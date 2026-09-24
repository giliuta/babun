import { useMemo, useState } from "react";
import type { Appointment } from "@babun/shared/local/appointments";
import type { Client, Location } from "@babun/shared/local/clients";
import type { ClientLinkItem } from "@/features/clients/blocks/ClientLinksBlock";
import { useSheetDoorway } from "@/components/ui/use-sheet-doorway";
import { useLastNonNull } from "@/lib/use-last-non-null";
import ObjectsBlock from "@/features/clients/blocks/ObjectsBlock";
import { useLocationRequestActions } from "@/features/clients/location-request-actions";
import { useLocationWriter } from "@/features/clients/use-location-writer";
import { lastVisitByObject } from "@/features/clients/object-last-visit";
import { ObjectSheet } from "@/features/clients/ObjectSheet";
import { ObjectEditSheet } from "@/features/clients/ObjectEditSheet";
import { useCurrentRole } from "@/features/settings/tenant";
import { useClientsCapabilities } from "@/features/clients/company-scope";

// ОБЪЕКТЫ КЛИЕНТА — ОДИН КУСОК НА ДВА МЕСТА (владелец 22.09: «блок объекты —
// нажимаю, и открывается страница, где все объекты… если у клиента 12
// объектов, их не пролистаешь до файлов»).
//
// На КАРТОЧКЕ блок показывает первые строки и дверь «Все объекты · N»; на
// СВОЕЙ СТРАНИЦЕ (`/clients/objects`) — весь список. Код один: два экземпляра
// разошлись бы на первой же правке, как когда-то разошлись две формы записи.

const EMPTY_LOCATIONS: Location[] = [];

/** Сколько объектов показывает карточка; остальные — за дверью «Все объекты». */
export const OBJECTS_ON_CARD = 3;

export function ClientObjectsSection({
  client,
  update,
  draft,
  appointments,
  limit,
  onOpenAll,
  bare,
  residentsLine,
  residentsAt,
  onAddResident,
  onOpenResident,
  onResidentRole,
  onRemoveResident,
}: {
  client: Client;
  update: (patch: Partial<Client>) => Promise<boolean>;
  draft: boolean;
  appointments: readonly Appointment[];
  /** Сколько строк показывать на карточке; без него — все (своя страница). */
  limit?: number;
  /** Открыть страницу всех объектов — дверь под списком. */
  onOpenAll?: () => void;
  /** Своя страница: название уже в заголовке экрана, шапки у блока нет. */
  bare?: boolean;
  residentsLine?: (loc: Location) => string | undefined;
  residentsAt?: (loc: Location) => readonly ClientLinkItem[];
  onAddResident?: (loc: Location) => void;
  onOpenResident?: (item: ClientLinkItem) => void;
  onResidentRole?: (item: ClientLinkItem, role: string) => void;
  onRemoveResident?: (item: ClientLinkItem) => void;
}) {
  const [objectsOpen, setObjectsOpen] = useState(false);
  // Правка объекта — лист, а не страница (владелец 2026-08-06). Страницы
  // /clients/object и /clients/unit удалены вместе с уровнем «Информация».
  // Правка и удаление — ОДИН лист с двумя настроениями: два экземпляра
  // заводили по своей очереди записи и по своему снимку массива, и свайп
  // «Удалить» после правки откатывал её вместе с чужими объектами.
  const [sheet, setSheet] = useState<{
    id: string;
    askDelete?: boolean;
  } | null>(null);
  // ОДИН ПИСАТЕЛЬ НА `locations` ДЛЯ ВСЕЙ КАРТОЧКИ. Свой писатель в каждом
  // листе означал три независимые очереди от трёх снимков: добавили объект в
  // одном листе, тут же поправили другой — и новый объект стирался ответом
  // из соседней очереди.
  const locationWriter = useLocationWriter(
    client.locations ?? EMPTY_LOCATIONS,
    update,
    // Хозяин массива — клиент: очередь общая с его страницей «Все объекты».
    client.id,
  );
  // ССЫЛКА КЛИЕНТУ «ОТМЕТЬТЕ АДРЕС» (STORY-077) — у сохранённого клиента и
  // только владельцу/диспетчеру: черновику ссылку не выписать (нет id), а
  // мастеру сервер откажет.
  const role = useCurrentRole().data;
  const canRequestAddress = !draft && (role === "owner" || role === "dispatcher");
  // Черновик нового клиента правит тот, кто его заводит; сохранённого —
  // по праву «Клиенты: Меняет» в этой компании.
  const caps = useClientsCapabilities();
  const canEdit = draft || caps.edit;
  const requestActions = useLocationRequestActions();

  // ЧЕЙ ЛИСТ ОТКРЫТ — ДЕРЖИМ ДО КОНЦА АНИМАЦИИ ЗАКРЫТИЯ. Сам лист так же
  // держит последний правившийся объект (`useLastNonNull` внутри него): без
  // этого жильцы пропадали бы из уезжающего вниз листа за кадр до того, как
  // он скроется, — блок «Жильцы» схлопывался у человека на глазах.
  const openLocationId = useLastNonNull(sheet?.id ?? null);
  const openLocation = useMemo(
    () =>
      (client.locations ?? EMPTY_LOCATIONS).find((l) => l.id === openLocationId) ??
      null,
    [client.locations, openLocationId],
  );
  // ИЗ ЛИСТА — НА КАРТОЧКУ ЖИЛЬЦА, И ОБРАТНО В ТОТ ЖЕ ЛИСТ (стандарт двери из
  // шторки, владелец 2026-09-10: «сделай стандарт, как и везде»). Лист — это
  // отдельное окно `Modal`, и карточка жильца, открытая при нём, уехала бы
  // ПОД него. Дверь паркует лист, открывает карточку, а «назад» возвращает
  // ту же виллу с тем же набранным.
  const residentDoor = useSheetDoorway();
  // «БЫЛ 12 АВГ» У КАЖДОГО ОБЪЕКТА — из тех же записей клиента, что уже
  // пришли на страницу: отдельного запроса нет.
  const lastVisits = useMemo(() => lastVisitByObject(appointments), [appointments]);


  return (
    <>
      <ObjectsBlock
        client={client}
        // ОБЪЕКТЫ ПРАВИТ ТОТ, КОМУ СЕРВЕР ПРАВИТ КАРТОЧКУ (STORY-088, волна 4):
        // объекты лежат в самом клиенте, и без «Клиенты: Меняет» запись
        // откажет. Раньше у «Видит» стояли и «Добавить», и свайп, и лист.
        onOpen={canEdit ? (id) => setSheet({ id }) : undefined}
        onDelete={canEdit ? (loc) => setSheet({ id: loc.id, askDelete: true }) : undefined}
        onAdd={canEdit ? () => setObjectsOpen(true) : undefined}
        requestsEnabled={canRequestAddress}
        residentsFor={residentsLine}
        lastVisitFor={(loc) => lastVisits.get(loc.id)}
        onNote={
          canEdit
            ? (id, next) => void locationWriter.patchLocation(id, { note: next || undefined })
            : undefined
        }
        limit={limit}
        onOpenAll={onOpenAll}
        bare={bare}
      />
      {/* Свайп по строке открывает тот же лист сразу с вопросом об удалении —
          подтверждение и запись остаются в одном месте. */}
      <ObjectEditSheet
        visible={sheet !== null && !residentDoor.parked}
        client={client}
        locationId={sheet?.id ?? null}
        askDelete={sheet?.askDelete}
        writer={locationWriter}
        // Жильцы ЭТОГО объекта: лист в сеть не ходит и связи не считает —
        // данные приносит страница, у которой они уже есть.
        residents={
          openLocation && residentsAt ? residentsAt(openLocation) : undefined
        }
        // КУРСОРА В РОЛЬ ЖИЛЬЦА В ЛИСТЕ НЕТ НАМЕРЕННО, поэтому и пропа под
        // него у листа нет: после выбора жильца лист не открывается заново —
        // человек уже на странице, и курсор стоит в его строке блока
        // «Клиент». Ключ фокуса в листе сработал бы позже, на ЛЮБОМ следующем
        // открытии виллы, и поднял бы клавиатуру над листом, который открыли
        // совсем не за этим.
        onAddResident={onAddResident}
        onOpenResident={
          onOpenResident
            ? (item) => residentDoor.open(() => onOpenResident(item))
            : undefined
        }
        onResidentRole={onResidentRole}
        onRemoveResident={onRemoveResident}
        onRequestFromClient={
          canRequestAddress ? () => void requestActions.request(client.id) : undefined
        }
        onClose={() => setSheet(null)}
      />
      {/* Добавление объекта — лист снизу (владелец 2026-07-27). Живёт рядом с
          блоком, а не в карточке: кроме открытия у карточки к нему дел нет. */}
      <ObjectSheet
        visible={objectsOpen}
        writer={locationWriter}
        onRequestFromClient={
          canRequestAddress ? () => void requestActions.request(client.id) : undefined
        }
        onClose={() => setObjectsOpen(false)}
      />

    </>
  );
}

export default ClientObjectsSection;

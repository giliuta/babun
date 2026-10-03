import { useMemo, useState } from "react";
import type { Appointment } from "@babun/shared/local/appointments";
import type { Client, Location } from "@babun/shared/local/clients";
import type { ClientLinkItem } from "@/features/clients/blocks/ClientLinksBlock";
import ObjectsBlock from "@/features/clients/blocks/ObjectsBlock";
import { useLocationRequestActions } from "@/features/clients/location-request-actions";
import { useLocationWriter } from "@/features/clients/use-location-writer";
import { cardObjectId, lastVisitByObject } from "@/features/clients/object-last-visit";
import { ObjectSheet } from "@/features/clients/ObjectSheet";
import { ObjectEditSheet } from "@/features/clients/ObjectEditSheet";
import { useClientsCapabilities, useScopeCompany } from "@/features/clients/company-scope";

// ОБЪЕКТЫ КЛИЕНТА — ОДИН КУСОК НА ДВА МЕСТА (владелец 22.09: «блок объекты —
// нажимаю, и открывается страница, где все объекты… если у клиента 12
// объектов, их не пролистаешь до файлов»).
//
// На КАРТОЧКЕ блок показывает ОДИН объект — обслуженный последним или
// последний добавленный (владелец 03.10: «три объекта растягивают страницу»),
// тап по нему — СВОЯ СТРАНИЦА (`/clients/objects`) со всеми; там тап по
// объекту — лист правки, внизу — «Добавить объект». Код один: два
// экземпляра разошлись бы на первой же правке, как когда-то две формы записи.

const EMPTY_LOCATIONS: Location[] = [];


export function ClientObjectsSection({
  client,
  update,
  draft,
  appointments,
  limit,
  onOpenAll,
  bare,
  single,
  adding,
  onAddingChange,
  residentsLine,
  readOnly = false,
}: {
  /** Только видит (право блока «Объекты», 30.09): без правки и дверей. */
  readOnly?: boolean;
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
  /** Карточка: один объект, тап — страница всех (03.10). */
  single?: boolean;
  /** Лист добавления открывает кнопка ВНЕ блока (футер страницы объектов):
   *  тогда строки «Добавить объект» в блоке нет, а лист — по этому флагу. */
  adding?: boolean;
  onAddingChange?: (open: boolean) => void;
  residentsLine?: (loc: Location) => string | undefined;
  /** Ниже — двери жильцов из листа объекта. Лист их больше не ставит
   *  (владелец 03.10: «добавить жильца — убираем»); пропы принимаются, чтобы
   *  не ломать общий разворот `people.residents` у страниц. */
  residentsAt?: (loc: Location) => readonly ClientLinkItem[];
  onAddResident?: (loc: Location) => void;
  onOpenResident?: (item: ClientLinkItem) => void;
  onResidentRole?: (item: ClientLinkItem, role: string) => void;
  onRemoveResident?: (item: ClientLinkItem) => void;
}) {
  const [ownAdding, setOwnAdding] = useState(false);
  const footerAdd = onAddingChange !== undefined;
  const objectsOpen = footerAdd ? !!adding : ownAdding;
  const setObjectsOpen = footerAdd ? onAddingChange : setOwnAdding;
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
  // мастеру сервер откажет. Роль — в компании КАРТОЧКИ (03.10), а не той, что
  // открыта в календаре: при команде партнёра своя дверь пряталась.
  const role = useScopeCompany().role;
  const canRequestAddress = !draft && (role === "owner" || role === "dispatcher");
  // Черновик нового клиента правит тот, кто его заводит; сохранённого —
  // по праву «Клиенты: Меняет» в этой компании.
  const caps = useClientsCapabilities();
  // Право блока «Объекты» (30.09) может погасить правку и там, где карточка
  // правится; без него — как было.
  const canEdit = !readOnly && (draft || caps.edit);
  const requestActions = useLocationRequestActions();

  // «БЫЛ 12 АВГ» У КАЖДОГО ОБЪЕКТА — из тех же записей клиента, что уже
  // пришли на страницу: отдельного запроса нет.
  const lastVisits = useMemo(() => lastVisitByObject(appointments), [appointments]);
  const cardId = useMemo(
    () => (single ? cardObjectId(client.locations ?? EMPTY_LOCATIONS, lastVisits) : undefined),
    [single, client.locations, lastVisits],
  );


  return (
    <>
      <ObjectsBlock
        client={client}
        // ОБЪЕКТЫ ПРАВИТ ТОТ, КОМУ СЕРВЕР ПРАВИТ КАРТОЧКУ (STORY-088, волна 4):
        // объекты лежат в самом клиенте, и без «Клиенты: Меняет» запись
        // откажет. Раньше у «Видит» стояли и «Добавить», и свайп, и лист.
        onOpen={canEdit ? (id) => setSheet({ id }) : undefined}
        onDelete={canEdit ? (loc) => setSheet({ id: loc.id, askDelete: true }) : undefined}
        onAdd={canEdit && !footerAdd ? () => setObjectsOpen(true) : undefined}
        requestsEnabled={canRequestAddress}
        residentsFor={residentsLine}
        lastVisitFor={(loc) => lastVisits.get(loc.id)}
        canCopy={draft || caps.export}
        onNote={
          canEdit
            ? (id, next) => void locationWriter.patchLocation(id, { note: next || undefined })
            : undefined
        }
        limit={limit}
        onOpenAll={onOpenAll}
        bare={bare}
        only={single ? cardId : undefined}
      />
      {/* Свайп по строке открывает тот же лист сразу с вопросом об удалении —
          подтверждение и запись остаются в одном месте. */}
      <ObjectEditSheet
        visible={sheet !== null}
        client={client}
        locationId={sheet?.id ?? null}
        askDelete={sheet?.askDelete}
        writer={locationWriter}
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
        teamId={client.team_id ?? null}
        onRequestFromClient={
          canRequestAddress ? () => void requestActions.request(client.id) : undefined
        }
        onClose={() => setObjectsOpen(false)}
      />

    </>
  );
}

export default ClientObjectsSection;

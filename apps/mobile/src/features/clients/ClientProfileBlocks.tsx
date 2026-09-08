import { useState } from "react";
import type { Appointment } from "@babun/shared/local/appointments";
import type { Client, ClientTag, Location } from "@babun/shared/local/clients";
import ObjectsBlock from "@/features/clients/blocks/ObjectsBlock";
import { useLocationRequestActions } from "@/features/clients/location-request-actions";
import { useLocationWriter } from "@/features/clients/use-location-writer";
import { ObjectSheet } from "@/features/clients/ObjectSheet";
import { ObjectEditSheet } from "@/features/clients/ObjectEditSheet";
import DocumentationBlock from "@/features/clients/blocks/DocumentationBlock";
import NotesBlock from "@/features/clients/blocks/NotesBlock";
import { PersonalBlock } from "@/features/clients/blocks/PersonalBlock";
import { RowCaption } from "@/components/ui/card-rows";
import { useCurrentRole } from "@/features/settings/tenant";

const EMPTY_LOCATIONS: Location[] = [];

interface ClientProfileBlocksProps {
  client: Client;
  /** Визиты клиента — блок объектов считает по ним срок обслуживания. */
  appointments: readonly Appointment[];
  draft: boolean;
  tags: ClientTag[];
  update: (patch: Partial<Client>) => Promise<boolean>;
}

export function ClientProfileBlocks({
  client,
  appointments,
  draft,
  tags,
  update,
}: ClientProfileBlocksProps) {
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
  );
  // ССЫЛКА КЛИЕНТУ «ОТМЕТЬТЕ АДРЕС» (STORY-077) — у сохранённого клиента и
  // только владельцу/диспетчеру: черновику ссылку не выписать (нет id), а
  // мастеру сервер откажет.
  const role = useCurrentRole().data;
  const canRequestAddress = !draft && (role === "owner" || role === "dispatcher");
  const requestActions = useLocationRequestActions();
  return (
    <>
      <ObjectsBlock
        client={client}
        onOpen={(id) => setSheet({ id })}
        onDelete={(loc) => setSheet({ id: loc.id, askDelete: true })}
        onAdd={() => setObjectsOpen(true)}
        requestsEnabled={canRequestAddress}
      />
      {/* Свайп по строке открывает тот же лист сразу с вопросом об удалении —
          подтверждение и запись остаются в одном месте. */}
      <ObjectEditSheet
        visible={sheet !== null}
        client={client}
        locationId={sheet?.id ?? null}
        askDelete={sheet?.askDelete}
        writer={locationWriter}
        onClose={() => setSheet(null)}
      />
      {/* Добавление объекта — лист снизу (владелец 2026-07-27). Живёт рядом с
          блоком, а не в карточке: кроме открытия у карточки к нему дел нет. */}
      <ObjectSheet
        visible={objectsOpen}
        client={client}
        update={update}
        writer={locationWriter}
        onRequestFromClient={
          canRequestAddress ? () => void requestActions.request(client.id) : undefined
        }
        onClose={() => setObjectsOpen(false)}
      />

      {/* СОЗДАНИЕ ПОКАЗЫВАЕТ ВСЮ СТРАНИЦУ (владелец 2026-07-26: «страница
          должна показываться сразу — добавить клиента открывается чётко вся
          страница, как будет выглядеть в будущем»). Раньше в черновике
          рисовались только объекты и заметка, и человек не видел, куда
          вообще денутся Telegram, метка или день рождения.
          Каждое поле этих блоков проходит белый список create_client_with_tags
          (phones, locations, notes, city, birthday, language, telegram/
          instagram/whatsapp) — то есть в черновике они пишут в тот же объект,
          который уедет в базу по «Готово», а не в пустоту. */}
      {/* Строки «История записей · N» здесь больше нет: в историю ведёт сама
          сводка под номером — «6 визитов · €600 · был 30 мая» (владелец
          2026-08-02). Число визитов и так стояло в сводке, и строка повторяла
          его второй раз ради одного шеврона. */}

      {/* ПОРЯДОК (владелец 2026-08-06): объекты → заметки → документация →
          личное. Сразу под объектами — то, что ЗАПИСЫВАЮТ по ходу дела, и
          только потом справочные свойства человека.

          ДОКУМЕНТАЦИЯ — СВОЯ КАРТОЧКА (владелец 2026-09-07: «заметка клиента
          — отдельный блок, а документация со счетами и чеками — всё вместе,
          с разбивкой по записям»). В черновике её нет: документы живут у
          записей, а записей у несохранённого клиента не бывает. */}
      <NotesBlock client={client} update={update} />
      {!draft ? <DocumentationBlock clientId={client.id} /> : null}
      <PersonalBlock client={client} update={update} tags={tags} />
      {/* Строки «Ещё» больше нет (владелец 2026-08-02: «чтобы внизу
          уменьшить»). Мессенджеры и почта уехали к номерам — их добавляют
          плюсом в блоке контактов; источник — в «Личное», к метке и дню
          рождения. Отдельная страница /clients/extras вместе с ней удалена. */}
      {client.blacklisted ? (
        <RowCaption tone="danger" text="Клиент в чёрном списке." />
      ) : null}
    </>
  );
}

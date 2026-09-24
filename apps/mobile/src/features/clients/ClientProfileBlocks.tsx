import { useFeatureOn } from "@/features/settings/company-features";
import type { ReactNode } from "react";
import { Paperclip } from "lucide-react-native";
import { ChooseRow } from "@/components/ui/ChooseRow";
import { SectionCard } from "@/components/ui/SectionCard";
import type { Appointment } from "@babun/shared/local/appointments";
import type { Client, Location } from "@babun/shared/local/clients";
import type { ClientLinkItem } from "@/features/clients/blocks/ClientLinksBlock";
import { ClientObjectsSection, OBJECTS_ON_CARD } from "@/features/clients/ClientObjectsSection";
import {
  REQUISITES_ON_CARD,
  RequisitesBlock,
} from "@/features/clients/blocks/RequisitesBlock";
import { useClientsCapabilities } from "@/features/clients/company-scope";
import ClientFilesBlock from "@/features/clients/blocks/ClientFilesBlock";
import { PersonalBlock } from "@/features/clients/blocks/PersonalBlock";
import { RowCaption } from "@/components/ui/card-rows";


interface ClientProfileBlocksProps {
  client: Client;
  /** Визиты клиента — блок объектов считает по ним срок обслуживания. */
  appointments: readonly Appointment[];
  draft: boolean;
  update: (patch: Partial<Client>) => Promise<boolean>;
  /** Инвойсы и чеки клиента. У клиента компании, где человек только
   *  работает, их нет: это деньги той компании (STORY-082). */
  showDocuments?: boolean;
  /** ЖИЛЬЦЫ ОБЪЕКТА ОДНОЙ СТРОКОЙ — показание под объектом на странице
   *  («Мария Спиру · жилец, Андреас · жилец»). Считает страница: связи живут
   *  у людей, а не в карточке-группе, и приезжают они отдельным запросом.
   *  Нет пропа — четвёртой строки у объекта нет вовсе. */
  residentsLine?: (loc: Location) => string | undefined;
  /** ЖИЛЬЦЫ ЭТОГО ОБЪЕКТА СТРОКАМИ — блок «Жильцы» внутри листа объекта.
   *  Тот же перечень, что на странице, только отфильтрованный по месту. */
  residentsAt?: (loc: Location) => readonly ClientLinkItem[];
  /** ЕДИНСТВЕННАЯ ДВЕРЬ ЗАВЕДЕНИЯ ЖИЛЬЦА — в листе объекта (ТЗ, «что НЕ
   *  делаем» 3). Лист к этому моменту уже уехал: шторку поднимает страница. */
  onAddResident?: (loc: Location) => void;
  onOpenResident?: (item: ClientLinkItem) => void;
  onResidentRole?: (item: ClientLinkItem, role: string) => void;
  onRemoveResident?: (item: ClientLinkItem) => void;
  /** Открыть страницу всех объектов клиента. */
  onOpenObjects?: () => void;
  /** Открыть страницу всех наборов реквизитов. */
  onOpenRequisites?: () => void;
  /** Новый клиент: «Добавить» в «Файлах» сперва создаёт карточку. */
  onDraftFiles?: () => void;
  /** Карточку только что создали ради файла — сразу открыть лист. */
  openFilesOnArrive?: boolean;
  onArrived?: () => void;
  /** Метка и тег плитками — стоят ПЕРЕД «Личным» (владелец 22.09: «это не
   *  должно быть на первой странице»). Собирает страница: ей видно каталог
   *  тегов и право менять. */
  labelTags?: ReactNode;
}

// БЛОКИ КАРТОЧКИ — НА `SectionCard`, КАК НА СТРАНИЦЕ ЗАПИСИ (владелец
// 2026-09-10: «в клиентах блок выглядит немного по-другому от того, как
// выглядит в календаре»).
//
// «Объекты», «Заметка клиента», «Личное» и «Документация» стояли на
// `RowGroup`, у которого капс-подпись живёт НАД карточкой, на прохладном
// фоне; блоки записи давно на `SectionCard` — подпись внутри белого, там же
// справа её команда. Один и тот же блок читался двумя способами в
// зависимости от того, с какого экрана на него смотрят.
//
// Подложки совпадают: `Card` и `RowGroupBody` рисуют одну поверхность, и
// боковой отступ у обеих `GUTTER`. Менялось ровно место подписи и промежуток
// между карточками (12 → 8, как на записи).

export function ClientProfileBlocks({
  client,
  appointments,
  draft,
  update,
  showDocuments = true,
  residentsLine,
  residentsAt,
  onAddResident,
  onOpenResident,
  onResidentRole,
  onRemoveResident,
  onOpenObjects,
  onOpenRequisites,
  onDraftFiles,
  openFilesOnArrive,
  onArrived,
  labelTags,
}: ClientProfileBlocksProps) {
  const caps = useClientsCapabilities();
  // Функции компании (STORY-088): выключенное — у всех, у владельца тоже.
  const objectsOn = useFeatureOn("objects");
  const filesOn = useFeatureOn("client_files");
  const requisitesOn = useFeatureOn("client_requisites");

  return (
    <>
      {objectsOn ? (
      <ClientObjectsSection
        client={client}
        update={update}
        draft={draft}
        appointments={appointments}
        // НА КАРТОЧКЕ — ПЕРВЫЕ ТРИ И ДВЕРЬ (владелец 22.09: «если у клиента
        // 12 объектов, их надо листать, чтобы добраться до файлов»).
        limit={OBJECTS_ON_CARD}
        onOpenAll={onOpenObjects}
        residentsLine={residentsLine}
        residentsAt={residentsAt}
        onAddResident={onAddResident}
        onOpenResident={onOpenResident}
        onResidentRole={onResidentRole}
        onRemoveResident={onRemoveResident}
      />
      ) : null}

      {/* СОЗДАНИЕ ПОКАЗЫВАЕТ ВСЮ СТРАНИЦУ (владелец 2026-07-26: «страница
          должна показываться сразу — добавить клиента открывается чётко вся
          страница, как будет выглядеть в будущем»). Раньше в черновике
          рисовались только объекты и заметка, и человек не видел, куда
          вообще денутся Telegram, метка или день рождения.
          Каждое поле этих блоков проходит белый список create_client_with_tags
          (phones, locations, notes, city, birthday, language, telegram/
          instagram/whatsapp) — то есть в черновике они пишут в тот же объект,
          который уедет в базу по «Создать клиента», а не в пустоту. */}
      {/* Строки «История записей · N» здесь больше нет: в историю ведёт сама
          сводка под номером — «6 визитов · €600 · был 30 мая» (владелец
          2026-08-02). Число визитов и так стояло в сводке, и строка повторяла
          его второй раз ради одного шеврона. */}

      {/* ПОРЯДОК (владелец 2026-08-06): объекты → заметки → файлы →
          личное. Сразу под объектами — то, что ЗАПИСЫВАЮТ по ходу дела, и
          только потом справочные свойства человека.

          ФАЙЛЫ — ТОТ ЖЕ БЛОК, ЧТО У ЗАПИСИ (владелец 22.09: «уберём полностью
          блок документации и просто туда вставим, как у нас файлы, как везде
          хранятся файлы»). В черновике его нет: путь в хранилище строится по
          id клиента, которого ещё нет. Добавлять — только с правом менять
          карточку и там, где хранилище видит компанию (`caps.files`). */}
      {!draft && showDocuments && filesOn ? (
        <ClientFilesBlock
          clientId={client.id}
          canChange={caps.edit && caps.files}
          openOnArrive={openFilesOnArrive}
          onArrived={onArrived}
        />
      ) : null}
      {/* В НОВОМ КЛИЕНТЕ — ТОТ ЖЕ БЛОК (владелец 22.09: «при создании — те
          же самые блоки»). Файл кладётся по id клиента, поэтому «Добавить»
          сперва создаёт карточку, а лист открывается уже на ней. */}
      {draft && showDocuments && filesOn && caps.edit && caps.files && onDraftFiles ? (
        <SectionCard title="Файлы">
          <ChooseRow compact icon={Paperclip} label="Добавить файл" onPress={onDraftFiles} />
        </SectionCard>
      ) : null}
      {/* РЕКВИЗИТЫ — у любого клиента, постоянным блоком (владелец
          2026-09-21: «инвойс могут просить прямо на клиента с его
          реквизитами»). Только владельцу: это получатель на инвойсе, документы
          и деньги (STORY-085). */}
      {caps.money && requisitesOn ? (
        <RequisitesBlock
          client={client}
          draft={draft}
          update={update}
          limit={REQUISITES_ON_CARD}
          onOpenAll={onOpenRequisites}
        />
      ) : null}
      {labelTags ?? null}
      <PersonalBlock client={client} update={update} readOnly={!draft && !caps.edit} draft={draft} />
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

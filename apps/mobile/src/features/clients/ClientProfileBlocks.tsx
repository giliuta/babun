import type { CardAccess } from "@/features/clients/card-access";
import { useCardAccess } from "@/features/clients/use-card-access";
import { Paperclip } from "lucide-react-native";
import { ChooseRow } from "@/components/ui/ChooseRow";
import { SectionCard } from "@/components/ui/SectionCard";
import type { Appointment } from "@babun/shared/local/appointments";
import type { Client, Location } from "@babun/shared/local/clients";
import type { ClientLinkItem } from "@/features/clients/blocks/ClientLinksBlock";
import { ClientObjectsSection } from "@/features/clients/ClientObjectsSection";
import { RequisitesBlock } from "@/features/clients/blocks/RequisitesBlock";
import ClientFilesBlock from "@/features/clients/blocks/ClientFilesBlock";
import { PersonalBlock } from "@/features/clients/blocks/PersonalBlock";
import { RowCaption } from "@/components/ui/card-rows";


interface ClientProfileBlocksProps {
  client: Client;
  /** Визиты клиента — блок объектов считает по ним срок обслуживания. */
  appointments: readonly Appointment[];
  draft: boolean;
  update: (patch: Partial<Client>) => Promise<boolean>;
  /** Какие блоки видны и правятся (`card-access.ts`); страница уже спросила.
   *  Нет — блоки спросят сами тем же хуком. */
  access?: CardAccess;
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
}

// БЛОКИ КАРТОЧКИ — НА `SectionCard`, КАК НА СТРАНИЦЕ ЗАПИСИ: блок клиента
// должен выглядеть так же, как в календаре.
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
  access,
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
}: ClientProfileBlocksProps) {
  // Что видно и что правится — страница уже спросила (`card-access.ts`):
  // выключатель команды клиента, права сотрудника по блокам, права компании.
  const fallback = useCardAccess(client, draft);
  const a = access ?? fallback;

  return (
    <>
      {a.objects.show ? (
      <ClientObjectsSection
        client={client}
        update={update}
        draft={draft}
        readOnly={!a.objects.edit}
        // «был 12 авг» у объекта — история записей: без права её нет.
        appointments={a.history.show ? appointments : []}
        // НА КАРТОЧКЕ — ОДИН ОБЪЕКТ: последний, обслуженный или добавленный;
        // тап — страница со всеми. У
        // черновика страницы нет — там список целиком.
        single={!draft}
        onOpenAll={onOpenObjects}
        residentsLine={residentsLine}
        residentsAt={residentsAt}
        onAddResident={onAddResident}
        onOpenResident={onOpenResident}
        onResidentRole={onResidentRole}
        onRemoveResident={onRemoveResident}
      />
      ) : null}

      {/* СОЗДАНИЕ ПОКАЗЫВАЕТ ВСЮ СТРАНИЦУ: страница нового клиента выглядит
          так же, как будет выглядеть сохранённая. Если рисовать в черновике
          только объекты и заметку, человек не увидит, куда вообще денутся
          Telegram, метка или день рождения.
          Каждое поле этих блоков проходит белый список create_client_with_tags
          (phones, locations, notes, city, birthday, language, telegram/
          instagram/whatsapp) — то есть в черновике они пишут в тот же объект,
          который уедет в базу по «Создать клиента», а не в пустоту. */}
      {/* Строки «История записей · N» здесь больше нет: в историю ведёт сама
          сводка под номером — «6 визитов · €600 · был 30 мая». Число визитов и так
          стоит в сводке, и строка повторяла бы его второй раз ради одного
          шеврона. */}

      {/* ПОРЯДОК: объекты → заметки → файлы →
          личное. Сразу под объектами — то, что ЗАПИСЫВАЮТ по ходу дела, и
          только потом справочные свойства человека.

          ФАЙЛЫ — ТОТ ЖЕ БЛОК, ЧТО У ЗАПИСИ (отдельного блока документации нет:
          файлы хранятся везде одинаково). В черновике его нет: путь в хранилище строится по
          id клиента, которого ещё нет. Добавлять — только с правом менять
          карточку и там, где хранилище видит компанию (`caps.files`). */}
      {!draft && a.files.show ? (
        <ClientFilesBlock
          clientId={client.id}
          canChange={a.files.edit}
          showMoney={a.money.show}
          openOnArrive={openFilesOnArrive}
          onArrived={onArrived}
        />
      ) : null}
      {/* В НОВОМ КЛИЕНТЕ — ТОТ ЖЕ БЛОК (при создании — те же блоки). Файл кладётся по id клиента, поэтому «Добавить»
          сперва создаёт карточку, а лист открывается уже на ней. */}
      {draft && a.files.show && a.files.edit && onDraftFiles ? (
        <SectionCard title="Файлы">
          <ChooseRow compact icon={Paperclip} label="Добавить файл" onPress={onDraftFiles} />
        </SectionCard>
      ) : null}
      {/* РЕКВИЗИТЫ — у любого клиента, постоянным блоком (инвойс могут
          просить прямо на клиента с его реквизитами). Только владельцу: это получатель на инвойсе, документы
          и деньги (STORY-085). */}
      {a.requisites.show ? (
        <RequisitesBlock
          client={client}
          draft={draft}
          update={update}
          readOnly={!a.requisites.edit}
          // Один набор — основной; тап — страница всех (как «История»).
          single={!draft}
          // У черновика своей страницы ещё нет: набор правится листом.
          onOpenAll={draft ? undefined : onOpenRequisites}
        />
      ) : null}
      {a.personal.show ? (
        <PersonalBlock client={client} update={update} readOnly={!a.personal.edit} draft={draft} />
      ) : null}
      {/* Строки «Ещё» нет — страница внизу короче. Мессенджеры и почта уехали к номерам — их добавляют
          плюсом в блоке контактов; источник — в «Личное», к метке и дню
          рождения. Отдельная страница /clients/extras вместе с ней удалена. */}
      {client.blacklisted ? (
        <RowCaption tone="danger" text="Клиент в чёрном списке." />
      ) : null}
    </>
  );
}

import { View } from "react-native";
import { Banknote, Bookmark, CreditCard, FileText, ImageIcon, Landmark, Paperclip } from "lucide-react-native";

import { ChooseRow } from "@/components/ui/ChooseRow";
import { SectionCard } from "@/components/ui/SectionCard";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { DocumentPill } from "@/features/appointments/AppointmentFileTiles";
import { ClientBlock } from "@/features/appointments/ClientBlock";
import { InlineNoteField } from "@/features/appointments/InlineNoteField";
import { PaymentTile, TILE_GAP, useTileWidth } from "@/features/appointments/PaymentTiles";
import { ServicesBlock } from "@/features/appointments/ServicesBlock";
import { WhenRow } from "@/features/appointments/BookingSummary";
import { IdentityCard, TeamLabelRow } from "@/features/appointments/TeamLabelRow";
import { ObjectRow } from "@/features/clients/blocks/ObjectsBlock";

import type { AccessBlock, AccessLevel } from "../access-map";
import { PreviewFrame, levelState } from "./PreviewFrame";
import {
  SAMPLE_CLIENT,
  SAMPLE_LOCATION,
  SAMPLE_SERVICES,
  SAMPLE_TOTAL,
  previewRecord,
  sampleTile,
} from "./preview-sample";
import { AppointmentMenuPreview } from "./CalendarPreviews";

// ВИД БЛОКОВ ЗАПИСИ В ШТОРКЕ ПРАВА — НАСТОЯЩИЕ БЛОКИ СТРАНИЦЫ ЗАПИСИ
// (`ClientBlock`, `ServicesBlock`, `TeamLabelRow`, `ObjectRow`, плитки оплаты,
// файлы, заметка) с примерными данными. Что в них нажимается, решает
// `recordBlocks` — то же правило, что у страницы записи сотрудника: блок без
// права правки рисуется ровно так, как у него, — без дверей и шевронов.

const noop = () => {};

const NOTE = {
  draft: "Ключ у соседа, код ворот 1234",
  setDraft: noop,
  onFocus: noop,
  onBlur: noop,
};


export function RecordPreview({
  blockKey,
  blocks,
  levels,
  teamName,
  teamColor,
}: {
  blockKey: string;
  blocks: readonly AccessBlock[];
  levels: Readonly<Record<string, AccessLevel>>;
  teamName: string;
  teamColor: string;
}) {
  const rb = previewRecord(blocks, levels);
  const on = (write: boolean) => (write ? noop : undefined);
  // Телефон клиента в записи сервер прячет, когда «Телефоны» закрыты.
  const phoneOpen = levels["clients.contacts"] === "read";

  switch (blockKey) {
    case "record.team":
      return (
        <PreviewFrame state={levelState(rb.team)}>
          <TeamLabelRow
            teamName={teamName}
            teamColor={teamColor}
            label={null}
            showLabel={false}
            onEditTeam={on(rb.team === "write")}
          />
        </PreviewFrame>
      );
    case "record.label":
      return (
        <PreviewFrame state={levelState(rb.label)}>
          <View className="mx-4 mt-2" style={{ flexDirection: "row" }}>
            <IdentityCard
              icon={Bookmark}
              color={SETTINGS_TILE.teal}
              title="Лимассол"
              onPress={on(rb.label === "write")}
              accessibilityLabel="Метка: Лимассол"
              accessibilityHint="Открывает выбор метки"
            />
          </View>
        </PreviewFrame>
      );
    // «Время» видно всегда; переносит — «Перенос записей» (то же право).
    case "record.when":
      return (
        <PreviewFrame state={levelState(rb.when)}>
          <View className="mx-4 mt-2">
            <WhenRow
              date="2026-10-01"
              timeStart="13:30"
              timeEnd="16:00"
              duration={150}
              onPress={on(rb.when === "write")}
            />
          </View>
        </PreviewFrame>
      );
    case "record.color":
      return (
        <PreviewFrame state={rb.color === "write" ? "can" : "cannot"}>
          <AppointmentMenuPreview color={teamColor} tile={sampleTile(rb)} items={["Цвет"]} swatches />
        </PreviewFrame>
      );
    case "record.client":
      return (
        <PreviewFrame state={levelState(rb.client)}>
          <ClientBlock
            client={phoneOpen ? SAMPLE_CLIENT : { ...SAMPLE_CLIENT, phone: "" }}
            onPick={on(rb.client === "write")}
          />
        </PreviewFrame>
      );
    case "record.object":
      return (
        <PreviewFrame state={levelState(rb.object)}>
          <SectionCard title="Объект">
            <ObjectRow loc={SAMPLE_LOCATION} showNote={false} onPress={on(rb.object === "write")} />
          </SectionCard>
        </PreviewFrame>
      );
    case "record.services":
    case "record.amount": {
      // «Цены: Не видит» — услуги остаются, пропадают только деньги: так и
      // рисуем, без затемнения.
      const gone = rb.services === "hidden" && (blockKey === "record.services" || rb.amount === "hidden");
      const pricesGone = !gone && blockKey === "record.amount" && rb.amount === "hidden";
      const own = blockKey === "record.amount" ? rb.amount : rb.services;
      return (
        <PreviewFrame
          state={gone ? "hidden" : pricesGone ? "read" : levelState(own)}
          caption={pricesGone ? "Услуги видит, цен нет" : undefined}
          captionOff={pricesGone}
        >
          <ServicesBlock
            lines={SAMPLE_SERVICES}
            total={SAMPLE_TOTAL}
            custom={false}
            discountAmount={0}
            showMoney={rb.amount !== "hidden"}
            onPickServices={on(rb.services === "write")}
            onOpenTotal={on(rb.amount === "write")}
          />
        </PreviewFrame>
      );
    }
    case "record.payment":
      return (
        <PreviewFrame state={levelState(rb.payment)}>
          <PaymentPreview write={rb.payment === "write"} />
        </PreviewFrame>
      );
    case "record.status":
      return (
        <PreviewFrame state={levelState(rb.status)}>
          <SectionCard title="Заметка">
            <InlineNoteField
              note={NOTE}
              placeholder="Заметка записи"
              accessibilityLabel="Заметка записи"
              readOnly={rb.note !== "write"}
            />
          </SectionCard>
        </PreviewFrame>
      );
    case "record.files":
      return (
        <PreviewFrame state={levelState(rb.files)}>
          <SectionCard title="Файлы">
            <View style={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 10, gap: 8 }}>
              <DocumentPill icon={FileText} title="Акт работ" onOpen={noop} />
              <DocumentPill icon={ImageIcon} title="Фото до работ" onOpen={noop} />
            </View>
            {rb.files === "write" ? (
              <ChooseRow compact icon={Paperclip} label="Добавить файл" onPress={noop} />
            ) : null}
          </SectionCard>
        </PreviewFrame>
      );
    default:
      return null;
  }
}

/** Блок «Оплата» — плитки счетов команды. Кто принимает оплату, видит их
 *  живыми; кто только смотрит — видит, чем уже заплачено. */
function PaymentPreview({ write }: { write: boolean }) {
  const width = useTileWidth(3);
  const tiles = [
    { label: "Наличные", icon: Banknote, color: SETTINGS_TILE.green, paid: true },
    { label: "Карта", icon: CreditCard, color: SETTINGS_TILE.blue, paid: false },
    { label: "Банк", icon: Landmark, color: SETTINGS_TILE.indigo, paid: false },
  ];
  return (
    <SectionCard title="Оплата">
      <View
        className="flex-row flex-wrap"
        style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10, gap: TILE_GAP }}
      >
        {tiles.map((tile) => (
          <PaymentTile
            key={tile.label}
            icon={tile.icon}
            label={tile.label}
            color={tile.color}
            tint={tile.color}
            width={width}
            compact
            state={tile.paid ? "paid" : write ? "idle" : "dim"}
            amount={tile.paid ? "€120" : undefined}
            onPress={noop}
            accessibilityLabel={tile.label}
          />
        ))}
      </View>
    </SectionCard>
  );
}

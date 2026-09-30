import { View } from "react-native";
import {
  Bookmark,
  CalendarCheck,
  FileText,
  ImageIcon,
  Landmark,
  Paperclip,
  ReceiptText,
  Tag,
  UserPlus,
  Wallet,
} from "lucide-react-native";

import { ChooseRow } from "@/components/ui/ChooseRow";
import { SectionCard } from "@/components/ui/SectionCard";
import { SelectList, SelectRow } from "@/components/ui/select-rows";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { DocumentPill } from "@/features/appointments/AppointmentFileTiles";
import { InlineNoteField } from "@/features/appointments/InlineNoteField";
import { IdentityCard } from "@/features/appointments/TeamLabelRow";
import { ObjectRow } from "@/features/clients/blocks/ObjectsBlock";

import type { AccessLevel } from "../access-map";
import { PreviewFrame, levelState } from "./PreviewFrame";
import { CLIENT_CARD_PREVIEW_KEYS } from "./preview-keys";
import { SAMPLE_LOCATION } from "./preview-sample";

// ВИД БЛОКОВ КАРТОЧКИ КЛИЕНТА В ШТОРКЕ ПРАВА (владелец 30.09: «страница
// клиентов по правам — полностью»). Те же куски, что на карточке и в записи
// (`InlineNoteField`, `ObjectRow`, плитки метки и тега, файлы), с примерными
// данными. «Меняет» блока работает только при «Меняет» у «Карточек клиентов»
// этой команды — так и рисуем: карточка только видит — блок без дверей.

const noop = () => {};

const NOTE = {
  draft: "Код домофона 12, собака во дворе",
  setDraft: noop,
  onFocus: noop,
  onBlur: noop,
};

export function ClientCardPreview({
  blockKey,
  levels,
}: {
  blockKey: string;
  levels: Readonly<Record<string, AccessLevel>>;
}) {
  if (!CLIENT_CARD_PREVIEW_KEYS.includes(blockKey)) return null;
  const card = levels.clients ?? "off";
  const own = levels[blockKey] ?? "off";
  // Карточки закрыты — блоков у него нет вовсе.
  const level: AccessLevel = card === "off" ? "off" : own === "write" && card !== "write" ? "read" : own;
  const write = level === "write";
  const on = write ? noop : undefined;
  const state = levelState(level);

  switch (blockKey) {
    case "clients.note":
      return (
        <PreviewFrame state={state}>
          <SectionCard title="Заметка">
            <InlineNoteField
              note={NOTE}
              placeholder="Заметка клиента"
              accessibilityLabel="Заметка клиента"
              readOnly={!write}
            />
          </SectionCard>
        </PreviewFrame>
      );
    case "clients.people":
      return (
        <PreviewFrame state={state} caption={state === "hidden" ? undefined : "Люди — без их номеров"}>
          <SectionCard title="Люди">
            <SelectList>
              <SelectRow title="Мария Спиру" subtitle="Жена" initial="М" onPress={noop} />
              <SelectRow title="Андреас" subtitle="Жилец" initial="А" onPress={noop} />
            </SelectList>
            {write ? <ChooseRow compact icon={UserPlus} label="Добавить человека" onPress={noop} /> : null}
          </SectionCard>
        </PreviewFrame>
      );
    case "clients.objects":
      return (
        <PreviewFrame state={state}>
          <SectionCard title="Объекты">
            <ObjectRow loc={SAMPLE_LOCATION} showNote={false} onPress={noop} />
          </SectionCard>
        </PreviewFrame>
      );
    case "clients.labels":
      return (
        <PreviewFrame state={state}>
          <View className="mx-4 mt-2" style={{ flexDirection: "row", gap: 8 }}>
            <IdentityCard
              icon={Bookmark}
              color={SETTINGS_TILE.teal}
              title="Метка 1"
              onPress={on}
              accessibilityLabel="Метка: Метка 1"
              accessibilityHint="Открывает выбор метки"
            />
            <IdentityCard
              icon={Tag}
              color={SETTINGS_TILE.purple}
              title="Тег 1"
              onPress={on}
              accessibilityLabel="Тег: Тег 1"
              accessibilityHint="Открывает выбор тега"
            />
          </View>
        </PreviewFrame>
      );
    case "clients.personal":
      return (
        <PreviewFrame state={state}>
          <SectionCard title="Личное">
            <SelectList>
              <SelectRow title="День рождения" value="12 мая" onPress={noop} />
              <SelectRow title="Язык" value="Русский" onPress={noop} />
              <SelectRow title="Откуда пришёл" value="Google Maps" onPress={noop} />
            </SelectList>
          </SectionCard>
        </PreviewFrame>
      );
    case "clients.files":
      return (
        <PreviewFrame state={state}>
          <SectionCard title="Файлы">
            <View style={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 10, gap: 8 }}>
              <DocumentPill icon={FileText} title="Договор" onOpen={noop} />
              <DocumentPill icon={ImageIcon} title="Фото объекта" onOpen={noop} />
            </View>
            {write ? <ChooseRow compact icon={Paperclip} label="Добавить файл" onPress={noop} /> : null}
          </SectionCard>
        </PreviewFrame>
      );
    case "clients.requisites":
      return (
        <PreviewFrame state={state}>
          <SectionCard title="Реквизиты">
            <SelectList>
              <SelectRow
                icon={Landmark}
                color={SETTINGS_TILE.indigo}
                title="Компания 1 Ltd"
                subtitle="VAT CY10000000X · Лимассол"
                onPress={noop}
              />
            </SelectList>
          </SectionCard>
        </PreviewFrame>
      );
    case "clients.history":
      return (
        <PreviewFrame state={state}>
          <SectionCard title="История">
            <SelectList>
              <SelectRow icon={CalendarCheck} color={SETTINGS_TILE.blue} title="12 сентября" subtitle="Чистка кондиционера" onPress={noop} />
              <SelectRow icon={CalendarCheck} color={SETTINGS_TILE.blue} title="3 августа" subtitle="Ремонт" onPress={noop} />
            </SelectList>
          </SectionCard>
        </PreviewFrame>
      );
    case "clients.money":
      return (
        <PreviewFrame state={state}>
          <SectionCard title="Долг и деньги">
            <SelectList>
              <SelectRow icon={Wallet} color={SETTINGS_TILE.orange} title="Долг" value="€30" onPress={noop} />
              <SelectRow icon={ReceiptText} color={SETTINGS_TILE.green} title="Инвойс 12" value="€120" onPress={noop} />
            </SelectList>
          </SectionCard>
        </PreviewFrame>
      );
    default:
      return null;
  }
}

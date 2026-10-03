import { Text, View } from "react-native";
import {
  Bookmark,
  Building2,
  Cake,
  CalendarCheck,
  MapPin,
  FileText,
  MessageSquare,
  Phone,
  ReceiptText,
  Send,
  Tag,
  UserPlus,
  Wallet,
} from "lucide-react-native";

import { ChooseRow } from "@/components/ui/ChooseRow";
import { SectionCard } from "@/components/ui/SectionCard";
import { SelectList, SelectRow } from "@/components/ui/select-rows";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { InlineNoteField } from "@/features/appointments/InlineNoteField";
import { IdentityCard } from "@/features/appointments/TeamLabelRow";
import { ObjectRow } from "@/features/clients/blocks/ObjectsBlock";
import { VisitDayHeader } from "@/features/clients/VisitRow";
import { useThemeColors } from "@/theme/colors";

import type { AccessLevel } from "../access-map";
import { PreviewFrame, levelState } from "./PreviewFrame";
import { CLIENT_CARD_PREVIEW_KEYS } from "./preview-keys";
import { SAMPLE_LOCATION } from "./preview-sample";

// ВИД БЛОКОВ КАРТОЧКИ КЛИЕНТА В ШТОРКЕ ПРАВА (владелец 30.09: «страница
// клиентов по правам — полностью»). Те же куски, что на карточке и в записи
// (`InlineNoteField`, `ObjectRow`, плитки метки и тега, файлы), с примерными
// данными. «Меняет» блока работает само по себе (02.10): у базы партнёра
// только «Видит», а блок с «Меняет» правится — так и рисуем.

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
  const t = useThemeColors();
  if (!CLIENT_CARD_PREVIEW_KEYS.includes(blockKey)) return null;
  const card = levels.clients ?? "off";
  const own = levels[blockKey] ?? "off";
  // Карточки закрыты — блоков у него нет вовсе.
  const level: AccessLevel = card === "off" ? "off" : own;
  const write = level === "write";
  const on = write ? noop : undefined;
  const state = levelState(level);
  // Сумма справа — цветом, как в «Истории» и «Файлах» (03.10).
  const amount = (text: string, color: string) => (
    <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 15, fontWeight: "700", color, fontVariant: ["tabular-nums"] }}>
      {text}
    </Text>
  );

  switch (blockKey) {
    // Блоки «Клиент», «История», «SMS» (02.10) — как на странице клиента.
    case "clients.client":
      return (
        <PreviewFrame
          state={levelState(card === "off" ? "off" : own === "off" ? "read" : own)}
          caption={card === "off" ? undefined : own === "off" ? "Только имя — номера нет" : undefined}
        >
          <SectionCard title="Клиент">
            <SelectList>
              <SelectRow title="Анна Петрова" initial="А" onPress={noop} />
              {own !== "off" ? (
                <SelectRow icon={Phone} color={SETTINGS_TILE.green} title="Телефон" subtitle="+357 99 123 456" onPress={noop} />
              ) : null}
            </SelectList>
          </SectionCard>
        </PreviewFrame>
      );
    case "clients.history":
      return (
        <PreviewFrame state={state}>
          {/* Как на карточке (03.10): последняя запись под днём — плашкой. */}
          <SectionCard title="История">
            <VisitDayHeader date="2026-09-12" />
            <View style={{ paddingHorizontal: 2, paddingBottom: 6 }}>
              <SelectRow
                icon={CalendarCheck}
                color={SETTINGS_TILE.blue}
                plain
                title="Команда 1"
                subtitle="10:00"
                trailing={amount("€120", t.success)}
                onPress={noop}
              />
            </View>
          </SectionCard>
        </PreviewFrame>
      );
    case "clients.sms":
      return (
        <PreviewFrame state={state}>
          <SectionCard title="SMS">
            <SelectList>
              <SelectRow
                icon={MessageSquare}
                color={SETTINGS_TILE.green}
                title="Напоминание о записи"
                subtitle="Доставлено · 12 сентября"
                onPress={noop}
              />
            </SelectList>
            {write ? <ChooseRow compact icon={Send} label="Отправить SMS" onPress={noop} /> : null}
          </SectionCard>
        </PreviewFrame>
      );
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
          {/* Как на карточке (03.10): «День рождения | Источник» плитками. */}
          <View className="mx-4 mt-2" style={{ flexDirection: "row", gap: 8 }}>
            <IdentityCard
              icon={Cake}
              color={SETTINGS_TILE.red}
              title="12 мая"
              onPress={on}
              accessibilityLabel="День рождения: 12 мая"
              accessibilityHint="Открывает выбор даты"
            />
            <IdentityCard
              icon={MapPin}
              color={SETTINGS_TILE.orange}
              title="Google Maps"
              onPress={on}
              accessibilityLabel="Источник: Google Maps"
              accessibilityHint="Открывает выбор источника"
            />
          </View>
        </PreviewFrame>
      );
    case "clients.files":
      return (
        <PreviewFrame state={state}>
          {/* Как на карточке (03.10): последний файл под днём — плашкой. */}
          <SectionCard title="Файлы">
            <VisitDayHeader date="2026-09-20" />
            <View style={{ paddingHorizontal: 2, paddingBottom: 6 }}>
              <SelectRow icon={FileText} color={t.accent} plain title="Договор" subtitle="10:15 · 340,1 КБ" onPress={noop} />
            </View>
          </SectionCard>
        </PreviewFrame>
      );
    case "clients.requisites":
      return (
        <PreviewFrame state={state}>
          {/* Как на карточке (03.10): основной набор — плашкой. */}
          <SectionCard title="Реквизиты">
            <View style={{ paddingHorizontal: 2, paddingTop: 2, paddingBottom: 6 }}>
              <SelectRow
                icon={Building2}
                color={t.accent}
                plain
                title="Компания 1 Ltd"
                subtitle="VAT CY10000000X"
                hint="Лимассол"
                onPress={noop}
              />
            </View>
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

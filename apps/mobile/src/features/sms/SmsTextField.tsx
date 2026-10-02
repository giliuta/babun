import { useMemo, useState } from "react";
import { Text, TextInput, View } from "react-native";
import type { LucideIcon } from "lucide-react-native";
import { Braces, Building2, Calendar, CalendarDays, Clock, Euro, Link, MapPin, User, Users, Wallet, Wrench } from "lucide-react-native";
import { analyzeSmsEncoding } from "@babun/shared/local/sms-encoding";
import { AVAILABLE_TOKENS, renderTemplate } from "@babun/shared/local/sms-templates";
import { formatDateKey } from "@babun/shared/common/utils/date-utils";
import { ChooseRow } from "@/components/ui/ChooseRow";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { SelectList, SelectRow } from "@/components/ui/select-rows";
import { GUTTER } from "@/components/ui/tokens";
import { haptics } from "@/lib/haptics";
import { SectionCard } from "@/components/ui/SectionCard";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { useTenant } from "@/features/settings/tenant";
import { useThemeColors } from "@/theme/colors";
import { acceptSmsInput, MAX_SMS_PARTS, smsVars } from "./sms-compose";

// ТЕКСТ ШАБЛОНА SMS — БЛОК ШТОРКИ ШАБЛОНА (STORY-089, 02.10).
// Поле, под ним сколько знаков и SMS, и дверь «Вставить поле»: шторка выбора
// с «Применить» (как «Когда отправлять», владелец 03.10); у каждого поля
// значок, цвет и имя — без примера под ним; поле встаёт туда, где курсор.
// Ряда фишек больше нет (владелец 02.10: «вот это тоже нужно как-то
// изменить»), блока «Клиент увидит» и подсказок тоже (03.10: «не надо, и так
// понятно… не ставь вообще подсказки»).

/** Значок и цвет поля — в шторке «Вставить поле». */
const TOKEN_LOOK: Record<string, { icon: LucideIcon; color: string }> = {
  "[Имя]": { icon: User, color: SETTINGS_TILE.blue },
  "[День]": { icon: CalendarDays, color: SETTINGS_TILE.indigo },
  "[Дата]": { icon: Calendar, color: SETTINGS_TILE.indigo },
  "[Время]": { icon: Clock, color: SETTINGS_TILE.orange },
  "[Мастер]": { icon: Users, color: SETTINGS_TILE.teal },
  "[Услуга]": { icon: Wrench, color: SETTINGS_TILE.green },
  "[Адрес]": { icon: MapPin, color: SETTINGS_TILE.red },
  "[Цена]": { icon: Euro, color: SETTINGS_TILE.green },
  "[Сумма]": { icon: Wallet, color: SETTINGS_TILE.red },
  "[Компания]": { icon: Building2, color: SETTINGS_TILE.blue },
  "[Ссылка]": { icon: Link, color: SETTINGS_TILE.purple },
};

/** «ВСТАВИТЬ ПОЛЕ» — та же шторка, что «Когда отправлять» (владелец 03.10:
 *  «это то же самое, но сделай более аккуратно»): все поля видны, тап
 *  отмечает, «Применить» вставляет. */
function InsertFieldSheet({
  visible,
  onClose,
  onApply,
}: {
  visible: boolean;
  onClose: () => void;
  onApply: (token: string) => void;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const [wasVisible, setWasVisible] = useState(false);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) setPicked(null);
  }
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Вставить поле"
      padded={false}
      scroll
      maxHeightRatio={0.9}
      footer={
        <View style={{ paddingHorizontal: GUTTER }}>
          <Button
            label="Применить"
            disabled={!picked}
            onPress={() => {
              if (!picked) return;
              onApply(picked);
              onClose();
            }}
          />
        </View>
      }
    >
      <SelectList>
        {AVAILABLE_TOKENS.map(({ token, label }) => {
          const look = TOKEN_LOOK[token] ?? { icon: Braces, color: SETTINGS_TILE.blue };
          return (
            <SelectRow
              key={token}
              icon={look.icon}
              color={look.color}
              title={label}
              selected={picked === token}
              accessibilityRole="radio"
              onPress={() => {
                haptics.tap();
                setPicked(token);
              }}
            />
          );
        })}
      </SelectList>
    </BottomSheet>
  );
}

/** Пример записи — по нему считается, сколько SMS выйдет с подставленными
 *  полями: завтрашняя запись, как клиент прочтёт её в жизни. */
function sampleVars(company: string) {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return smsVars({
    name: "Анна",
    date: formatDateKey(tomorrow),
    time: "10:00",
    calendar: "Бригада 1",
    services: ["Чистка кондиционера"],
    address: "Лимассол, Arch. Makariou 5",
    total: 80,
    debt: 40,
    company,
    link: "babun.app/r/Ab3dE5fG7hJ9",
  });
}

/** Текст с подставленным примером и его счёт частей. */
export function useSmsPreview(value: string) {
  // Имя своей компании — пример «Компания» читался как пустое поле.
  const company = useTenant().data?.name?.trim() || "Ваша компания";
  const sample = useMemo(() => sampleVars(company), [company]);
  const preview = value.trim() ? renderTemplate(value, sample) : "";
  return { sample, preview, encoding: analyzeSmsEncoding(preview) };
}

export function SmsTextBlock({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const t = useThemeColors();
  const { sample, preview, encoding } = useSmsPreview(value);
  // Где стоит курсор. `null` — человек его ещё не ставил: поле встаёт в конец.
  const [cursor, setCursor] = useState<number | null>(null);
  const [insertOpen, setInsertOpen] = useState(false);

  const insert = (token: string) => {
    const at = cursor == null ? value.length : Math.min(cursor, value.length);
    // Токен не липнет к слову: пробел ставится, только если его нет рядом.
    const before = at > 0 && !/\s$/.test(value.slice(0, at)) ? " " : "";
    const next = value.slice(0, at) + before + token + value.slice(at);
    // Сверх 3 SMS поле не встаёт — то же правило, что у набора.
    const accepted = acceptSmsInput(next, value, (x) => renderTemplate(x, sample));
    onChange(accepted);
    if (accepted === next) setCursor(at + before.length + token.length);
  };

  return (
    <>
      <SectionCard title="Текст">
        <View
          style={{
            marginHorizontal: 12,
            marginTop: 2,
            paddingHorizontal: 12,
            paddingVertical: 9,
            borderRadius: t.radius.input,
            backgroundColor: t.fill,
          }}
        >
          <TextInput
            value={value}
            // Без эмодзи и не длиннее 3 SMS с подставленными полями.
            onChangeText={(next) => onChange(acceptSmsInput(next, value, (x) => renderTemplate(x, sample)))}
            onSelectionChange={(e) => setCursor(e.nativeEvent.selection.start)}
            placeholder="Текст SMS"
            placeholderTextColor={t.placeholder}
            selectionColor={t.accent}
            keyboardAppearance="light"
            multiline
            maxLength={1000}
            accessibilityLabel="Текст SMS"
            maxFontSizeMultiplier={1.3}
            style={{
              minHeight: 84,
              maxHeight: 180,
              paddingTop: 0,
              paddingBottom: 0,
              textAlignVertical: "top",
              fontSize: 15,
              lineHeight: 21,
              color: t.ink,
            }}
          />
        </View>
        <Text
          maxFontSizeMultiplier={1.2}
          style={{
            marginHorizontal: 16,
            marginTop: 6,
            fontSize: 13,
            color: encoding.segments > 1 ? t.warning : t.sub,
            fontVariant: ["tabular-nums"],
          }}
        >
          {preview
            ? `${encoding.length} знаков · ${encoding.segments} SMS${encoding.segments >= MAX_SMS_PARTS ? " — предел" : ""}`
            : "До 70 знаков — 1 SMS"}
        </Text>
        <ChooseRow
          icon={Braces}
          label="Вставить поле"
          hint="Имя, дата, время, адрес…"
          compact
          onPress={() => setInsertOpen(true)}
        />
      </SectionCard>

      <InsertFieldSheet
        visible={insertOpen}
        onClose={() => setInsertOpen(false)}
        onApply={insert}
      />
    </>
  );
}

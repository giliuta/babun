// PersonalBlock (mobile port of apps/web/.../blocks/PersonalBlock.tsx)
// STORY-034 — Личное: Метка · ДР · Email · Язык. Reference data for
// SMS templates and birthday reminders; nothing here drives behavior
// except birthday → stats.birthdayInDays (badge «ДР на неделе»), which
// is why the date goes through OptionalDateField, not free text.
// «Метка» («Тихий лист 2», 2026-07-22) — бывший свободный «Город»: теперь
// строго из библиотеки Кабинета через LabelPickerSheet; ручной выбор
// ставит city_manual (автоприсвоение из метки дня её не трогает).
// Collapsed by default (CollapsibleCard) — the closed row shows
// «{город} · ДР {дата}». Presentational only — receives client +
// update(), persists via the composer's Supabase mutation.

import { useEffect, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { ChevronRight } from "lucide-react-native";
import { CLIENT_LANGUAGES, type Client } from "@babun/shared/local/clients";
import { getAvatarColor } from "@babun/shared/common/utils/avatar-color";
import { Chip } from "@/components/ui/Chip";
import { LabelTag } from "@/components/ui/LabelTag";
import { CollapsibleCard } from "@/features/clients/card-collapse";
import { formatShortDateRu } from "@/features/clients/format";
import { LabelPickerSheet } from "@/features/clients/LabelPickerSheet";
import {
  normalizeYMD,
  OptionalDateField,
} from "@/features/clients/OptionalDateField";
import { useCities } from "@/features/reference/queries";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

interface PersonalBlockProps {
  client: Client;
  update: (patch: Partial<Client>) => void;
}

// Tap-to-edit text field, saves on blur (matches the [id].tsx pattern).
function EditableField({
  value,
  onSave,
  placeholder,
  keyboardType,
}: {
  value: string;
  onSave: (v: string) => void;
  placeholder?: string;
  keyboardType?: "default" | "email-address";
}) {
  const t = useThemeColors();
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <TextInput
      value={draft}
      accessibilityLabel={placeholder}
      onChangeText={setDraft}
      onBlur={() => {
        if (draft.trim() !== value) onSave(draft.trim());
      }}
      placeholder={placeholder}
      placeholderTextColor={t.placeholder}
      keyboardType={keyboardType}
      autoCapitalize={keyboardType === "email-address" ? "none" : "sentences"}
      selectionColor={t.accent}
      keyboardAppearance="light"
      className="h-11 flex-1 rounded-lg px-2 text-[13px]"
      style={{
        backgroundColor: t.fill,
        color: t.ink,
      }}
    />
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  const t = useThemeColors();
  return (
    <View className="flex-row items-center gap-2">
      <Text className="w-28 shrink-0 text-xs" style={{ color: t.sub }}>{label}</Text>
      {children}
    </View>
  );
}

export function PersonalBlock({ client, update }: PersonalBlockProps) {
  const t = useThemeColors();
  const { data: cities = [] } = useCities();
  const [pickerOpen, setPickerOpen] = useState(false);
  // Collapsed-row summary: «Пафос · ДР 14 мар» — only what's filled.
  const summary = [
    client.city || null,
    client.birthday ? `ДР ${formatShortDateRu(client.birthday) || client.birthday}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const label = client.city.trim();
  const labelColor =
    cities.find((c) => c.name === label)?.color ?? getAvatarColor(label);

  return (
    <CollapsibleCard title="Личное" summary={summary}>
      <View className="gap-2.5 px-1 pt-1">
        {/* Метка — из библиотеки Кабинета (тот же корешок, что на днях
            календаря). Свободного ввода нет: тап открывает пикер. */}
        <Row label="Метка">
          <Pressable
            onPress={() => {
              haptics.tap();
              setPickerOpen(true);
            }}
            accessibilityRole="button"
            accessibilityLabel={
              label ? `Метка: ${label}, изменить` : "Выбрать метку"
            }
            className="h-11 flex-1 flex-row items-center justify-between rounded-lg px-2 active:opacity-70"
            style={{ backgroundColor: t.fill }}
          >
            {label ? (
              <LabelTag color={labelColor} text={label} lg />
            ) : (
              <Text
                maxFontSizeMultiplier={1.3}
                className="text-[13px]"
                style={{ color: t.placeholder }}
              >
                Выбрать метку
              </Text>
            )}
            <ChevronRight color={t.faint} size={16} strokeWidth={2.2} />
          </Pressable>
        </Row>
        <Row label="День рождения">
          {/* Native compact date picker (OptionalDateField, как даты ТО в
              ObjectsBlock) — свободный «ГГГГ-ММ-ДД» кормил мусором
              birthdayInDays и бейдж «ДР на неделе». */}
          <OptionalDateField
            value={normalizeYMD(client.birthday)}
            onChange={(v) => update({ birthday: v })}
          />
        </Row>
        <Row label="Email">
          <EditableField
            value={client.email}
            onSave={(v) => update({ email: v })}
            placeholder="email@example.com"
            keyboardType="email-address"
          />
        </Row>
        <Row label="Язык">
          <View className="flex-1 flex-row flex-wrap gap-1">
            {CLIENT_LANGUAGES.map((l) => {
              const active = (client.language ?? "") === l.value;
              return (
                <Chip
                  key={l.value}
                  label={l.short}
                  selected={active}
                  onPress={() => update({ language: active ? "" : l.value })}
                />
              );
            })}
          </View>
        </Row>
      </View>

      <LabelPickerSheet
        visible={pickerOpen}
        current={client.city}
        onSelect={(name) => update({ city: name, city_manual: true })}
        onClear={() => update({ city: "", city_manual: false })}
        onClose={() => setPickerOpen(false)}
      />
    </CollapsibleCard>
  );
}

export default PersonalBlock;

// PersonalBlock (mobile port of apps/web/.../blocks/PersonalBlock.tsx)
// STORY-034 — Личное: Город · ДР · Email · Язык. Reference data for
// SMS templates and birthday reminders; nothing here drives behavior
// except birthday → stats.birthdayInDays (badge «ДР на неделе»), which
// is why the date goes through OptionalDateField, not free text.
// Collapsed by default (CollapsibleCard) — the closed row shows
// «{город} · ДР {дата}». Presentational only — receives client +
// update(), persists via the composer's Supabase mutation.

import { useEffect, useState } from "react";
import { Text, TextInput, View } from "react-native";
import type { Client } from "@babun/shared/local/clients";
import { Chip } from "@/components/ui/Chip";
import { CollapsibleCard } from "@/features/clients/card-collapse";
import { formatShortDateRu } from "@/features/clients/format";
import {
  normalizeYMD,
  OptionalDateField,
} from "@/features/clients/OptionalDateField";
import { useThemeColors } from "@/theme/colors";

interface PersonalBlockProps {
  client: Client;
  update: (patch: Partial<Client>) => void;
}

const LANG_OPTIONS: { value: string; label: string; flag: string }[] = [
  { value: "ru", label: "RU", flag: "🇷🇺" },
  { value: "en", label: "EN", flag: "🇬🇧" },
  { value: "el", label: "EL", flag: "🇬🇷" },
];

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
      onChangeText={setDraft}
      onBlur={() => {
        if (draft.trim() !== value) onSave(draft.trim());
      }}
      placeholder={placeholder}
      placeholderTextColor={t.placeholder}
      keyboardType={keyboardType}
      autoCapitalize={keyboardType === "email-address" ? "none" : "sentences"}
      selectionColor={t.accent}
      keyboardAppearance={t.dark ? "dark" : "light"}
      className="h-9 flex-1 rounded-lg px-2 text-[13px]"
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

  // Collapsed-row summary: «Пафос · ДР 14 мар» — only what's filled.
  const summary = [
    client.city || null,
    client.birthday ? `ДР ${formatShortDateRu(client.birthday) || client.birthday}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <CollapsibleCard title="Личное" summary={summary}>
      <View className="gap-2.5 px-1 pt-1">
        <Row label="Город">
          <EditableField
            value={client.city}
            onSave={(v) => update({ city: v })}
            placeholder="Пафос"
          />
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
            {LANG_OPTIONS.map((l) => {
              const active = (client.language ?? "") === l.value;
              return (
                <Chip
                  key={l.value}
                  label={`${l.flag} ${l.label}`}
                  selected={active}
                  onPress={() => update({ language: active ? "" : l.value })}
                />
              );
            })}
          </View>
        </Row>
      </View>
    </CollapsibleCard>
  );
}

export default PersonalBlock;

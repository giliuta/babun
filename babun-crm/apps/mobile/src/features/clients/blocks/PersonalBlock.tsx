// PersonalBlock (mobile port of apps/web/.../blocks/PersonalBlock.tsx)
// STORY-034 — Личное: Город · ДР · Email · Язык. Reference data for
// SMS templates and birthday reminders; nothing here drives behavior.
// Collapsed by default (CollapsibleCard) — the closed row shows
// «{город} · ДР {дата}». Presentational only — receives client +
// update(), persists via the composer's Supabase mutation.

import { useEffect, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import type { Client } from "@babun/shared/local/clients";
import { CollapsibleCard } from "@/features/clients/card-collapse";
import { formatShortDateRu } from "@/features/clients/format";
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
  keyboardType?: "default" | "email-address" | "numbers-and-punctuation";
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
        backgroundColor: t.dark ? "rgba(255,255,255,0.07)" : "#eef1f5",
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
          {/* No native date picker dependency assumed — plain YYYY-MM-DD
              text input, matching the [id].tsx birthday field. */}
          <EditableField
            value={client.birthday}
            onSave={(v) => update({ birthday: v })}
            placeholder="ГГГГ-ММ-ДД"
            keyboardType="numbers-and-punctuation"
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
          <View className="flex-1 flex-row gap-1">
            {LANG_OPTIONS.map((l) => {
              const active = (client.language ?? "") === l.value;
              return (
                <Pressable
                  key={l.value}
                  onPress={() => update({ language: active ? "" : l.value })}
                  className="h-7 items-center justify-center rounded-full px-2.5 active:opacity-60"
                  style={{
                    backgroundColor: active
                      ? t.accent
                      : t.dark
                      ? "rgba(255,255,255,0.07)"
                      : "#eef1f5",
                  }}
                >
                  <Text
                    className="text-xs font-semibold"
                    style={{ color: active ? "#fff" : t.sub }}
                  >
                    {l.flag} {l.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Row>
      </View>
    </CollapsibleCard>
  );
}

export default PersonalBlock;

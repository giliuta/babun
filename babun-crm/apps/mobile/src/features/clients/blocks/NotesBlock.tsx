// ЗАМЕТКИ о клиенте — датированный журнал: звонки, встречи, наблюдения.
//
// Переведён на ЗАКОН СТРОКИ (2026-07-26): строка ввода того же вида, что
// остальные поля страницы, и по одной строке на заметку. Было: серая пилюля с
// кнопкой «Добавить» рядом, заглушка «Пусто» курсивом и янтарные плашки с
// рамками — янтарь в продукте означает «долг / пора обслуживать», а не
// «кто-то что-то записал».
//
// Заметка добавляется по Return или по «+ Записать» — той же строкой-
// действием, что «+ Добавить номер». Отдельной кнопки рядом с полем нет:
// она и создавала вторую вёрстку внутри страницы из строк.
//
// Владелец 2026-07-25: содержательные заметки принадлежат ЗАЯВКЕ, а не
// клиенту, поэтому блок стоит последним. Сам журнал не трогаем — в нём лежат
// реальные записи, и удалять их до появления заметки в заявке нельзя.

import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { X } from "lucide-react-native";
import type { Client, ClientNote } from "@babun/shared/local/clients";
import { randomUuid } from "@babun/shared/sync/uuid";
import { RowGroup } from "@/features/clients/card-rows";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

interface NotesBlockProps {
  client: Client;
  update: (patch: Partial<Client>) => Promise<boolean>;
}

export default function NotesBlock({ client, update }: NotesBlockProps) {
  const t = useThemeColors();
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const notes = client.notes ?? [];

  const submit = async () => {
    const value = text.trim();
    if (!value || saving) return;
    const note: ClientNote = {
      id: randomUuid(),
      text: value,
      created_at: new Date().toISOString(),
    };
    setSaving(true);
    try {
      const saved = await update({ notes: [note, ...notes] });
      // Набранное во время запроса не стираем.
      if (saved) setText((cur) => (cur.trim() === value ? "" : cur));
    } finally {
      setSaving(false);
    }
  };

  const remove = (id: string) => {
    haptics.tap();
    void update({ notes: notes.filter((n) => n.id !== id) });
  };

  return (
    <RowGroup title="Заметки">
      <View
        style={{
          paddingHorizontal: 16,
          paddingVertical: 10,
          minHeight: 60,
          justifyContent: "center",
        }}
      >
        <Text
          maxFontSizeMultiplier={1.2}
          style={{
            fontSize: 11,
            fontWeight: "700",
            letterSpacing: 1.2,
            textTransform: "uppercase",
            color: t.faint,
            marginBottom: 2,
          }}
        >
          Новая заметка
        </Text>
        <TextInput
          value={text}
          accessibilityLabel="Новая заметка"
          onChangeText={setText}
          onSubmitEditing={() => void submit()}
          returnKeyType="done"
          placeholder="Звонок, встреча, наблюдение"
          placeholderTextColor={t.placeholder}
          selectionColor={t.accent}
          keyboardAppearance="light"
          maxLength={500}
          maxFontSizeMultiplier={1.2}
          style={{
            padding: 0,
            fontSize: 15,
            fontWeight: "600",
            color: t.ink,
          }}
        />
      </View>

      {/* Строка-действие вместо кнопки рядом с полем — тот же приём, что
          «+ Добавить номер». Пока писать нечего, она пригашена. */}
      <Pressable
        onPress={() => void submit()}
        disabled={!text.trim() || saving}
        accessibilityRole="button"
        accessibilityLabel="Записать заметку"
        accessibilityState={{ disabled: !text.trim() || saving, busy: saving }}
        style={({ pressed }) => ({
          minHeight: 48,
          justifyContent: "center",
          paddingHorizontal: 16,
          opacity: text.trim() && !saving ? 1 : 0.4,
          borderTopWidth: 1,
          borderTopColor: t.separator,
          backgroundColor: pressed ? t.pressed : "transparent",
        })}
      >
        <Text
          maxFontSizeMultiplier={1.2}
          style={{ fontSize: 15, fontWeight: "600", color: t.accent }}
        >
          {saving ? "Сохраняю…" : "+ Записать"}
        </Text>
      </Pressable>

      {notes.map((n) => (
        <View
          key={n.id}
          style={{
            flexDirection: "row",
            alignItems: "flex-start",
            gap: 12,
            paddingLeft: 16,
            paddingVertical: 10,
            borderTopWidth: 1,
            borderTopColor: t.separator,
          }}
        >
          <View style={{ flex: 1 }}>
            <Text
              maxFontSizeMultiplier={1.2}
              style={{ fontSize: 11, fontWeight: "600", color: t.faint }}
            >
              {formatNoteDate(n.created_at)}
            </Text>
            <Text
              maxFontSizeMultiplier={1.3}
              style={{ fontSize: 15, color: t.ink, marginTop: 2 }}
            >
              {n.text}
            </Text>
          </View>
          <Pressable
            onPress={() => remove(n.id)}
            accessibilityRole="button"
            accessibilityLabel="Удалить заметку"
            hitSlop={8}
            style={({ pressed }) => ({
              width: 44,
              minHeight: 44,
              alignItems: "center",
              justifyContent: "center",
              opacity: pressed ? 0.5 : 1,
            })}
          >
            <X color={t.faint} size={16} strokeWidth={2.4} />
          </Pressable>
        </View>
      ))}
    </RowGroup>
  );
}

function formatNoteDate(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

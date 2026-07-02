// NotesBlock — mobile port of the web client-card Notes block
// (apps/web/src/components/clients/blocks/NotesBlock.tsx).
//
// Reference block — collapsed by default (CollapsibleCard); the closed row
// quotes the freshest note. Expanded:
// free-form dated log: calls, meetings, complaints, upsell hooks. Each
// note carries a created_at timestamp shown as «25 июн». Add prepends a
// new note; remove drops one. Persists via `update(patch)`.
//
// DEGRADED vs web: the web renders note text through <MarkdownLite>
// (**bold**, *italic*, ::red::, «- » lists). That helper is DOM-based,
// so here we render the raw text plainly. A native markdown-lite
// renderer is a follow-up if the team wants the inline styling.
//
// DROPPED vs web: the `focusToken` prop (open + focus + scrollIntoView
// driven by the hero «+ Заметка» quick action) relied on DOM refs /
// window.setTimeout / scrollIntoView. On mobile the input sits right at
// the top of the expanded card — one extra tap, no machinery.

import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { StickyNote, X } from "lucide-react-native";
import type { Client, ClientNote } from "@babun/shared/local/clients";
import { CollapsibleCard } from "@/features/clients/card-collapse";
import { useThemeColors } from "@/theme/colors";

interface NotesBlockProps {
  client: Client;
  update: (patch: Partial<Client>) => void;
}

function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export default function NotesBlock({ client, update }: NotesBlockProps) {
  const t = useThemeColors();
  const [draft, setDraft] = useState("");
  const notes = client.notes ?? [];

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    const note: ClientNote = {
      id: genId("note"),
      text,
      created_at: new Date().toISOString(),
    };
    update({ notes: [note, ...notes] });
    setDraft("");
  };

  const remove = (id: string) =>
    update({ notes: notes.filter((n) => n.id !== id) });

  // Collapsed-row summary: the freshest note, quoted (mockup: «звонить
  // после 18») — muted so the reference stack stays quiet.
  const summary = notes.length > 0 ? `«${notes[0].text}»` : "";

  return (
    <CollapsibleCard title="Заметки" summary={summary} tone="muted">
      <View className="gap-2 px-1 pt-1">
        <View className="flex-row gap-2">
          <TextInput
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={submit}
            placeholder="Записать звонок / встречу / наблюдение"
            placeholderTextColor={t.placeholder}
            selectionColor={t.accent}
            keyboardAppearance={t.dark ? "dark" : "light"}
            className="h-9 flex-1 rounded-[10px] px-3 text-[13px]"
            style={{
              backgroundColor: t.fill,
              color: t.ink,
            }}
          />
          <Pressable
            onPress={submit}
            disabled={!draft.trim()}
            className="items-center justify-center rounded-[10px] px-4"
            style={{ backgroundColor: draft.trim() ? t.accent : t.fill }}
          >
            <Text className="text-sm font-semibold" style={{ color: draft.trim() ? "#fff" : t.faint }}>Добавить</Text>
          </Pressable>
        </View>

        {notes.length === 0 ? (
          <View className="flex-row items-center gap-1.5 py-1">
            <StickyNote color={t.faint} size={12} />
            <Text className="text-[12px] italic" style={{ color: t.faint }}>Пусто</Text>
          </View>
        ) : (
          <View className="gap-1.5">
            {notes.map((n) => (
              <View
                key={n.id}
                className="flex-row items-start gap-2 rounded-lg p-2"
                style={{
                  backgroundColor: t.dark ? "rgba(234,179,8,0.12)" : "rgba(234,179,8,0.10)",
                  borderWidth: 1,
                  borderColor: t.dark ? "rgba(234,179,8,0.20)" : "rgba(234,179,8,0.25)",
                }}
              >
                <Text className="flex-1 text-[13px]" style={{ color: t.warning }}>
                  <Text className="text-[12px]" style={{ color: t.warning }}>
                    {formatNoteDate(n.created_at)}{" "}
                  </Text>
                  {n.text}
                </Text>
                <Pressable
                  onPress={() => remove(n.id)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Удалить заметку"
                  className="h-6 w-6 items-center justify-center active:opacity-60"
                >
                  <X color={t.warning} size={13} />
                </Pressable>
              </View>
            ))}
          </View>
        )}
      </View>
    </CollapsibleCard>
  );
}

function formatNoteDate(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

// ЗАМЕТКА КЛИЕНТА — ОДНО ПОЛЕ (владелец 2026-09-06: «единая заметка, которая
// автоматически сюда приходит после любого события — что нужно знать о
// клиенте; так и назвать: заметка клиента»).
//
// Раньше здесь стоял композер с датированным журналом: поле «Что важно
// помнить…», кнопка-стрелка, список записей и подсказка под ним. На странице
// записи под клиентом уже живёт поле «Заметка клиента», которое правит
// ПОСЛЕДНЮЮ запись журнала на месте (client-note-journal.ts). Карточка теперь
// показывает то же самое поле: написанное в записи видно здесь без
// пересказа, а написанное здесь — в следующей записи.
//
// Журнал под капотом остался (jsonb `notes[]`): старые записи — реальные
// данные, их не выбрасываем. Они лежат за строкой «Ранее · N»: раскрыл —
// видно дату и текст, ✕ снимает; свернул — карточка снова в одну строку.
// Импортированная заметка (`comment` из CSV) — та же заметка: без журнала она
// и есть «последняя», при первой правке переезжает в журнал одним патчем
// (два патча подряд в офлайн-кэше затирали друг друга).

import { useMemo, useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { ChevronDown, ChevronUp, X } from "lucide-react-native";
import type { Client, ClientNote } from "@babun/shared/local/clients";
import { randomUuid } from "@babun/shared/sync/uuid";
import { RowGroup } from "@/components/ui/card-rows";
import { ICON } from "@/components/ui/tokens";
import { InlineNoteField } from "@/features/appointments/InlineNoteField";
import { applyNoteEdit } from "@/features/appointments/client-note-journal";
import { useInlineNote } from "@/features/appointments/use-inline-note";
import { useJsonArrayWriter } from "@/features/clients/use-json-writer";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

interface NotesBlockProps {
  client: Client;
  update: (patch: Partial<Client>) => Promise<boolean>;
  /** Строка «Документация» — последней в этой же карточке (владелец
   *  2026-08-06: «документация пусть будет тоже в заметках»). Заметка и
   *  документ — одного рода: это то, что мы ЗНАЕМ о клиенте. */
  footerRow?: ReactNode;
}

/** Стабильная пустая ссылка: `client.notes ?? []` давал новый массив на
 *  каждый рендер и дёргал синхронизацию писателя. */
const EMPTY_NOTES: ClientNote[] = [];

/** Тот же предел, что у поля на странице записи. */
const MAX_LEN = 500;

export default function NotesBlock({
  client,
  update,
  footerRow,
}: NotesBlockProps) {
  const t = useThemeColors();
  const [earlierOpen, setEarlierOpen] = useState(false);
  const list = client.notes ?? EMPTY_NOTES;
  const imported = (client.comment ?? "").trim();
  // Журнал хранит новые первыми, но сортируем по дате: порядок массива — не закон.
  const sorted = useMemo(
    () =>
      [...list].sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [list],
  );
  const latest = sorted[0]
    ? { id: sorted[0].id as string | null, text: sorted[0].text }
    : imported
      ? { id: null, text: imported }
      : null;
  const migrateImported = list.length === 0 && imported !== "";
  const notes = useJsonArrayWriter<ClientNote>(list, (next) =>
    update(migrateImported ? { notes: next, comment: "" } : { notes: next }),
  );

  // Поле привязано к КОНКРЕТНОЙ записи журнала (ключ — её id): стёр — снялась
  // именно она; набрал заново после стирания — родилась новая.
  const write = (next: string, boundId: string | null) => {
    let createdId: string | null = null;
    void notes.apply((all) => {
      const edited = applyNoteEdit(all, next, boundId, () => ({
        id: randomUuid(),
        created_at: new Date().toISOString(),
      }));
      createdId = edited.createdId;
      return edited.notes;
    });
    return createdId ?? undefined;
  };
  const note = useInlineNote<string | null>(
    latest?.text ?? "",
    latest?.id ?? null,
    write,
    client.id,
  );

  const remove = (id: string) => {
    haptics.tap();
    void notes.apply((all) => all.filter((n) => n.id !== id));
  };

  // «Ранее» — всё, что не в поле: старые записи журнала и импортированная
  // заметка, когда журнал уже есть (без журнала она сама стоит в поле).
  const earlier = sorted.slice(1);
  const importedEarlier = sorted.length > 0 ? imported : "";
  const earlierCount = earlier.length + (importedEarlier ? 1 : 0);

  return (
    <RowGroup title="Заметка клиента">
      <InlineNoteField
        note={note}
        placeholder="Заметка клиента"
        accessibilityLabel="Заметка клиента"
        maxLength={MAX_LEN}
      />

      {earlierCount > 0 ? (
        <Pressable
          onPress={() => {
            haptics.tap();
            setEarlierOpen((v) => !v);
          }}
          accessibilityRole="button"
          accessibilityState={{ expanded: earlierOpen }}
          accessibilityLabel={`Ранее · ${earlierCount}`}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            minHeight: 44,
            paddingHorizontal: 16,
            borderTopWidth: 1,
            borderTopColor: t.separator,
            backgroundColor: pressed ? t.pressed : "transparent",
          })}
        >
          <Text
            maxFontSizeMultiplier={1.2}
            style={{ flex: 1, fontSize: 15, color: t.sub }}
          >
            {`Ранее · ${earlierCount}`}
          </Text>
          {earlierOpen ? (
            <ChevronUp color={t.faint} size={ICON.sm} strokeWidth={2.2} />
          ) : (
            <ChevronDown color={t.faint} size={ICON.sm} strokeWidth={2.2} />
          )}
        </Pressable>
      ) : null}

      {earlierOpen && importedEarlier ? (
        <EarlierRow
          caption="Из импорта"
          text={importedEarlier}
          onRemove={() => {
            haptics.tap();
            void update({ comment: "" });
          }}
          removeLabel="Удалить импортированную заметку"
        />
      ) : null}
      {earlierOpen
        ? earlier.map((n) => (
            <EarlierRow
              key={n.id}
              caption={formatNoteDate(n.created_at)}
              text={n.text}
              onRemove={() => remove(n.id)}
              removeLabel="Удалить заметку"
            />
          ))
        : null}

      {footerRow}
    </RowGroup>
  );
}

function EarlierRow({
  caption,
  text,
  onRemove,
  removeLabel,
}: {
  caption: string;
  text: string;
  onRemove: () => void;
  removeLabel: string;
}) {
  const t = useThemeColors();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 8,
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
          {caption}
        </Text>
        <Text
          maxFontSizeMultiplier={1.3}
          style={{ fontSize: 15, color: t.ink, marginTop: 2 }}
        >
          {text}
        </Text>
      </View>
      <Pressable
        onPress={onRemove}
        accessibilityRole="button"
        accessibilityLabel={removeLabel}
        hitSlop={8}
        style={({ pressed }) => ({
          width: 40,
          minHeight: 40,
          alignItems: "center",
          justifyContent: "center",
          opacity: pressed ? 0.5 : 1,
        })}
      >
        <X color={t.faint} size={16} strokeWidth={2.4} />
      </Pressable>
    </View>
  );
}

function formatNoteDate(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

// ЗАМЕТКИ о клиенте — датированный журнал: звонки, договорённости,
// особенности объекта.
//
// МИНИ-БЛОК ДЛЯ ЗАПИСИ (владелец 2026-08-06: «эту „новую заметку“ надо
// подвинуть или отредактировать, чтобы было максимально удобно — сделать как
// мини-блок, куда всё можно записывать»).
//
// БЫЛО: пустое поле-строка с капс-ярлыком «НОВАЯ ЗАМЕТКА» на всю ширину и
// отдельная строка-действие «+ Записать», пригашенная до 0.4 — она читалась
// как сломанная кнопка, а поле — как незаполненное поле формы, хотя писать в
// него нужно не всегда.
//
// СТАЛО: компактный композер — подложка с полем и круглой кнопкой отправки
// справа, как в любом мессенджере. Пока писать нечего, кнопка тихая и
// серая (а не «испорченная синяя»), поле — в одну строку; при вводе оно
// растёт до пяти строк и кнопка загорается кобальтом. Строка-действие
// исчезла: отправка живёт в самой подложке, у поля, а не отдельным этажом.
//
// Владелец 2026-07-25: содержательные заметки принадлежат ЗАЯВКЕ, а не
// клиенту, поэтому блок стоит последним. Сам журнал не трогаем — в нём лежат
// реальные записи, и удалять их до появления заметки в заявке нельзя.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { ArrowUp, X } from "lucide-react-native";
import type { Client, ClientNote } from "@babun/shared/local/clients";
import { randomUuid } from "@babun/shared/sync/uuid";
import { RowGroup } from "@/components/ui/card-rows";
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
  /** Капс-ярлык группы. `null` — без ярлыка: лист заметок из записи уже
   *  назвал себя заголовком, и второе «Заметки» под ним было бы дублем. */
  title?: string | null;
  /** Подсказка под пустым журналом. Лист из записи её выключает: туда
   *  приходят по «Добавить заметку», и объяснять, что такое заметка, незачем. */
  showHint?: boolean;
}

/** Стабильная пустая ссылка: `client.notes ?? []` давал новый массив на
 *  каждый рендер и дёргал синхронизацию писателя. */
const EMPTY_NOTES: ClientNote[] = [];

const MAX_LEN = 500;

export default function NotesBlock({
  client,
  update,
  footerRow,
  title = "Заметки",
  showHint = true,
}: NotesBlockProps) {
  const t = useThemeColors();
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  // ИМПОРТИРОВАННАЯ ЗАМЕТКА. CSV-импорт кладёт колонку «Заметка» в поле
  // `comment` (одна строка на клиента), а карточка показывает только массив
  // `notes[]` — импортировал базу с комментариями и на экране пусто. Здесь
  // одно и то же понятие, поэтому старое поле показываем в общем списке; при
  // первой правке оно само переедет в notes (кнопка «Удалить» его чистит).
  const imported = (client.comment ?? "").trim();
  const list = client.notes ?? EMPTY_NOTES;
  // Заметки — тот же jsonb-массив, что номера и объекты: пишем из свежайшего
  // значения и по очереди. Из снимка рендера два быстрых действия (удалить
  // одну + добавить другую) воскрешали удалённую или теряли новую.
  const notes = useJsonArrayWriter<ClientNote>(list, (next) =>
    update({ notes: next }),
  );

  const canSend = text.trim().length > 0 && !saving;

  const submit = async () => {
    const value = text.trim();
    if (!value || saving) return;
    const note: ClientNote = {
      id: randomUuid(),
      text: value,
      created_at: new Date().toISOString(),
    };
    setSaving(true);
    haptics.tap();
    // Поле пустеет СРАЗУ, как в любом композере: заметка уже видна списком
    // ниже. Прежде очистка ждала ответа и сверяла текст с отправленным —
    // автокоррекция iOS успевала дописать слово, сверка не сходилась, и
    // отправленная заметка оставалась висеть в поле второй раз.
    setText("");
    try {
      const saved = await notes.apply((all) => [note, ...all]);
      // Не сохранилось — возвращаем набранное, чтобы не потерять текст.
      if (!saved) setText((cur) => (cur.trim() ? cur : value));
    } catch {
      setText((cur) => (cur.trim() ? cur : value));
    } finally {
      setSaving(false);
    }
  };

  const remove = (id: string) => {
    haptics.tap();
    void notes.apply((all) => all.filter((n) => n.id !== id));
  };

  // Уход с экрана НЕ теряет набранное: «Назад» и свайп фокус не снимают, а
  // состояние композера живёт только здесь. Дописываем заметку на
  // размонтировании — тот же закон, что у строк карточки.
  const latest = useRef({ text, submit });
  latest.current = { text, submit };
  useEffect(
    () => () => {
      if (latest.current.text.trim()) void latest.current.submit();
    },
    [],
  );

  const left = MAX_LEN - text.length;

  return (
    <RowGroup title={title ?? undefined}>
      {/* КОМПОЗЕР. Поле и отправка — одна подложка: это одно действие, и
          разносить их по этажам блока незачем. */}
      <View style={{ paddingHorizontal: 12, paddingVertical: 10, gap: 6 }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "flex-end",
            gap: 8,
            paddingLeft: 14,
            paddingRight: 6,
            paddingVertical: 6,
            borderRadius: t.radius.input,
            backgroundColor: t.fill,
          }}
        >
          <TextInput
            value={text}
            accessibilityLabel="Новая заметка"
            onChangeText={setText}
            multiline
            placeholder="Что важно помнить о клиенте…"
            placeholderTextColor={t.placeholder}
            selectionColor={t.accent}
            keyboardAppearance="light"
            maxLength={MAX_LEN}
            maxFontSizeMultiplier={1.2}
            style={{
              flex: 1,
              // Одна строка в покое, до пяти — пока пишут: длинная заметка не
              // должна печататься в щёлку.
              minHeight: 32,
              maxHeight: 120,
              paddingTop: 6,
              paddingBottom: 6,
              fontSize: 15,
              color: t.ink,
            }}
          />
          <Pressable
            onPress={() => void submit()}
            disabled={!canSend}
            accessibilityRole="button"
            accessibilityLabel="Записать заметку"
            accessibilityState={{ disabled: !canSend, busy: saving }}
            hitSlop={6}
            style={({ pressed }) => ({
              width: 32,
              height: 32,
              borderRadius: 999,
              alignItems: "center",
              justifyContent: "center",
              // Пусто — тихий серый кружок, а не пригашенная синяя кнопка:
              // выключенное действие не должно выглядеть сломанным.
              backgroundColor: canSend ? t.accent : t.separator,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <ArrowUp
              color={canSend ? "#fff" : t.faint}
              size={18}
              strokeWidth={2.6}
            />
          </Pressable>
        </View>

        {/* Счётчик появляется только на подходе к пределу — постоянный
            «0/500» был бы шумом. */}
        {left <= 80 ? (
          <Text
            maxFontSizeMultiplier={1.2}
            style={{
              alignSelf: "flex-end",
              fontSize: 11,
              color: left <= 0 ? t.danger : t.faint,
            }}
          >
            {`осталось ${left}`}
          </Text>
        ) : null}
      </View>

      {list.length === 0 && !imported && showHint ? (
        <Text
          maxFontSizeMultiplier={1.2}
          style={{
            paddingHorizontal: 16,
            paddingBottom: 12,
            fontSize: 13,
            color: t.faint,
          }}
        >
          Звонки, договорённости, особенности объекта — всё, что пригодится в
          следующий раз.
        </Text>
      ) : null}

      {imported ? (
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
              Из импорта
            </Text>
            <Text
              maxFontSizeMultiplier={1.3}
              style={{ fontSize: 15, color: t.ink, marginTop: 2 }}
            >
              {imported}
            </Text>
          </View>
          <Pressable
            onPress={() => {
              haptics.tap();
              void update({ comment: "" });
            }}
            accessibilityRole="button"
            accessibilityLabel="Удалить импортированную заметку"
            hitSlop={8}
            style={({ pressed }) => ({
              paddingHorizontal: 12,
              paddingVertical: 4,
              opacity: pressed ? 0.5 : 1,
            })}
          >
            <X color={t.faint} size={16} strokeWidth={2} />
          </Pressable>
        </View>
      ) : null}

      {list.map((n) => (
        <View
          key={n.id}
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
      ))}

      {footerRow}
    </RowGroup>
  );
}

function formatNoteDate(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

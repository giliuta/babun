import { useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { UserRound } from "lucide-react-native";
import type { Client } from "@babun/shared/local/clients";
import type { ClientStats } from "@babun/shared/local/selectors/client-stats";
import { matchesClient } from "@babun/shared/local/selectors/client-search";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { GUTTER } from "@/components/ui/tokens";
import {
  SELECT_SHEET_RATIO,
  SelectList,
  SelectRow,
  SelectSearch,
} from "@/components/ui/select-rows";
import { ClientHistoryLine, clientHistoryText } from "@/features/clients/history-line";
import {
  buildQuickClientDraft,
  findQuickClientDuplicate,
} from "@/features/appointments/booking-prefill";
import { useClients } from "@/features/clients/queries";
import { haptics } from "@/lib/haptics";

// ВЫБОР КЛИЕНТА — ОДНА ШТОРКА НА ВЕСЬ ПРОДУКТ (владелец 2026-09-10: «если я
// прошу „выбрать клиента", архитектура этой шторки должна быть везде
// одинаковая… и неважно, где я это использую: в календаре, финансах,
// клиентах»).
//
// Их было ДВЕ. Одна жила в записи: недавние наверх, вводная о человеке
// строкой, «Создать клиента „набранное"», дедуп по введённому номеру. Вторая —
// в инвойсе и в «кто привёл»: заголовок нарисован своим `<Text>` в теле, поиск
// — свой второй `TextInput`, пустое состояние — голая строка «Никого не
// нашли», кружок с двумя буквами вместо одной и своим цветом. Один и тот же
// вопрос «кто клиент» задавался двумя разными способами.
//
// Осталась та, что богаче и настроена владельцем; всё, что было только у
// второй (исключить себя, «Убрать»), стало её пропами. Анатомия — общая
// (`select-rows`): заголовок в жесте грабера → поиск → строки 52pt → кнопка в
// футере вне прокрутки.

export function ClientPickerSheet({
  visible,
  title = "Клиент",
  clients: given,
  selectedId,
  excludeId,
  recentIds,
  statsById,
  onCreate,
  onSelect,
  onClear,
  clearLabel,
  onClose,
  onExited,
}: {
  visible: boolean;
  /** Чью метку правят — «Клиент», «Кто привёл», «Клиент инвойса». */
  title?: string;
  /** Готовый список. Нет — берём весь справочник сами. */
  clients?: Client[];
  selectedId?: string | null;
  /** Кого не предлагать (себя же — в «кто привёл»). */
  excludeId?: string | null;
  /** Недавние наверх: в девяти случаях из десяти записывают того, кто уже был. */
  recentIds?: string[];
  /** Долг, визиты, деньги, последний визит — вводная о человеке (владелец
   *  2026-09-04: «когда я выбираю клиента, там должна быть уже вводная
   *  информация, как это написано в клиентах»). Считает вызывающий: карта на
   *  весь список строится один раз, а не по клиенту на строку. */
  statsById?: Map<string, ClientStats>;
  /** Заводить клиента прямо отсюда. Нет обработчика — ни строки, ни кнопки:
   *  у инвойса и у «кто привёл» создавать некого. */
  onCreate?: (prefill: { name?: string; phone?: string }) => void;
  onSelect: (client: Client) => void;
  /** «Убрать» — снять уже выбранного. */
  onClear?: () => void;
  clearLabel?: string;
  onClose: () => void;
  /** Шторка ПОЛНОСТЬЮ ушла и её окно снято. Раньше этого момента другое окно —
   *  вторая шторка, карточка клиента — открыть нельзя: iOS отвечает «already
   *  presenting» и не показывает вовсе. Цепочка «клиент → услуги» ждёт именно
   *  этот сигнал. */
  onExited?: () => void;
}) {
  const { data: all = [] } = useClients();
  const clients = given ?? all;
  const [q, setQ] = useState("");
  // Что сделать, когда шторка ПОЛНОСТЬЮ уйдёт (см. `onExited`).
  const afterExit = useRef<(() => void) | null>(null);

  const pool = useMemo(
    () => clients.filter((c) => c.id !== excludeId && !c.deleted_at),
    [clients, excludeId],
  );

  const quickDraft = useMemo(() => buildQuickClientDraft(q), [q]);
  const duplicate = useMemo(
    () => findQuickClientDuplicate(pool, quickDraft.phone_e164),
    [pool, quickDraft.phone_e164],
  );

  // ПРИ ПУСТОМ ПОИСКЕ ВИДНЫ ВСЕ, А НЕ ТОЛЬКО НЕДАВНИЕ (владелец 2026-08-31:
  // «я вроде создал клиента, но он не создался — проверяй это»). Клиент
  // создавался исправно; не показывался, потому что «недавние» — это те, у
  // кого УЖЕ были записи, а у новорождённого их нет по определению.
  const rows = useMemo(() => {
    const query = q.trim();
    if (query) return pool.filter((c) => matchesClient(c, query));
    if (!recentIds?.length) {
      return [...pool].sort((a, b) =>
        (a.full_name || "").localeCompare(b.full_name || "", "ru"),
      );
    }
    const byId = new Map(pool.map((c) => [c.id, c]));
    const recent = recentIds
      .map((id) => byId.get(id))
      .filter((c): c is Client => Boolean(c));
    const seen = new Set(recent.map((c) => c.id));
    const others = pool
      .filter((c) => !seen.has(c.id))
      .sort((a, b) => (a.full_name || "").localeCompare(b.full_name || "", "ru"));
    return [...recent, ...others];
  }, [pool, q, recentIds]);

  // ПОИСК НЕ ПОМНИТ ПРОШЛЫЙ ЗАПРОС: шторка остаётся смонтированной между
  // открытиями, и набранное переживало выбор.
  const close = () => {
    setQ("");
    onClose();
  };
  const pick = (client: Client) => {
    haptics.tap();
    setQ("");
    onSelect(client);
    close();
  };

  /** Набранное в поиске и есть будущий клиент — уносим его в карточку.
   *  Найденный по номеру дубль — не создание, а выбор: два клиента на одном
   *  номере невозможны. */
  const create = () => {
    if (!onCreate) return;
    if (duplicate) {
      pick(duplicate);
      return;
    }
    const typed = q.trim();
    const prefill = !typed
      ? {}
      : quickDraft.kind === "phone"
        ? { phone: quickDraft.phone }
        : { name: quickDraft.full_name };
    afterExit.current = () => onCreate(prefill);
    close();
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={close}
      onExited={() => {
        const run = afterExit.current;
        afterExit.current = null;
        // Ушли заводить клиента — цепочке услуг здесь делать нечего: она
        // продолжится, когда человек вернётся с новым клиентом.
        if (run) {
          run();
          return;
        }
        onExited?.();
      }}
      title={title}
      padded={false}
      scroll
      avoidKeyboard
      maxHeightRatio={SELECT_SHEET_RATIO}
      footer={
        onCreate || (onClear && selectedId) ? (
          <View style={{ paddingHorizontal: GUTTER }}>
            {onCreate ? (
              <Button label="Создать клиента" onPress={create} />
            ) : null}
            {onClear && selectedId ? (
              <Button
                label={clearLabel ?? "Убрать"}
                variant="secondary"
                tone="danger"
                onPress={() => {
                  haptics.tap();
                  onClear();
                  close();
                }}
              />
            ) : null}
          </View>
        ) : undefined
      }
    >
      <SelectSearch
        value={q}
        onChange={setQ}
        placeholder="Имя или телефон"
        accessibilityLabel="Поиск клиента"
        onClear={() => setQ("")}
        autoCapitalize="words"
      />
      <SelectList>
        {rows.length > 0 ? (
          rows.map((c) => (
            <SelectRow
              key={c.id}
              title={c.full_name || "Без имени"}
              subtitle={
                statsById ? (
                  <ClientHistoryLine client={c} stats={statsById.get(c.id)} size={12} />
                ) : undefined
              }
              hint={c.phone || undefined}
              initial={c.full_name || "?"}
              selected={c.id === selectedId}
              accessibilityLabel={[
                c.full_name || "Без имени",
                c.phone,
                statsById ? clientHistoryText(c, statsById.get(c.id)) : "",
              ]
                .filter(Boolean)
                .join(", ")}
              onPress={() => pick(c)}
            />
          ))
        ) : (
          <EmptyState
            title={q.trim() ? "Клиенты не найдены" : "Клиентов пока нет"}
          />
        )}

        {/* Строка создания стоит ПОД списком и повторяет набранное: так видно,
            кого именно заведут. */}
        {onCreate && q.trim() ? (
          <SelectRow
            icon={UserRound}
            title={
              duplicate
                ? `Выбрать существующего «${
                    duplicate.full_name || duplicate.phone || q.trim()
                  }»`
                : `Создать клиента «${q.trim()}»`
            }
            onPress={create}
          />
        ) : null}
      </SelectList>
    </BottomSheet>
  );
}

export default ClientPickerSheet;

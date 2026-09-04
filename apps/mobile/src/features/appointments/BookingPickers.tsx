import { useMemo, useRef, useState } from "react";
import { useRouter } from "expo-router";
import {
  Pressable,
  Text as NativeText,
  TextInput as NativeTextInput,
  View,
  type TextInputProps,
  type TextProps,
} from "react-native";
import { Search, UserRound, X } from "lucide-react-native";
import type { Client } from "@babun/shared/local/clients";
import { formatEURExact } from "@babun/shared/common/utils/money";

import { BottomSheet } from "@/components/ui/BottomSheet";
import { Chip } from "@/components/ui/Chip";
import { EmptyState } from "@/components/ui/EmptyState";
import { ICON } from "@/components/ui/tokens";
import { GradientButton } from "@/components/ui/GradientButton";
import {
  ClientHistoryLine,
  clientHistoryText,
} from "@/features/clients/history-line";
import type { ClientStats } from "@babun/shared/local/selectors/client-stats";
import { QtyBadge } from "@/features/appointments/QtyBadge";
import { useThemeColors } from "@/theme/colors";
import type { Service } from "@/features/services/queries";
import {
  buildQuickClientDraft,
  findQuickClientDuplicate,
} from "@/features/appointments/booking-prefill";
import { ColorDot } from "@/components/ui/picker-fields";
import { isoWeekdayOf, servedOnWeekday } from "@babun/shared/local/services";
import { durationLabel } from "@/features/services/format";
import { unitPriceFor } from "@/features/appointments/helpers";
import { round2 } from "@babun/shared/local/finance/appointment-calc";

function Text({ maxFontSizeMultiplier = 1.3, ...props }: TextProps) {
  return (
    <NativeText maxFontSizeMultiplier={maxFontSizeMultiplier} {...props} />
  );
}

function TextInput({
  maxFontSizeMultiplier = 1.3,
  ...props
}: TextInputProps) {
  return (
    <NativeTextInput
      maxFontSizeMultiplier={maxFontSizeMultiplier}
      {...props}
    />
  );
}

/** «Не делаем по вторникам» — родительный падеж множественного числа: слово
 *  стоит в предложении, а не подписью в таблице. */
const OFF_DAY_WORD: Record<number, string> = {
  1: "понедельникам",
  2: "вторникам",
  3: "средам",
  4: "четвергам",
  5: "пятницам",
  6: "субботам",
  7: "воскресеньям",
};

// ВЫБОР — ШТОРКОЙ НА ПОЛЭКРАНА, А НЕ СТРАНИЦЕЙ (владелец 2026-09-04: «если
// открывается полноценная страница, услуга находится самым вверху и пальцем
// надо тянуться… а если надо выйти — тыкаю в верхнюю половину, и оно
// закрывается; мне кажется, это будет гораздо лучше»). Высоту выбрал он же,
// сравнив 50% и 75% на симуляторе: половина экрана.
//
// Отсюда и общая анатомия обеих шторок (DS §5): заголовок в жесте грабера →
// поиск → список строк 52pt на подложке → одна кнопка в футере вне прокрутки.
// Строка — тот же диалект, что у выбора объекта и клиента на карточке:
// кружок 28pt слева, имя 15/600, подпись 13, отметка справа.
const SHEET_RATIO = 0.5;
const SIDE = 20;

function SearchField({
  value,
  onChange,
  placeholder,
  accessibilityLabel,
  onClear,
  autoCapitalize,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  accessibilityLabel: string;
  onClear?: () => void;
  autoCapitalize?: "none" | "words";
}) {
  const t = useThemeColors();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        marginHorizontal: SIDE,
        marginBottom: 10,
        paddingLeft: 12,
        paddingRight: value ? 4 : 12,
        minHeight: 40,
        borderRadius: t.radius.input,
        backgroundColor: t.fill,
      }}
    >
      <Search color={t.faint} size={16} strokeWidth={2} />
      <TextInput
        keyboardAppearance="light"
        accessibilityLabel={accessibilityLabel}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={t.placeholder}
        selectionColor={t.accent}
        // Из этой же строки создаётся клиент: автозамена успевала подменить
        // набранное имя до того, как его сохранят.
        autoCorrect={false}
        spellCheck={false}
        autoCapitalize={autoCapitalize}
        style={{ flex: 1, fontSize: 15, color: t.ink }}
      />
      {value && onClear ? (
        <Pressable
          onPress={onClear}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Очистить поиск"
          style={{ width: 32, height: 32, alignItems: "center", justifyContent: "center" }}
        >
          <X color={t.placeholder} size={ICON.sm} />
        </Pressable>
      ) : null}
    </View>
  );
}

export function ClientPicker({
  visible,
  onClose,
  onExited,
  clients,
  recentIds,
  statsById,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  /** Шторка ПОЛНОСТЬЮ ушла и её окно снято. Раньше этого момента другое
   *  окно — вторая шторка, карточка клиента — открыть нельзя: iOS отвечает
   *  «already presenting» и не показывает вовсе (см. `BottomSheet.onExited`).
   *  Цепочка «клиент → услуги» ждёт именно этот сигнал. */
  onExited?: () => void;
  clients: Client[];
  recentIds: string[];
  /** Долг, визиты, деньги, последний визит — вводная о человеке (владелец
   *  2026-09-04: «когда я выбираю клиента, там должна быть уже вводная
   *  информация, как это написано в клиентах»). Считает форма: карта на весь
   *  список строится один раз, а не по клиенту на строку. */
  statsById?: Map<string, ClientStats>;
  onPick: (client: Client) => void;
}) {
  const t = useThemeColors();
  const router = useRouter();
  const [q, setQ] = useState("");
  // Что сделать, когда шторка ПОЛНОСТЬЮ уйдёт: карточка клиента — своё окно,
  // и открытая в тот же кадр она не появляется вовсе (закон `onExited`).
  const afterExit = useRef<(() => void) | null>(null);

  const digits = q.replace(/\D/g, "");
  const quickDraft = useMemo(() => buildQuickClientDraft(q), [q]);
  const duplicate = useMemo(
    () => findQuickClientDuplicate(clients, quickDraft.phone_e164),
    [clients, quickDraft.phone_e164],
  );
  // ПРИ ПУСТОМ ПОИСКЕ ВИДНЫ ВСЕ, А НЕ ТОЛЬКО НЕДАВНИЕ (владелец 2026-08-31:
  // «я вроде создал клиента, но он не создался — проверяй это»).
  //
  // Клиент создавался исправно. Не показывался: «Недавние» — это те, у кого
  // УЖЕ БЫЛИ записи, а у новорождённого их нет по определению. Недавние
  // остаются первыми: в девяти случаях из десяти записывают того, кто уже был.
  const recent = useMemo(() => {
    const byId = new Map(clients.map((c) => [c.id, c]));
    return recentIds.map((id) => byId.get(id)).filter(Boolean) as Client[];
  }, [clients, recentIds]);

  const others = useMemo(() => {
    const seen = new Set(recent.map((c) => c.id));
    return clients
      .filter((c) => !seen.has(c.id))
      .sort((a, b) => (a.full_name || "").localeCompare(b.full_name || "", "ru"));
  }, [clients, recent]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return [...recent, ...others];
    return clients.filter(
      (c) =>
        (c.full_name || "").toLowerCase().includes(query) ||
        (digits.length > 0 &&
          (c.phone || "").replace(/\D/g, "").includes(digits)),
    );
  }, [q, clients, recent, others, digits]);

  // ПОИСК НЕ ПОМНИТ ПРОШЛЫЙ ЗАПРОС: шторка остаётся смонтированной между
  // открытиями, и набранное переживало выбор.
  const close = () => {
    setQ("");
    onClose();
  };
  const pick = (client: Client) => {
    setQ("");
    onPick(client);
  };

  // СОЗДАНИЕ — ТОЛЬКО КАРТОЧКОЙ КЛИЕНТА, И ОНА ОТКРЫВАЕТСЯ ПОВЕРХ ЗАПИСИ
  // (`/book/client`, 2026-09-03). Быстрое создание одним тапом заводило
  // клиента с именем без телефона или наоборот, вопреки правилам владельца.
  // Набранное в поиске уезжает в карточку параметром.
  const openCreateForm = () => {
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
    afterExit.current = () =>
      router.push({ pathname: "/book/client", params: { id: "new", ...prefill } });
    close();
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={close}
      onExited={() => {
        const run = afterExit.current;
        afterExit.current = null;
        // Ушли заводить клиента — цепочке услуг здесь делать нечего:
        // она продолжится, когда человек вернётся с новым клиентом.
        if (run) {
          run();
          return;
        }
        onExited?.();
      }}
      title="Клиент"
      padded={false}
      scroll
      avoidKeyboard
      maxHeightRatio={SHEET_RATIO}
      footer={
        <View style={{ paddingHorizontal: SIDE }}>
          <GradientButton label="Создать клиента" onPress={openCreateForm} />
        </View>
      }
    >
      <SearchField
        value={q}
        onChange={setQ}
        placeholder="Имя или телефон"
        accessibilityLabel="Поиск клиента"
        onClear={() => setQ("")}
        autoCapitalize="words"
      />
      <View style={{ paddingHorizontal: SIDE, paddingBottom: 12, gap: 8 }}>
        {filtered.length > 0 ? (
          filtered.map((c) => (
            <Pressable
              key={c.id}
              onPress={() => pick(c)}
              accessibilityRole="button"
              accessibilityLabel={[
                c.full_name || "Без имени",
                c.phone,
                clientHistoryText(c, statsById?.get(c.id)),
              ]
                .filter(Boolean)
                .join(", ")}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                minHeight: 52,
                paddingHorizontal: 14,
                borderRadius: t.radius.input,
                backgroundColor: pressed ? t.rowFillPressed : t.rowFill,
              })}
            >
              <View
                className="items-center justify-center"
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: t.radius.pill,
                  backgroundColor: `${t.accent}1a`,
                }}
              >
                <Text style={{ fontSize: 11, fontWeight: "700", color: t.accent }}>
                  {(c.full_name || "?").slice(0, 1).toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={{ fontSize: 15, fontWeight: "600", color: t.ink }}>
                  {c.full_name || "Без имени"}
                </Text>
                <ClientHistoryLine client={c} stats={statsById?.get(c.id)} size={12} />
                {c.phone ? (
                  <Text numberOfLines={1} style={{ fontSize: 13, color: t.sub }}>
                    {c.phone}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          ))
        ) : (
          <EmptyState
            title={q.trim() ? "Клиенты не найдены" : "Клиентов пока нет"}
          />
        )}

        {/* Набранное и есть будущий клиент: строка несёт его в карточку.
            Найденный по номеру дубль — не создание, а выбор: два клиента на
            одном номере невозможны. */}
        {q.trim() ? (
          <Pressable
            onPress={openCreateForm}
            accessibilityRole="button"
            accessibilityLabel={
              duplicate
                ? `Выбрать существующего клиента ${duplicate.full_name || duplicate.phone || q.trim()}`
                : `Создать клиента ${q.trim()}`
            }
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              minHeight: 52,
              paddingHorizontal: 14,
              borderRadius: t.radius.input,
              backgroundColor: pressed ? `${t.accent}1a` : `${t.accent}0d`,
            })}
          >
            <View
              className="items-center justify-center"
              style={{
                width: 28,
                height: 28,
                borderRadius: t.radius.pill,
                backgroundColor: `${t.accent}1a`,
              }}
            >
              <UserRound color={t.accent} size={ICON.xs} />
            </View>
            <Text
              numberOfLines={1}
              style={{ flex: 1, fontSize: 15, fontWeight: "600", color: t.accent }}
            >
              {duplicate
                ? `Выбрать существующего «${
                    duplicate.full_name || duplicate.phone || q.trim()
                  }»`
                : `Создать клиента «${q.trim()}»`}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </BottomSheet>
  );
}

export function ServicePicker({
  visible,
  onClose,
  services,
  frequent,
  selectedIds,
  date,
  quantities,
  onToggle,
  onQtyChange,
}: {
  visible: boolean;
  onClose: () => void;
  services: Service[];
  frequent: Service[];
  selectedIds: string[];
  /** Дата записи «YYYY-MM-DD» — по ней виден день недели. */
  date?: string;
  onToggle: (id: string) => void;
  /** Сколько каждой услуги уже в записи. Нет ключа — ни одной. */
  quantities: Record<string, number>;
  /** Ноль убирает услугу из записи. */
  onQtyChange: (id: string, qty: number) => void;
}) {
  const t = useThemeColors();
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    const found = query
      ? services.filter((s) => s.name.toLowerCase().includes(query))
      : services;
    if (!date) return found;
    // УСЛУГА, КОТОРУЮ В ЭТОТ ДЕНЬ НЕ ДЕЛАЮТ, УЕЗЖАЕТ ВНИЗ — И ТОЛЬКО. Ни
    // спрятать, ни запретить: продукт не отказывает в деньгах — сегодня не
    // делаем, но если клиент просит и бригада согласна, запись состоится.
    const weekday = isoWeekdayOf(date);
    const served = found.filter((s) => servedOnWeekday(s, weekday));
    const rest = found.filter((s) => !servedOnWeekday(s, weekday));
    return [...served, ...rest];
  }, [q, services, date]);
  const offDayIds = useMemo(() => {
    if (!date) return new Set<string>();
    const weekday = isoWeekdayOf(date);
    return new Set(
      services.filter((s) => !servedOnWeekday(s, weekday)).map((s) => s.id),
    );
  }, [services, date]);
  const offDayLabel = date
    ? `Не делаем по ${OFF_DAY_WORD[isoWeekdayOf(date)]}`
    : "";
  const totalQty = useMemo(
    () => selectedIds.reduce((n, id) => n + (quantities[id] ?? 1), 0),
    [selectedIds, quantities],
  );
  // ЦЕНА — ПО ЛЕСТНИЦЕ КОЛИЧЕСТВА, КАК В ФОРМЕ: подвал считал по базовой цене
  // и обещал «€150», а «Итого» на форме — €135 по опту от трёх.
  const subtotal = useMemo(
    () =>
      round2(
        selectedIds.reduce((sum, id) => {
          const svc = services.find((s) => s.id === id);
          if (!svc) return sum;
          const qty = quantities[id] ?? 1;
          return sum + unitPriceFor(svc, qty) * qty;
        }, 0),
      ),
    [selectedIds, services, quantities],
  );
  const close = () => {
    setQ("");
    onClose();
  };
  // КОЛИЧЕСТВО НАБИРАЮТ ТАПАМИ (владелец 2026-09-04, выбрал вариант из
  // четырёх на экране сравнения): тап по строке добавляет ещё одну, тап по
  // бейджу «×3» убавляет, ноль убирает услугу из записи. Стрелок вверх/вниз
  // больше нет ни здесь, ни в форме.
  const add = (id: string) => {
    const qty = quantities[id];
    if (qty == null) onToggle(id);
    else onQtyChange(id, qty + 1);
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={close}
      title="Услуги"
      padded={false}
      scroll
      avoidKeyboard
      maxHeightRatio={SHEET_RATIO}
      // ФУТЕР СТОИТ ВСЕГДА, даже когда ничего не выбрано. Появляясь после
      // первого тапа, он забирал у списка ~70pt — и ВТОРОЙ тап по той же
      // строке попадал уже в кнопку «Готово» (поймано на симуляторе
      // 2026-09-04, набор количества тапами это делает обычным делом).
      // Закрыть шторку без единой услуги законно: запись сохраняется и так.
      footer={
        <View style={{ paddingHorizontal: SIDE }}>
          <GradientButton
            // ОДНО СЛОВО НА ВСЕ ЛИСТЫ ЗАПИСИ (владелец 2026-09-04: «сведи к
            // одному слову»). Метка, команда, цвет и время говорят
            // «Применить» — услуги говорят то же.
            label={
              selectedIds.length > 0
                ? `Применить · ${totalQty} · ${formatEURExact(subtotal)}`
                : "Применить"
            }
            onPress={close}
            accessibilityHint={
              selectedIds.length > 0
                ? `Работ: ${totalQty} на ${formatEURExact(subtotal)}`
                : undefined
            }
          />
        </View>
      }
    >
      <SearchField
        value={q}
        onChange={setQ}
        placeholder="Название услуги"
        accessibilityLabel="Поиск услуги"
        onClear={() => setQ("")}
      />

      {/* «ЧАСТЫЕ» — короткий путь в ДЛИННОМ прайсе. Когда услуг две-три,
          пилюли повторяют список, который и так виден целиком. */}
      {!q && frequent.length > 0 && services.length > frequent.length + 2 ? (
        <View className="flex-row flex-wrap gap-2" style={{ paddingHorizontal: SIDE, paddingBottom: 10 }}>
          {frequent.map((s) => (
            <Chip
              key={s.id}
              label={s.name}
              variant="tint"
              selected={selectedIds.includes(s.id)}
              onPress={() => add(s.id)}
            />
          ))}
        </View>
      ) : null}

      <View style={{ paddingHorizontal: SIDE, paddingBottom: 12, gap: 8 }}>
        {filtered.length > 0 ? (
          filtered.map((s) => {
            const qty = quantities[s.id];
            const on = selectedIds.includes(s.id);
            return (
              <Pressable
                key={s.id}
                onPress={() => add(s.id)}
                accessibilityRole="button"
                accessibilityLabel={`${s.name}, ${formatEURExact(s.price)}${
                  on ? `, взято ${qty ?? 1}` : ""
                }`}
                accessibilityHint="Добавляет ещё одну"
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                  minHeight: 52,
                  paddingHorizontal: 14,
                  borderRadius: t.radius.input,
                  backgroundColor: pressed ? t.rowFillPressed : t.rowFill,
                })}
              >
                <ColorDot value={s.color} size={10} />
                <View style={{ flex: 1 }}>
                  <Text
                    numberOfLines={1}
                    style={{
                      fontSize: 15,
                      fontWeight: "600",
                      color: offDayIds.has(s.id) ? t.sub : t.ink,
                    }}
                  >
                    {s.name}
                  </Text>
                  <Text numberOfLines={1} style={{ fontSize: 13, color: t.sub }}>
                    {offDayIds.has(s.id)
                      ? offDayLabel
                      : `${formatEURExact(s.price)} · ${durationLabel(s.duration_minutes)}`}
                  </Text>
                </View>
                {on ? (
                  <QtyBadge
                    qty={qty ?? 1}
                    unit={s.unit ?? null}
                    onPress={() => onQtyChange(s.id, (qty ?? 1) - 1)}
                  />
                ) : null}
              </Pressable>
            );
          })
        ) : (
          <EmptyState
            title={q.trim() ? "Услуги не найдены" : "У команды пока нет услуг"}
          />
        )}
      </View>
    </BottomSheet>
  );
}

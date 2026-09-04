import { useMemo, useState } from "react";
import { useRouter } from "expo-router";
import {
  Modal,
  Pressable,
  ScrollView,
  Text as NativeText,
  TextInput as NativeTextInput,
  View,
  type TextInputProps,
  type TextProps,
} from "react-native";
import { Check, Search, UserRound, X } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Client } from "@babun/shared/local/clients";
import { formatEURExact } from "@babun/shared/common/utils/money";

import { Chip } from "@/components/ui/Chip";
import { EmptyState } from "@/components/ui/EmptyState";
import { ICON } from "@/components/ui/tokens";
import { Screen } from "@/components/ui/Screen";
import { GradientButton } from "@/components/ui/GradientButton";
import { Stepper } from "@/features/appointments/BookingSummary";
import { SectionCard } from "@/components/ui/SectionCard";
import { useThemeColors } from "@/theme/colors";
import type { Service } from "@/features/services/queries";
import {
  buildQuickClientDraft,
  findQuickClientDuplicate,
} from "@/features/appointments/booking-prefill";
import { useReduceMotion } from "@/lib/reduce-motion";
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

/** Сколько ждать, пока `Modal` уедет, прежде чем толкать маршрут. Свой, а не
 *  `SHEET_EXIT_MS` из `BottomSheet`: тот про другой примитив со своей
 *  пружиной, и связывать их значением значило бы связать и их анимации. */
const MODAL_EXIT_MS = 260;

export function ClientPicker({
  visible,
  onClose,
  clients,
  recentIds,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  clients: Client[];
  recentIds: string[];
  onPick: (client: Client) => void;
}) {
  const t = useThemeColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const reduced = useReduceMotion();
  const [q, setQ] = useState("");
  // ПОИСК НЕ ПОМНИТ ПРОШЛЫЙ ЗАПРОС. Лист остаётся смонтированным между
  // открытиями, и набранное в нём переживало выбор: следующий поиск
  // начинался с хвоста предыдущего («ТшлщыТшлщы» на симуляторе 2026-09-03).
  const close = () => {
    setQ("");
    onClose();
  };
  const pick = (client: Client) => {
    setQ("");
    onPick(client);
  };

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
  // УЖЕ БЫЛИ записи, а у новорождённого их нет по определению. Человек заводил
  // клиента, возвращался и не находил его — вывод «не создался» напрашивался
  // сам, и он был бы верным при любом другом объяснении.
  //
  // Недавние остаются первыми: в девяти случаях из десяти записывают того, кто
  // уже был. Остальные идут следом по алфавиту — теперь список полон.
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

  // СОЗДАНИЕ — ТОЛЬКО КАРТОЧКОЙ КЛИЕНТА, И ОНА ОТКРЫВАЕТСЯ ПОВЕРХ ЗАПИСИ
  // (`/book/client`, 2026-09-03). Здесь стояла вторая дорога: строка над
  // списком заводила клиента ОДНИМ тапом — с именем без телефона или с
  // телефоном без имени, — хотя по правилу владельца телефон обязателен и
  // уникален (2026-07-25), а имя обязательно (2026-07-26). Набранное в
  // поиске не пропадает: оно уезжает в карточку параметром и уже стоит в
  // поле, а курсор — в том поле, которого не хватает.
  //
  // СНАЧАЛА ЗАКРЫВАЕМ ЛИСТ, ПОТОМ ИДЁМ. Пикер — `Modal`, а маршрут уезжает в
  // стек ПОД ним: push из-под модалки открывает страницу невидимой, за
  // шторкой. Тот же приём и той же задержкой стоит в листе создания счёта.
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
    close();
    setTimeout(
      () =>
        router.push({
          pathname: "/book/client",
          params: { id: "new", ...prefill },
        }),
      MODAL_EXIT_MS,
    );
  };

  return (
    <Modal visible={visible} animationType={reduced ? "none" : "slide"} onRequestClose={close}>
      <Screen edges={["top"]}>
        <View
          className="flex-row items-center px-3"
          style={{ height: 48, borderBottomWidth: 1, borderBottomColor: t.separator }}
        >
          <Pressable
            onPress={close}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Закрыть выбор клиента"
            style={{ minWidth: 72, minHeight: 44, justifyContent: "center" }}
          >
            <Text style={{ fontSize: 16, color: t.body }}>Отмена</Text>
          </Pressable>
          <Text className="flex-1 text-center" style={{ fontSize: 16, fontWeight: "600", color: t.ink }}>
            Клиент
          </Text>
          <View style={{ minWidth: 72 }} />
        </View>

        <View
          className="mx-4 mt-3 flex-row items-center gap-2 rounded-[10px] px-3"
          style={{ height: 44, backgroundColor: t.fill }}
        >
          <Search color={t.placeholder} size={ICON.sm} />
        <TextInput
          keyboardAppearance="light"
          accessibilityLabel="Поиск клиента"
            value={q}
            onChangeText={setQ}
            placeholder="Имя или телефон"
            placeholderTextColor={t.placeholder}
            keyboardType="default"
            // Из этой же строки создаётся клиент: автозамена успевала
            // подменить набранное имя до того, как его сохранят.
            autoCorrect={false}
            spellCheck={false}
            autoCapitalize="words"
            style={{ flex: 1, fontSize: 16, color: t.ink }}
          />
          {q ? (
            <Pressable
              onPress={() => setQ("")}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Очистить поиск"
              style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
            >
              <X color={t.placeholder} size={ICON.sm} />
            </Pressable>
          ) : null}
        </View>

        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
        >
          {!q ? (
            <Text
              className="px-5 pb-1.5 pt-4"
              style={{ fontSize: 12, fontWeight: "700", color: t.faint, letterSpacing: 0.4 }}
            >
              {recent.length > 0 ? "НЕДАВНИЕ И ВСЕ ОСТАЛЬНЫЕ" : "ВСЕ КЛИЕНТЫ"}
            </Text>
          ) : null}
          <SectionCard>
            {filtered.length > 0 ? (
              filtered.map((c, i) => (
                <Pressable
                  key={c.id}
                  onPress={() => pick(c)}
                  className="flex-row items-center px-4 py-3"
                  style={i > 0 ? { borderTopWidth: 1, borderTopColor: t.separator } : undefined}
                  accessibilityRole="button"
                  accessibilityLabel={`${c.full_name || "Без имени"}${c.phone ? `, ${c.phone}` : ""}`}
                >
                  <View
                    className="mr-3 items-center justify-center rounded-full"
                    style={{ width: 38, height: 38, backgroundColor: `${t.accent}14` }}
                  >
                    <Text style={{ fontSize: 15, fontWeight: "700", color: t.accent }}>
                      {(c.full_name || "?").slice(0, 1).toUpperCase()}
                    </Text>
                  </View>
                  <View className="flex-1">
                    <Text style={{ fontSize: 15, fontWeight: "500", color: t.ink }}>
                      {c.full_name || "Без имени"}
                    </Text>
                    {c.phone ? (
                      <Text style={{ fontSize: 13, color: t.sub, marginTop: 2 }}>{c.phone}</Text>
                    ) : null}
                  </View>
                </Pressable>
              ))
            ) : (
              <EmptyState
                title={q.trim() ? "Клиенты не найдены" : "Клиентов пока нет"}
                subtitle={
                  q.trim()
                    ? "Проверьте запрос или создайте клиента по введённым данным."
                    : "Заведите первого кнопкой внизу."
                }
              />
            )}
          </SectionCard>

          {/* Набранное и есть будущий клиент: строка несёт его в карточку.
              Найденный по номеру дубль — не создание, а выбор: два клиента
              на одном номере невозможны. */}
          {q.trim() ? (
            <Pressable
              onPress={openCreateForm}
              className="mx-4 mt-2 flex-row items-center gap-3 rounded-[10px] px-4 py-3.5"
              style={{ backgroundColor: `${t.accent}0d` }}
              accessibilityRole="button"
              accessibilityLabel={
                duplicate
                  ? `Выбрать существующего клиента ${duplicate.full_name || duplicate.phone || q.trim()}`
                  : `Создать клиента ${q.trim()}`
              }
            >
              <View
                className="items-center justify-center rounded-full"
                style={{ width: 26, height: 26, backgroundColor: `${t.accent}1a` }}
              >
                <UserRound color={t.accent} size={ICON.xs} />
              </View>
              <Text style={{ fontSize: 15, fontWeight: "600", color: t.accent }}>
                {duplicate
                  ? `Выбрать существующего «${
                      duplicate.full_name || duplicate.phone || q.trim()
                    }»`
                  : `Создать клиента «${q.trim()}»`}
              </Text>
            </Pressable>
          ) : null}
        </ScrollView>

        {/* «СОЗДАТЬ КЛИЕНТА» ВНИЗУ И ВСЕГДА (владелец 2026-08-31: «когда я
            выбираю клиента, внизу кнопку создать клиента, ну и как в
            клиентах — потому что я могу добавлять клиента и сразу их
            создавать»). Пустой поиск — и завести клиента было нечем, хотя
            именно с этого начинается половина заявок: звонит новый человек.

            ВЕДЁТ НА ТУ ЖЕ КАРТОЧКУ, ЧТО И «Добавить клиента» в списке
            клиентов, только открытую поверх записи (`/book/client`). Второй
            формы создания заводить нельзя: карточка спрашивает адрес, объект,
            канал связи, и разошедшийся дубль этой анкеты пришлось бы держать
            в двух местах. Что уже набрано в поиске — уезжает в карточку. */}
        <View
          style={{
            paddingHorizontal: 20,
            paddingTop: 8,
            paddingBottom: Math.max(insets.bottom, 10),
          }}
        >
          <GradientButton label="Создать клиента" onPress={openCreateForm} />
        </View>
      </Screen>
    </Modal>
  );
}

export function ServicePicker({
  visible,
  onClose,
  services,
  frequent,
  selectedIds,
  teamId,
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
  /** Команда записи: её прайс и показан. Ей же заводится услуга, если прайс
   *  пуст — иначе запись на такую команду не завести вовсе. */
  teamId: string | null;
  /** Дата записи «YYYY-MM-DD» — по ней виден день недели. */
  date?: string;
  onToggle: (id: string) => void;
  /** Сколько каждой услуги уже в записи. Нет ключа — ни одной. */
  quantities: Record<string, number>;
  /** Ноль убирает услугу из записи (та же семантика, что у степпера формы). */
  onQtyChange: (id: string, qty: number) => void;
}) {
  const t = useThemeColors();
  const insets = useSafeAreaInsets();
  const reduced = useReduceMotion();
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    const found = query
      ? services.filter((s) => s.name.toLowerCase().includes(query))
      : services;
    if (!date) return found;
    // УСЛУГА, КОТОРУЮ В ЭТОТ ДЕНЬ НЕ ДЕЛАЮТ, УЕЗЖАЕТ ВНИЗ — И ТОЛЬКО.
    // Ни спрятать, ни запретить: человек, не нашедший услугу, решит, что она
    // исчезла из прайса (так уже обжигались с убранными услугами), а продукт
    // не отказывает в деньгах — сегодня не делаем, но если клиент просит и
    // бригада согласна, запись обязана состояться.
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
  // Живой счётчик выбранного — чтобы не закрывать модалку ради проверки.
  // СУММА СЧИТАЕТСЯ С КОЛИЧЕСТВОМ (2026-08-31). Считалась по базовым ценам
  // выбранных услуг — пока количество набирали уже в форме, это было верно.
  // Как только степпер переехал сюда, подвал начал ЗАНИЖАТЬ: две чистки по
  // €45 и одна заправка за €80 показывались как «€125» вместо €170.
  // Поймано на симуляторе сразу после переноса степпера.
  //
  // Число слева — тоже количество работ, а не число строк прайса: человек
  // выбрал три работы, а не две.
  const totalQty = useMemo(
    () => selectedIds.reduce((n, id) => n + (quantities[id] ?? 1), 0),
    [selectedIds, quantities],
  );
  // ЦЕНА — ПО ЛЕСТНИЦЕ КОЛИЧЕСТВА, КАК В ФОРМЕ. Подвал считал по базовой цене
  // и обещал «€150», а «Итого» на форме — €135 по опту от трёх: два числа
  // за одну работу на соседних экранах (поймано 2026-09-04). Та же
  // `unitPriceFor`, что собирает строки записи.
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

  return (
    <Modal visible={visible} animationType={reduced ? "none" : "slide"} onRequestClose={onClose}>
      <Screen edges={["top"]}>
        <View
          className="flex-row items-center px-3"
          style={{ height: 48, borderBottomWidth: 1, borderBottomColor: t.separator }}
        >
          <View style={{ minWidth: 72 }} />
          <Text className="flex-1 text-center" style={{ fontSize: 16, fontWeight: "600", color: t.ink }}>
            Услуги
          </Text>
          <Pressable
            onPress={onClose}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Закрыть выбор услуг"
            style={{ minWidth: 72, minHeight: 44, alignItems: "flex-end", justifyContent: "center" }}
          >
            <Text style={{ fontSize: 16, fontWeight: "600", color: t.accent }}>Готово</Text>
          </Pressable>
        </View>

        <View
          className="mx-4 mt-3 flex-row items-center gap-2 rounded-[10px] px-3"
          style={{ height: 44, backgroundColor: t.fill }}
        >
          <Search color={t.placeholder} size={ICON.sm} />
        <TextInput
          keyboardAppearance="light"
          accessibilityLabel="Поиск услуги"
            value={q}
            onChangeText={setQ}
            placeholder="Название услуги"
            placeholderTextColor={t.placeholder}
            style={{ flex: 1, fontSize: 16, color: t.ink }}
          />
        </View>

        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
        >
          {/* «ЧАСТЫЕ» — короткий путь в ДЛИННОМ прайсе. Когда услуг всего
              две-три, пилюли повторяют список, который и так виден целиком, —
              и это читается как сбой (владелец 2026-08-17). Показываем, только
              если под ними есть что искать. */}
          {!q && frequent.length > 0 && services.length > frequent.length + 2 ? (
            <>
              <Text
                className="px-5 pb-1.5 pt-4"
                style={{ fontSize: 12, fontWeight: "700", color: t.faint, letterSpacing: 0.4 }}
              >
                ЧАСТЫЕ
              </Text>
              <View className="flex-row flex-wrap gap-2 px-4 pb-2">
                {frequent.map((s) => (
                  <Chip
                    key={s.id}
                    label={s.name}
                    variant="tint"
                    selected={selectedIds.includes(s.id)}
                    onPress={() => onToggle(s.id)}
                  />
                ))}
              </View>
            </>
          ) : null}
          <SectionCard>
            {filtered.length > 0 ? (
              filtered.map((s, i) => {
                const on = selectedIds.includes(s.id);
                return (
                  <Pressable
                    key={s.id}
                    onPress={() => onToggle(s.id)}
                    className="flex-row items-center px-4 py-3"
                    style={i > 0 ? { borderTopWidth: 1, borderTopColor: t.separator } : undefined}
                    accessibilityRole="checkbox"
                    accessibilityLabel={`${s.name}, ${formatEURExact(s.price)}`}
                    accessibilityState={{ checked: selectedIds.includes(s.id) }}
                    disabled={on}
                  >
                    <ColorDot value={s.color} size={10} />
                    <View className="ml-3 flex-1">
                      <Text
                        style={{
                          fontSize: 15,
                          color: offDayIds.has(s.id) ? t.sub : t.ink,
                        }}
                      >
                        {s.name}
                      </Text>
                      <Text style={{ fontSize: 13, color: t.placeholder, marginTop: 1 }}>
                        {offDayIds.has(s.id)
                          ? offDayLabel
                          : `${formatEURExact(s.price)} · ${durationLabel(s.duration_minutes)}`}
                      </Text>
                    </View>
                    {/* КОЛИЧЕСТВО ПРЯМО ЗДЕСЬ (владелец 2026-08-31: «просто
                        страница с услугами, где можно выбирать количество»).
                        Раньше строка умела только «включить/выключить», а
                        количество набиралось уже в форме — то есть за выбором
                        всегда следовал второй заход. Тот же степпер, что и в
                        записи: одна арифметика, один вид, ноль убирает
                        услугу. */}
                    {on ? (
                      <Stepper
                        qty={quantities[s.id] ?? 1}
                        unit={s.unit ?? null}
                        onDec={() => onQtyChange(s.id, (quantities[s.id] ?? 1) - 1)}
                        onInc={() => onQtyChange(s.id, (quantities[s.id] ?? 1) + 1)}
                      />
                    ) : (
                      <Check color={t.separator} size={ICON.md} />
                    )}
                  </Pressable>
                );
              })
            ) : (
              <EmptyState
                title={q.trim() ? "Услуги не найдены" : "У команды пока нет услуг"}
                subtitle={
                  q.trim()
                    ? "Измените запрос и попробуйте ещё раз."
                    : "Прайс команды заводится в Кабинете."
                }
              />
            )}
          </SectionCard>
          {/* СОЗДАНИЯ УСЛУГИ ЗДЕСЬ БОЛЬШЕ НЕТ (владелец 2026-08-31: «просто
              страница с услугами, которые уже заведены в команду, там нет
              создания ничего»).

              Стояла мини-форма «название + цена» на случай пустого прайса.
              Она заводила услугу в ОБХОД редактора: без расхода, без
              лестницы количества, без дней недели и перерыва — то есть
              создавала заведомо неполную строку прайса, которую потом никто
              не дозаполнял.

              Пустой прайс при этом НЕ ТУПИК: запись сохраняется и без услуг
              (`workSelectionValid` проверяет согласованность выбора с
              командой, а не его непустоту) — проверено перед сносом. */}
        </ScrollView>

        {/* ГЛАВНАЯ КНОПКА — ТОЛЬКО `GradientButton` (DS §5: одна градиентная
            CTA на весь продукт). Здесь стояла своя плоская пилюля, и владелец
            2026-09-04 поймал её сразу: «все кнопки выглядят по одному, а там
            другая». Футер — тот же, что у «Создать клиента» этажом выше. */}
        {selectedIds.length > 0 ? (
          <View
            style={{
              paddingHorizontal: 20,
              paddingTop: 8,
              paddingBottom: Math.max(insets.bottom, 10),
            }}
          >
            <GradientButton
              label={`Готово · ${totalQty} · ${formatEURExact(subtotal)}`}
              onPress={onClose}
              accessibilityHint={`Работ: ${totalQty} на ${formatEURExact(subtotal)}`}
            />
          </View>
        ) : null}
      </Screen>
    </Modal>
  );
}

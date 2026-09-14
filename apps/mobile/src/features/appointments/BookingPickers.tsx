import { useMemo, useState } from "react";
import { useRouter } from "expo-router";
import { useReferenceHref } from "@/features/clients/reference-href";
import {
  Pressable,
  Text as NativeText,
  View,
  type TextProps,
} from "react-native";
import { Briefcase } from "lucide-react-native";
import { formatEURExact } from "@babun/shared/common/utils/money";

import { BottomSheet } from "@/components/ui/BottomSheet";
import { useSheetDoorway } from "@/components/ui/use-sheet-doorway";
import { EmptyState } from "@/components/ui/EmptyState";
import { GUTTER } from "@/components/ui/tokens";
import { GradientButton } from "@/components/ui/GradientButton";
import {
  SELECT_SHEET_RATIO,
  SelectList,
  SelectRow,
  SelectSearch,
} from "@/components/ui/select-rows";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";
import type { Service } from "@/features/services/queries";
import { isoWeekdayOf, servedOnWeekday } from "@babun/shared/local/services";
import { durationLabel } from "@/features/services/format";
import { unitPriceFor } from "@/features/appointments/helpers";
import { round2 } from "@babun/shared/local/finance/appointment-calc";

function Text({ maxFontSizeMultiplier = 1.3, ...props }: TextProps) {
  return (
    <NativeText maxFontSizeMultiplier={maxFontSizeMultiplier} {...props} />
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
//
// Само число уехало к анатомии (`SELECT_SHEET_RATIO` в `select-rows`): решение
// про половину экрана оказалось общим для всех шторок выбора, а не свойством
// услуг (владелец 2026-09-10).


export function ServicePicker({
  visible,
  onClose,
  services,
  selectedIds,
  date,
  teamId,
  quantities,
  onToggle,
  onQtyChange,
}: {
  visible: boolean;
  onClose: () => void;
  services: Service[];
  selectedIds: string[];
  /** Дата записи «YYYY-MM-DD» — по ней виден день недели. */
  date?: string;
  /** Команда записи. Дверь в прайс открывает именно её: услуга принадлежит
   *  одной команде, а без адреса страница брала команду из ленты календаря. */
  teamId?: string | null;
  onToggle: (id: string) => void;
  /** Сколько каждой услуги уже в записи. Нет ключа — ни одной. */
  quantities: Record<string, number>;
  /** Ноль убирает услугу из записи. */
  onQtyChange: (id: string, qty: number) => void;
}) {
  const router = useRouter();
  const servicesHref = useReferenceHref().services;
  const doorway = useSheetDoorway();
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
  // ДВЕРЬ В ПРАЙС ПАРКУЕТ ЛИСТ, А НЕ ЗАКРЫВАЕТ (AGENTS 5.4). Закрытый лист
  // по «назад» не возвращался: человек заводил услугу и попадал на форму, где
  // выбор надо было открывать заново. Припаркованный встаёт на место сам — уже
  // с новой услугой и «Применить». Команда едет адресом: без неё страница
  // брала команду из ленты календаря, услуга уезжала чужой команде, и запись
  // её так и не видела.
  const openServices = () =>
    doorway.open(() =>
      router.push(
        teamId
          ? { pathname: servicesHref, params: { team: teamId } }
          : servicesHref,
      ),
    );
  const catalogEmpty = services.length === 0;
  // ТАП ПО СТРОКЕ — ВЗЯТЬ ИЛИ СНЯТЬ, КОЛИЧЕСТВО — СТЕППЕРОМ (владелец
  // 2026-09-08: «количество набирать несколькими тапами не очень прикольно, а
  // чтобы снять — надо прям на это нажимать, не все люди это поймут»).
  //
  // До этого тап по строке ДОБАВЛЯЛ ещё одну: три чистки — три тапа, а снять
  // услугу можно было только попав в маленький бейдж «×3», о чём на экране не
  // говорило ничто. Теперь строка ведёт себя как везде в продукте: тап —
  // выбор, повторный тап — снятие; количество живёт своим органом «− 3 +»,
  // который появляется у выбранной услуги.
  const toggle = (id: string) => {
    haptics.tap();
    onToggle(id);
  };

  return (
    <BottomSheet
      visible={visible && !doorway.parked}
      onClose={close}
      title="Услуги"
      padded={false}
      scroll
      avoidKeyboard
      maxHeightRatio={SELECT_SHEET_RATIO}
      // ФУТЕР СТОИТ ВСЕГДА, даже когда ничего не выбрано. Появляясь после
      // первого тапа, он забирал у списка ~70pt — и ВТОРОЙ тап по той же
      // строке попадал уже в кнопку «Готово» (поймано на симуляторе
      // 2026-09-04, набор количества тапами это делает обычным делом).
      // Закрыть шторку без единой услуги законно: запись сохраняется и так.
      footer={
        <View style={{ paddingHorizontal: GUTTER }}>
          {catalogEmpty ? (
            // ПУСТОЙ ПРАЙС — ОДНА КНОПКА, И ОНА ВНИЗУ (владелец 2026-09-14:
            // «если услуги нет, кнопка „Применить“ меняется на „Добавить
            // услугу“»). Применять нечего, поэтому место главного действия
            // занимает единственное осмысленное — завести услугу. Второй
            // кнопки посередине листа нет: пустое состояние — это слова.
            <GradientButton label="Добавить услугу" onPress={openServices} />
          ) : (
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
          )}
        </View>
      }
    >
      <SelectSearch
        value={q}
        onChange={setQ}
        placeholder="Название услуги"
        accessibilityLabel="Поиск услуги"
        onClear={() => setQ("")}
      />

      <SelectList>
        {filtered.length > 0 ? (
          filtered.map((s) => {
            const qty = quantities[s.id];
            const on = selectedIds.includes(s.id);
            return (
              // СТРОКА — ОБЩАЯ (2026-09-10). Здесь она была четвёртой по счёту
              // анатомией: высота 56 вместо 52 и галка СЛЕВА вместо кружка
              // сущности. Галка слева честно говорила «список многовыборный»,
              // но ценой того, что выбор услуги выглядел не как выбор клиента,
              // объекта и метки. Теперь кружок со значком услуги — тем же, что
              // в блоке «Услуги» на записи, — а многовыборность читается
              // тонировкой строки и степпером количества у взятой услуги.
              <SelectRow
                key={s.id}
                icon={Briefcase}
                title={s.name}
                subtitle={
                  offDayIds.has(s.id)
                    ? offDayLabel
                    : `${formatEURExact(s.price)} · ${durationLabel(s.duration_minutes)}`
                }
                selected={on}
                accessibilityRole="checkbox"
                accessibilityLabel={`${s.name}, ${formatEURExact(s.price)}${
                  on ? `, взято ${qty ?? 1}` : ""
                }`}
                onPress={() => toggle(s.id)}
                trailing={
                  on ? (
                    <PickerQty
                      name={s.name}
                      qty={qty ?? 1}
                      onChange={(next) => onQtyChange(s.id, next)}
                    />
                  ) : undefined
                }
              />
            );
          })
        ) : (
          // ПУСТОЙ ПРАЙС — НЕ ТУПИК (2026-09-10), но и не вторая кнопка
          // (2026-09-14). У новой компании и у команды, которой при разделении
          // ничего не досталось, завести услугу можно, не теряя набранную
          // запись: дверь — кнопка футера «Добавить услугу», здесь только
          // слова. Второй формы услуги не появляется: сущность-владелец
          // правится своей страницей.
          <EmptyState
            title={q.trim() ? "Услуги не найдены" : "У команды пока нет услуг"}
          />
        )}
      </SelectList>
    </BottomSheet>
  );
}

/** КОЛИЧЕСТВО ВЫБРАННОЙ УСЛУГИ — «− 3 +» прямо в строке списка. Пилюля, а не
 *  три кнопки: один орган с числом посередине. Нажатия по ней НЕ доходят до
 *  строки — вложенный `Pressable` забирает касание себе, поэтому подкрутить
 *  количество можно, не сняв услугу.
 *
 *  «−» на единице ПРИГАШЕН: снять услугу — это тап по строке, и два разных
 *  жеста для одного действия только сбивают. */
function PickerQty({
  name,
  qty,
  onChange,
}: {
  name: string;
  qty: number;
  onChange: (next: number) => void;
}) {
  const t = useThemeColors();
  const step = (delta: number, label: string, sign: string, off?: boolean) => (
    <Pressable
      onPress={() => {
        if (off) return;
        haptics.tap();
        onChange(qty + delta);
      }}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!off }}
      style={({ pressed }) => ({
        width: 32,
        height: 36,
        alignItems: "center",
        justifyContent: "center",
        opacity: off ? 0.3 : pressed ? 0.5 : 1,
      })}
    >
      <Text
        maxFontSizeMultiplier={1}
        style={{ fontSize: 18, fontWeight: "600", color: t.ink, lineHeight: 22 }}
      >
        {sign}
      </Text>
    </Pressable>
  );
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        width: 92,
        height: 36,
        borderRadius: t.radius.input,
        backgroundColor: t.surface,
      }}
    >
      {step(-1, `Убавить: ${name}`, "\u2212", qty <= 1)}
      <Text
        maxFontSizeMultiplier={1.2}
        style={{
          fontSize: 15,
          fontWeight: "700",
          color: t.ink,
          fontVariant: ["tabular-nums"],
        }}
      >
        {qty}
      </Text>
      {step(1, `Добавить: ${name}`, "+")}
    </View>
  );
}

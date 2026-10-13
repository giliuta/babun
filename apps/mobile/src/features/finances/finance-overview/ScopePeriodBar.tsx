import { Pressable, Text, View } from "react-native";
import { ChevronDown } from "lucide-react-native";
import { ScopeChips } from "@/components/ui/ScopeChips";
import { useToast } from "@/components/ui/Toast";
import { useCalendarChips } from "@/features/settings/workspaces";
import { useThemeColors } from "@/theme/colors";
import type { Team } from "@/features/reference/queries";
import { periodDates, periodTitle, type Period } from "../period";

/**
 * ЛЕНТА КОМАНД И СТРОКА ПЕРИОДА — ШАПКА ДЕНЕЖНЫХ ЭКРАНОВ. Одна вёрстка на
 * «Финансы» и «Аналитику» (владелец 2026-09-24: «всю нашу настройку, которую
 * мы использовали в финансах, такую же используй в аналитике»): две копии
 * разошлись бы на первой правке отступа.
 */
export function ScopePeriodBar({
  teams,
  scopeTeamId,
  onScopeChange,
  period,
  onOpenPresets,
  onOpenCustom,
  locked = false,
  deselectable = false,
}: {
  teams: Team[];
  scopeTeamId: string | null;
  onScopeChange: (id: string | null) => void;
  period: Period;
  onOpenPresets: () => void;
  onOpenCustom: () => void;
  locked?: boolean;
  /** Повторный тап по выбранной команде снимает выбор — `null`, вся
   *  компания. ТОЛЬКО у «Аналитики» (владелец 2026-09-24: «без кнопки „Все
   *  команды“ — сразу показывает все, а выделяю ту команду, которую хочу
   *  посмотреть»). На «Финансах» выбор не снимается: деньги там всегда чьи-то
   *  (закон 2026-08-10), а итог компании — ровно вопрос аналитики. */
  deselectable?: boolean;
}) {
  const toast = useToast();
  const calendarChips = useCalendarChips({
    own: teams,
    onPickOwn: onScopeChange,
    onSwitchError: (message) => toast(message, "error"),
  });

  return (
    <>
      {/* ОДНА ЛЕНТА НА ПРОДУКТ (`ScopeChips`, DESIGN-SYSTEM.md §5). Здесь
          лежала своя копия того же контрола: те же пилюли, но со своими
          отступами и без подводки к выбранному чипу — команда, доехавшая
          позже, оставалась обрезанной за правым краем именно на финансах.
          Шва нет: ряд периода ниже рисует свою верхнюю границу, и две линии
          подряд читаются как случайный зазор.

          Чипа «Все» лента не показывает вовсе (владелец 2026-08-10/08-11):
          деньги в продукте всегда чьи-то, а итог по компании живёт в сводках
          Кабинета. Общий чип показывал сумму, за которую никто не отвечает. */}
      {/* КАЛЕНДАРИ ДРУГИХ КОМПАНИЙ СТОЯТ В ТОМ ЖЕ РЯДУ (владелец 2026-09-12:
          «в финансах соответственно то же самое»). Правила ленты — общие с
          календарём, одним телом (`useCalendarChips`): что считать чужим, как
          склеен идентификатор и что делает тап. Две копии этих правил разошлись
          бы на первой же правке, и деньги разъехались бы с расписанием. */}
      <ScopeChips
        items={calendarChips.items}
        // Пока идёт переход в другую компанию, подсвечен выбранный чип, а не
        // прежний: касание обязано отвечать сразу.
        activeId={calendarChips.pendingId ?? scopeTeamId}
        seam={false}
        onSelect={(id) =>
          deselectable && id === scopeTeamId ? onScopeChange(null) : calendarChips.pick(id)
        }
      />

      <PeriodRow
        title={periodTitle(period)}
        dates={periodDates(period)}
        onOpenPresets={onOpenPresets}
        onOpenCustom={onOpenCustom}
        locked={locked}
      />
    </>
  );
}

/**
 * РЯД ПЕРИОДА — ИМЯ слева открывает готовые периоды, ДАТЫ справа — свои даты.
 * Один на продукт: шапка «Финансов» и «Аналитики» (`ScopePeriodBar`) и
 * «Выписка» счёта (владелец 03.10: «выписка за период — прям хорошо»).
 */
export function PeriodRow({
  title,
  dates,
  onOpenPresets,
  onOpenCustom,
  locked = false,
}: {
  /** «Текущий месяц», «Всё время». */
  title: string;
  /** «01.10.26 – 31.10.26». */
  dates: string;
  onOpenPresets: () => void;
  onOpenCustom: () => void;
  locked?: boolean;
}) {
  const t = useThemeColors();
  // У закрытых финансов ряд серый и глухой: месяц назван, а выбирать период
  // не для чего — денег за ним не покажут.
  return (
    <View
      className="flex-row items-center justify-between px-4"
      style={{
        backgroundColor: t.surface,
        borderTopWidth: 1,
        borderTopColor: t.separator,
        borderBottomWidth: 1,
        borderBottomColor: t.separator,
        minHeight: 38,
      }}
    >
      <Pressable
        onPress={onOpenPresets}
        disabled={locked}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`Период: ${title}`}
        accessibilityState={{ disabled: locked }}
        className="flex-row items-center gap-1 py-2 active:opacity-60"
      >
        <Text
          className="text-[15px] font-semibold"
          style={{ color: locked ? t.muted : t.ink }}
        >
          {title}
        </Text>
        <ChevronDown
          color={locked ? t.muted : t.faint}
          size={14}
          strokeWidth={2.6}
        />
      </Pressable>
      <Pressable
        onPress={onOpenCustom}
        disabled={locked}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Выбрать диапазон дат"
        accessibilityState={{ disabled: locked }}
        className="py-2 active:opacity-60"
      >
        <Text
          className="text-[15px] font-bold"
          style={{
            color: locked ? t.muted : t.ink,
            fontVariant: ["tabular-nums"],
          }}
        >
          {dates}
        </Text>
      </Pressable>
    </View>
  );
}

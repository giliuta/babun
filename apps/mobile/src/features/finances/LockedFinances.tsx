import { useState } from "react";
import { useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { BarChart3, Search, Settings } from "lucide-react-native";
import {
  getCurrentCyprusTime,
  getCurrentTimeInZone,
} from "@babun/shared/common/utils/date-utils";
import { GradientButton } from "@/components/ui/GradientButton";
import { Screen } from "@/components/ui/Screen";
import { useTeams } from "@/features/reference/queries";
import { useCalendarSettings } from "@/features/settings/local-settings";
import { usePlanAllows } from "@/features/settings/tenant";
import { useThemeColors } from "@/theme/colors";
import { FinanceOverview } from "./FinanceOverview";
import { RecordRowsPanel } from "./RecordRowsPanel";
import { defaultPeriod } from "./period";
import type { RecordRow } from "./record-rows";

// «ФИНАНСЫ» БЕЗ ДОСТУПА — ТА ЖЕ СТРАНИЦА, ТОЛЬКО СЕРАЯ (владелец 15.09: «если
// я перехожу в финансы — не „раздел недоступен“; в финансах можно выбирать
// команды; перехожу на команду, которая мне недоступна, — доход, расход, долги,
// прибыль серым, операций нет, всё по нулям, но переключаться можно»).
//
// Разворот решения 14.09 («раздел без доступа — экран „Нет доступа“») по
// прямому слову владельца. Экран-объяснение прятал ленту команд, а она здесь —
// дверь в компанию, где деньги этого человека есть: у сотрудника бывает и
// своя компания.
//
// НИ ОДНОГО ДЕНЕЖНОГО ЗАПРОСА. Нули нарисованы, а не посчитаны: страница не
// спрашивает ни операций, ни счетов, ни долгов — показывать их нельзя, и
// спрашивать незачем. Живы только лента команд и переход по ней в другую
// компанию; там вкладка сама откроет настоящие финансы, если человек их
// видит (`financesGate`).

const NOOP = () => {};
const ZERO_TOTALS = { income: 0, expense: 0, profit: 0, debt: 0 };
const NO_ROWS: RecordRow[] = [];

export function LockedFinances() {
  const t = useThemeColors();
  const router = useRouter();
  const teams = useTeams().data ?? [];
  const [scope, setScope] = useState<string | null>(null);
  // Выбор выводится, а не хранится: пока человек не тапнул, подсвечена первая
  // команда, а пропавшая из списка не оставляет ленту без подсветки.
  const scopeTeamId =
    scope && teams.some((team) => team.id === scope)
      ? scope
      : (teams[0]?.id ?? null);
  // Подпись периода — тот же текущий месяц, что у открытых «Финансов», по
  // часам компании.
  const timezone = useCalendarSettings().data?.timezone;
  const period = defaultPeriod(
    timezone ? getCurrentTimeInZone(timezone) : getCurrentCyprusTime(),
  );
  const canUseDocuments = usePlanAllows("documents");

  return (
    <Screen edges={["top"]}>
      {/* ШАПКА — КАК У ОТКРЫТЫХ ФИНАНСОВ, И ДВЕРИ В НЕЙ ЖИВЫЕ (владелец 20.09:
          «сверху слева должна быть шестерёнка… я могу зайти туда, но блоков
          уже внутри шестерёнки не будет»; «справа значок аналитики — он есть,
          если на него тапнуть, открывается, ну значит не будет данных там»).
          Серым и глухим остаётся только поиск: искать в пустой ленте нечего, и
          для VoiceOver его нет. */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
          paddingHorizontal: 8,
          minHeight: 48,
          backgroundColor: t.surface,
          borderBottomWidth: 1,
          borderBottomColor: t.separator,
        }}
      >
        <Pressable
          onPress={() => router.push("/finances/settings")}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel="Настройки финансов"
          style={({ pressed }) => ({
            width: 44,
            height: 44,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: t.radius.card,
            backgroundColor: pressed ? t.pressed : "transparent",
          })}
        >
          <Settings color={t.sub} size={21} strokeWidth={2} />
        </Pressable>
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          className="h-9 flex-1 flex-row items-center gap-1.5 px-2.5"
          style={{ borderRadius: t.radius.input, backgroundColor: t.fill }}
        >
          <Search color={t.muted} size={16} />
          <Text
            numberOfLines={1}
            maxFontSizeMultiplier={1.3}
            className="flex-1 text-[15px]"
            style={{ color: t.muted }}
          >
            Сумма, счёт, заметка
          </Text>
        </View>
        <Pressable
          onPress={() => router.push("/cabinet/insights")}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel="Аналитика по финансам"
          style={({ pressed }) => ({
            width: 44,
            height: 44,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: t.radius.card,
            backgroundColor: pressed ? t.pressed : "transparent",
          })}
        >
          <BarChart3 color={t.sub} size={21} strokeWidth={2} />
        </Pressable>
      </View>

      <View style={{ flex: 1 }}>
        <FinanceOverview
          teams={teams}
          scopeTeamId={scopeTeamId}
          onScopeChange={setScope}
          period={period}
          onOpenPresets={NOOP}
          onOpenCustom={NOOP}
          totals={ZERO_TOTALS}
          accounts={{ total: 0 }}
          invoices={{ openCount: 0 }}
          showDocuments={canUseDocuments}
          view="all"
          onTap={NOOP}
          locked
        />
        <RecordRowsPanel
          rows={NO_ROWS}
          title="Записи"
          emptyTitle="Нет операций за период"
          onOpenRecord={NOOP}
        />
      </View>

      {/* Кнопка на своём месте и серая: страница та же, что у владельца, и
          действие в ней просто закрыто — «нажал, а там ошибка» не бывает. */}
      <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 10 }}>
        <GradientButton label="Добавить операцию" onPress={NOOP} disabled />
      </View>
    </Screen>
  );
}

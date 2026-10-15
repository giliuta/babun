import { Pressable, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { BarChart3, Search, Settings } from "lucide-react-native";
import { useThemeColors } from "@/theme/colors";
import type { FinancePageAccess } from "../finance-page-access";
import type { HomeView } from "../FinanceOverview";
import type { Period } from "@/lib/period";

/** Разрезы, в которых поиск из шапки фильтрует ПОКАЗАННОЕ. У «Счетов»,
 *  «Долгов» и «Прибыли» строк поиска нет вовсе, поэтому первая же буква
 *  возвращает ленту операций — иначе поиск молча фильтровал бы невидимое. */
const SEARCHABLE_VIEWS = new Set<HomeView>([
  "all",
  "income",
  "expense",
  "documents",
]);

interface Props {
  access: Pick<FinancePageAccess, "search">;
  view: HomeView;
  setView: (view: HomeView) => void;
  documentsView: boolean;
  query: string;
  setQuery: (query: string) => void;
  period: Period;
  openFinanceSettings: () => void;
}

// ШАПКА — ТА ЖЕ, ЧТО У КЛИЕНТОВ: шестерёнка · поиск · аналитика.
//
// Заголовка «Финансы» здесь нет: внизу и так вкладка с этим словом. Период в
// центр тоже не годится — он стоит
// строкой ниже вместе с точными датами, и дублировать его нельзя.
//
// Поиск выбран потому, что он ЕДИНСТВЕННЫЙ не может задублировать цифры
// экрана: он не показывает ни одной. И он не стареет — в отличие от любого
// сигнала или бейджа, которые через месяц перестают замечать.
export function FinancesHeader({
  access,
  view,
  setView,
  documentsView,
  query,
  setQuery,
  period,
  openFinanceSettings,
}: Props) {
  const t = useThemeColors();
  const router = useRouter();
  return (
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
        onPress={openFinanceSettings}
        // ДВЕРЬ ОТКРЫТА ВСЕМ: человек может зайти, а блоков внутри шестерёнки может и не
        // быть. Серая и глухая шестерёнка у сотрудника меняла бы визуал шапки вместе с правами.
        // Страница за ней показывает то, что человеку открыто, и ничего, если
        // не открыто ничего (`finances/settings-levels.ts`).
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
        style={{
          height: 36,
          flex: 1,
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          paddingHorizontal: 10,
          borderRadius: t.radius.input,
          backgroundColor: t.fill,
        }}
      >
        <Search color={t.faint} size={16} />
        <TextInput
          value={query}
          onChangeText={(next) => {
            setQuery(next);
            // Начали печатать — возвращаем ленту, если открытая панель искать
            // не умеет: в разрезах «Счета», «Долги» и «Прибыль» строк поиска
            // на экране нет вовсе, и он фильтровал бы невидимое.
            if (next.trim() && !SEARCHABLE_VIEWS.has(view)) setView("all");
          }}
          // ПОДСКАЗКА НАЗЫВАЕТ ТО, ГДЕ ИЩУТ. Одно поле обслуживает две ленты, и
          // «Сумма, счёт, заметка» над списком документов было бы прямым
          // враньём: по счёту и заметке документ не ищется.
          //
          // Слова для операций — ФИНАНСОВЫЕ: так человек её и ищет — по сумме,
          // по кассе, по своей же заметке. «Клиент» и «категория» здесь не то,
          // чем думают в этом разделе, хотя искать по ним
          // поле по-прежнему умеет.
          placeholder={
            documentsView ? "Номер, клиент, сумма" : "Сумма, счёт, заметка"
          }
          accessibilityLabel={
            documentsView ? "Поиск по документам" : "Поиск по операциям"
          }
          placeholderTextColor={t.placeholder}
          selectionColor={t.accent}
          keyboardAppearance="light"
          autoCapitalize="none"
          returnKeyType="search"
          // Искать нечего, когда ленты нет: у закрытых «Доходов и расходов»
          // поле серое и не принимает ввод.
          editable={access.search}
          clearButtonMode="while-editing"
          maxFontSizeMultiplier={1.3}
          // МЕЖСТРОЧНЫЙ ИНТЕРВАЛ ЗАДАН ЯВНО, 18 = родной у 15pt.
          // Без него поле
          // получало интервал базовых стилей (1,5 кегля), и однострочное поле
          // iOS опускает текст ровно на этот излишек: подсказка стояла на
          // ~8pt ниже лупы, а с классом `text-[15px]` ещё и срезалась снизу.
          // Проверено на симуляторе: без высоты и без сброса отступов смещение
          // оставалось, пропало — только от интервала.
          style={{
            flex: 1,
            alignSelf: "stretch",
            fontSize: 15,
            lineHeight: 18,
            color: t.ink,
          }}
        />
      </View>

      {/* Аналитика — как в Клиентах: значок стоит всегда (тап открывает её, даже если
          данных там нет). Что человек увидит
          внутри, решают его же права на записи и деньги. */}
      <Pressable
        onPress={() =>
          // Аналитика открывается на том же периоде, что был под значком, и
          // на всей компании — команду в ней выбирают тапом.
          router.push({
            pathname: "/finances/insights",
            params: {
              period: period.preset,
              from: period.from,
              to: period.to,
            },
          })
        }
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
  );
}

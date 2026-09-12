import { Pressable, Text, View } from "react-native";
import { ChevronDown } from "lucide-react-native";
import {
  formatEURExact as formatEUR,
  moneySign,
} from "@babun/shared/common/utils/money";
import {
  FORMS_DOCUMENT,
  formatCountRu,
  pluralRu,
} from "@babun/shared/common/utils/plural-ru";
import { ScopeChips } from "@/components/ui/ScopeChips";
import { useToast } from "@/components/ui/Toast";
import { useCalendarChips } from "@/features/settings/workspaces";
import { useThemeColors } from "@/theme/colors";
import type { Team } from "@/features/reference/queries";
import { periodDates, periodTitle, type Period } from "./period";

/**
 * Какую панель раскрывает сводка. Страниц среди них больше нет.
 *
 * ПРАВИЛО ПРОДУКТА (владелец 2026-08-11: «как можно меньше тапов, меньше
 * страниц; нажимаю документы — и внизу все документы сразу»):
 *
 *   СТРАНИЦА — ТОЛЬКО ДЛЯ ТОГО, ЧЕМ УПРАВЛЯЮТ (создать, настроить,
 *   заархивировать). ТО, НА ЧТО ПРОСТО СМОТРЯТ, РАСКРЫВАЕТСЯ НА МЕСТЕ.
 *
 * До этого, чтобы увидеть инвойс, нужно было три экрана: «Финансы» →
 * «Документы» → «Инвойсы». Страницы никуда не делись — они остались там, где
 * действительно управляют бумагами и счетами, и до них ведёт последняя строка
 * каждой панели («Все документы ›», «Все счета ›»).
 */
export type HomeView =
  | "all"
  | "accounts"
  | "documents"
  | "income"
  | "expense"
  | "debt"
  | "profit";

export interface InvoiceTileSummary {
  /** Сколько документов ждут оплаты — плитка печатает ШТУКИ, а не деньги. */
  openCount: number;
}

export interface AccountTileSummary {
  /** Σ остатков набора — та же цифра, что и на странице счетов.
   *  Больше плитке ничего не нужно: она отвечает «сколько у команды», а состав
   *  (сколько счетов, сколько наличными) смотрят на самой странице счетов. */
  total: number;
}

export interface OverviewTotals {
  income: number;
  expense: number;
  profit: number;
  debt: number;
}

/**
 * Переключатель сводки: счета, документы, доход, расход, долги, прибыль —
 * ОДИН объект.
 *
 * Владелец 2026-08-11: «компактно, чтоб всё было в одном стиле». До этого
 * каждая строка была нарисована по-своему, и глаз читал их как разные
 * сущности, хотя это один ряд однотипных фильтров.
 *
 * Правило раскраски здесь одно и оно же — правило продукта: ЦВЕТ НЕСЁТ СМЫСЛ,
 * а не украшает. Точка и значение окрашены смыслом строки (зелёный — пришло,
 * красный — ушло, янтарь — ждём, кобальт — наше), ярлык нейтральный, фон белый.
 * Тинт остаётся ровно за ВЫБРАННЫМ состоянием: раньше он стоял у половины
 * строк просто так и потому ничего не значил.
 */
export function SummaryToggle({
  label,
  color,
  value,
  quiet,
  a11yValue,
  active,
  onPress,
}: {
  label: string;
  /** Цвет смысла строки: им красится точка, а значение — когда оно не ноль. */
  color: string;
  value: string;
  /** НОЛЬ ТИШЕ ЖИВЫХ ДЕНЕГ — тот же закон, что у строки счёта в списке
   *  (`SettingsRow.valueQuiet`). Пять нулей, набранных в полную силу своими
   *  цветами, превращали сводку в ровный шаблон: глаз обегал зелёное,
   *  красное, янтарное и синее и не находил единственное живое число.
   *  Красный «€0» у расхода вдобавок врал прямо цветом — красное в этом
   *  продукте значит «деньги ушли». Точка при этом остаётся цветной: она
   *  называет строку, а не сумму. */
  quiet?: boolean;
  /** Что значит число, если само по себе оно немое: «3» на плитке документов
   *  это «три документа ждут оплаты», и вслух строка обязана сказать это. */
  a11yValue?: string;
  active: boolean;
  onPress: () => void;
}) {
  const t = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ expanded: active }}
      accessibilityLabel={`${label}: ${a11yValue ?? value}`}
      // Строка 38pt + зазор 6pt между рядами: цель касания добирает до 44
      // за счёт зазора, вид не меняется (тот же приём, что у Chip).
      hitSlop={{ top: 3, bottom: 3 }}
      className="flex-1 flex-row items-center rounded-[10px] px-3.5 active:opacity-70"
      style={{
        minHeight: 38,
        // `1a` — тот же тинт, что у выбранного чипа: 10% цвета читается как
        // подсветка, но не спорит со значением, набранным тем же цветом.
        // Тинта ХВАТАЕТ: цветная рамка была третьей грамматикой выбора на
        // продукт (у Chip — заливка, у оттиск-рядов — углубление материала), и
        // 1.5px контур нигде больше не встречался.
        backgroundColor: active ? color + "1a" : t.surface,
        borderCurve: "continuous",
      }}
    >
      <View
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: color }}
      />
      <Text className="ml-2 text-sm font-semibold" style={{ color: t.sub }}>
        {label}
      </Text>
      <Text
        className={`ml-auto text-[15px] ${quiet ? "font-semibold" : "font-bold"}`}
        style={{
          color: quiet ? t.caption : color,
          fontVariant: ["tabular-nums"],
        }}
      >
        {value}
      </Text>
    </Pressable>
  );
}

// LOCKED v5 overview #6 «grouped-iOS premium» (finances-design.html +
// web FinanceOverview.tsx): company/team scope chips →
// period row split into NAME and DATES tap targets → шесть одинаковых
// `SummaryToggle` тремя рядами.
// Every card toggles the panel below; прибыль is always brandAccent.
export function FinanceOverview({
  teams,
  scopeTeamId,
  onScopeChange,
  period,
  onOpenPresets,
  onOpenCustom,
  totals,
  accounts,
  invoices,
  showDocuments = true,
  view,
  onTap,
}: {
  teams: Team[];
  scopeTeamId: string | null;
  onScopeChange: (id: string | null) => void;
  period: Period;
  onOpenPresets: () => void;
  onOpenCustom: () => void;
  totals: OverviewTotals;
  accounts: AccountTileSummary;
  invoices: InvoiceTileSummary;
  /** Документы есть в тарифе. Нет — плитки нет ВОВСЕ (канон: без права блок
   *  не показывается либо только читается; «видно, но при нажатии ошибка» в
   *  продукте не бывает). «Счета» занимают ряд целиком. */
  showDocuments?: boolean;
  view: HomeView;
  onTap: (v: HomeView) => void;
}) {
  const t = useThemeColors();

  // ПРОСТО «СЧЕТА» (владелец 2026-08-11). Уточнение «команды» было нужно, пока
  // рядом существовало понятие «счёт компании» и плитка могла соврать про чей
  // это остаток. Понятия больше нет: деньги в продукте всегда чьи-то, а чьи
  // именно — говорит выбранный чип прямо над плиткой.
  const accountsTitle = "Счета";

  const toast = useToast();
  const calendarChips = useCalendarChips({
    own: teams,
    onPickOwn: onScopeChange,
    onSwitchError: (message) => toast(message, "error"),
  });

  return (
    <View>
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
        activeId={scopeTeamId}
        seam={false}
        onSelect={calendarChips.pick}
      />

      {/* period row — NAME opens the preset list, DATES open the wheels */}
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
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Период: ${periodTitle(period)}`}
          className="flex-row items-center gap-1 py-2 active:opacity-60"
        >
          <Text className="text-[15px] font-semibold" style={{ color: t.ink }}>
            {periodTitle(period)}
          </Text>
          <ChevronDown color={t.faint} size={14} strokeWidth={2.6} />
        </Pressable>
        <Pressable
          onPress={onOpenCustom}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Выбрать диапазон дат"
          className="py-2 active:opacity-60"
        >
          <Text
            className="text-[15px] font-bold"
            style={{ color: t.ink, fontVariant: ["tabular-nums"] }}
          >
            {periodDates(period)}
          </Text>
        </Pressable>
      </View>

      {/* overview cards */}
      <View className="px-4 pb-2 pt-2" style={{ gap: 6 }}>
        {/* Счета | Документы — ТОТ ЖЕ РЯД, ЧТО И СВОДКА (владелец 2026-08-11:
            «счета сделать такого же вида, как доход и расход, долги и прибыль»).
            Раньше это были плитки в два этажа: другой рост, другой кегль, свой
            значок — глаз читал их как объекты другого рода, хотя это такие же
            входы в тот же экран.
            Теперь между шестью строками нет РАЗНИЦЫ ВООБЩЕ: каждая раскрывает
            свою панель внизу и объявляет состояние через `expanded`. Шеврона
            не осталось ни у одной — уводить с экрана они перестали (см. правило
            продукта у `HomeView`).
            Точка у счетов и документов чернильная: остаток на счетах — не
            приход и не расход, у него нет знака, а документ и вовсе не деньги;
            красить их в зелёное значило бы назвать это доходом. */}
        <View className="flex-row" style={{ gap: 6 }}>
          <SummaryToggle
            label={accountsTitle}
            color={t.ink}
            value={formatEUR(accounts.total)}
            quiet={moneySign(accounts.total) === 0}
            active={view === "accounts"}
            onPress={() => onTap("accounts")}
          />
          {/* ДОКУМЕНТ — НЕ ДЕНЬГИ (владелец 2026-08-11: «какой смысл в
              документах евро показывать»). Здесь стояла сумма к оплате, и
              рядом с остатком на счетах она читалась как второй кошелёк, хотя
              это обязательство клиента, а не наши деньги. Поэтому значение —
              ШТУКИ: сколько документов ждут оплату.
              КРАСНОГО ЗДЕСЬ НЕТ (владелец 2026-08-15: «неоплаченный документ —
              ничего страшного, не надо выставлять его якобы красным»). Строка
              краснела на просрочку и превращала обычный рабочий счёт в тревогу;
              состояние документа названо словом в самой его строке
              («Просрочен»), и этого достаточно. */}
          {showDocuments ? (
          <SummaryToggle
            label="Документы"
            color={t.ink}
            // НОЛЬ ДОКУМЕНТОВ — СЛОВОМ. Голый «0» стоит вплотную к «€450» в
            // том же ряду и читается как сумма; так же его печатает строка
            // «Закрытые счета» в настройках счетов.
            value={invoices.openCount > 0 ? String(invoices.openCount) : "нет"}
            quiet={invoices.openCount === 0}
            active={view === "documents"}
            // Глагол склоняется вместе с числительным: «1 документ ждёт»,
            // а не «1 документ ждут».
            a11yValue={`${formatCountRu(invoices.openCount, FORMS_DOCUMENT)} ${pluralRu(
              invoices.openCount,
              ["ждёт", "ждут", "ждут"],
            )} оплаты`}
            onPress={() => onTap("documents")}
          />
          ) : null}
        </View>

        {/* ПЕРЕКЛЮЧАТЕЛИ — ОДИН ОБЪЕКТ (владелец 2026-08-11: «компактно,
            чтоб всё было в одном стиле»). Раньше они разъезжались втроём: доход
            и расход были карточкой в два этажа с цифрами 22pt, долги стояли на
            белом, прибыль — на тинте и единственная без точки.
            Теперь это один `SummaryToggle`: белая строка 44pt, точка цвета
            смысла, значение тем же цветом. Тинт остался ровно за одним —
            за ВЫБРАННЫМ состоянием, и потому наконец что-то означает.
            ШЕВРОНОВ НЕТ НИ У ОДНОГО: это переключатели, и их состояние
            объявляется `expanded`, а не стрелкой, которая обещала бы уход на
            другой экран. */}
        <View className="flex-row" style={{ gap: 6 }}>
          {/* ЦВЕТ = СМЫСЛ. Возвраты могут увести доход за период в минус, и
              тогда зелёная цифра под зелёной точкой означала бы прибыль там,
              где деньги ушли. Отрицательный доход красный — по ОКРУГЛЁННЫМ
              центам (moneySign), как у «Прибыли»: сырой знак суммы флоатов
              красил бы «−€0» на хвосте в 10⁻¹⁷. Минус печатает форматтер. */}
          <SummaryToggle
            label="Доход"
            color={moneySign(totals.income) < 0 ? t.danger : t.success}
            value={formatEUR(totals.income)}
            quiet={moneySign(totals.income) === 0}
            active={view === "income"}
            onPress={() => onTap("income")}
          />
          {/* МИНУСА ЗДЕСЬ НЕТ (владелец 2026-08-15: «расход и так даёт минус»).
              Слово «Расход» и красный цвет уже сказали направление; знак был
              третьим способом сказать то же самое. */}
          <SummaryToggle
            label="Расход"
            color={t.danger}
            value={formatEUR(totals.expense)}
            quiet={moneySign(totals.expense) === 0}
            active={view === "expense"}
            onPress={() => onTap("expense")}
          />
        </View>

        <View className="flex-row" style={{ gap: 6 }}>
          <SummaryToggle
            label="Долги"
            color={t.warning}
            value={formatEUR(totals.debt)}
            quiet={moneySign(totals.debt) === 0}
            active={view === "debt"}
            onPress={() => onTap("debt")}
          />
          {/* Минус печатает сам форматтер — по округлённым центам, а не по
              сырому знаку: убыток в 0,4 цента иначе показывал «−€0». */}
          <SummaryToggle
            label="Прибыль"
            color={t.brandAccent}
            value={formatEUR(totals.profit)}
            quiet={moneySign(totals.profit) === 0}
            active={view === "profit"}
            onPress={() => onTap("profit")}
          />
        </View>

        {/* ПЛАШКИ «НДС К УПЛАТЕ» ЗДЕСЬ НЕТ (владелец 2026-08-15: «убираем, эту
            информацию переместим в другое место»). Налог — квартальный вопрос
            к бухгалтеру, а этот экран отвечает на дневной: сколько заработали
            и кто должен. Сам расчёт цел и покрыт тестами —
            `summarizeVat` в `@babun/shared/local/finance/vat`; когда владелец
            назовёт новое место, там его и зовут. */}
      </View>
    </View>
  );
}

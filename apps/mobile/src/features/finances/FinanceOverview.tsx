import { View } from "react-native";
import {
  formatEURExact as formatEUR,
  moneySign,
} from "@babun/shared/common/utils/money";
import {
  FORMS_DOCUMENT,
  formatCountRu,
} from "@babun/shared/common/utils/plural-ru";
import { useThemeColors } from "@/theme/colors";
import { TourTarget } from "@/components/tour/TourTarget";
import type { Team } from "@/features/reference/queries";
import type { Period } from "@/lib/period";
import { useTariffNudge } from "@/features/tariffs/use-tariff";
import { ScopePeriodBar } from "./finance-overview/ScopePeriodBar";
import { SummaryToggle } from "./finance-overview/SummaryToggle";
import { UNKNOWN_BALANCE_TEXT } from "./accounts";

export { PeriodRow, ScopePeriodBar } from "./finance-overview/ScopePeriodBar";
export { SummaryToggle } from "./finance-overview/SummaryToggle";

/**
 * Какую панель раскрывает сводка. Страниц среди них больше нет.
 *
 * ПРАВИЛО ПРОДУКТА (как можно меньше тапов и страниц):
 *
 *   СТРАНИЦА — ТОЛЬКО ДЛЯ ТОГО, ЧЕМ УПРАВЛЯЮТ (создать, настроить,
 *   заархивировать). ТО, НА ЧТО ПРОСТО СМОТРЯТ, РАСКРЫВАЕТСЯ НА МЕСТЕ.
 *
 * Иначе, чтобы увидеть инвойс, нужно три экрана: «Финансы» →
 * «Документы» → «Инвойсы». Страницы остаются там, где
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
  /** Сколько документов (инвойсов и чеков) за период — ровно столько строк
   *  откроется под плиткой (`usePeriodDocuments`). Плитка
   *  печатает ШТУКИ, а не деньги. */
  count: number;
}

export interface AccountTileSummary {
  /** Σ остатков набора — та же цифра, что и на странице счетов.
   *  Больше плитке ничего не нужно: она отвечает «сколько у команды», а состав
   *  (сколько счетов, сколько наличными) смотрят на самой странице счетов. */
  total: number | null;
}

export interface OverviewTotals {
  income: number;
  expense: number;
  profit: number;
  debt: number;
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
  documentsTariffLocked = false,
  showAccounts = true,
  showDebts = true,
  view,
  onTap,
  locked = false,
  lockAccounts = false,
  lockIncome = false,
  lockExpense = false,
  lockProfit = false,
  lockDebts = false,
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
  /** Документы видны этому человеку (право «Документы»). Нет — плитки нет:
   *  «Счета» занимают ряд целиком. */
  showDocuments?: boolean;
  /** Документов нет в ТАРИФЕ — плитка на месте, но серая, тап поднимает
   *  плашку «Нужно изменить тариф» (всё видно, новое
   *  серым). */
  documentsTariffLocked?: boolean;
  /** Функции компании (STORY-088): выключенные счета и долги — без плиток. */
  showAccounts?: boolean;
  showDebts?: boolean;
  view: HomeView;
  onTap: (v: HomeView) => void;
  /** ФИНАНСЫ ЭТОЙ КОМПАНИИ ЧЕЛОВЕКУ ЗАКРЫТЫ (`LockedFinances`:
   *  всё серое, всё по нулям, но переключаться можно). Период и плитки
   *  серые и не нажимаются; лента команд остаётся живой — по ней уходят в
   *  компанию, где деньги этого человека есть. */
  locked?: boolean;
  /** ЗАКРЫТ ОТДЕЛЬНЫЙ БЛОК, а не весь раздел (уровни доступа, этап 2): человек
   *  видит «Доходы и расходы» этой команды, но не видит её счета или долги.
   *  Такая плитка серая, по нулям и не нажимается — как при закрытом разделе,
   *  только поодиночке. */
  lockAccounts?: boolean;
  /** Стороны денег — два права (срез 2а): «Доход» и «Расход» гаснут
   *  поодиночке, «Прибыль» — если закрыта хоть одна из них. */
  lockIncome?: boolean;
  lockExpense?: boolean;
  /** Прибыль без материалов записей была бы неверной (сотрудник). */
  lockProfit?: boolean;
  lockDebts?: boolean;
}) {
  const tariffNudge = useTariffNudge();
  const t = useThemeColors();

  // ПРОСТО «СЧЕТА». Уточнение «команды» было нужно, пока
  // рядом существовало понятие «счёт компании» и плитка могла соврать про чей
  // это остаток. Понятия больше нет: деньги в продукте всегда чьи-то, а чьи
  // именно — говорит выбранный чип прямо над плиткой.
  const accountsTitle = "Счета";

  return (
    <View>
      <TourTarget id="finances.period" shape="strip">
        <ScopePeriodBar
          teams={teams}
          scopeTeamId={scopeTeamId}
          onScopeChange={onScopeChange}
          period={period}
          onOpenPresets={onOpenPresets}
          onOpenCustom={onOpenCustom}
          locked={locked}
        />
      </TourTarget>
      {/* overview cards */}
      <View className="px-4 pb-2 pt-2">
        {/* Обучение показывает плитки одним шагом: шесть входов одного вида. */}
        <TourTarget id="finances.tiles" style={{ gap: 6 }}>
        {/* Счета | Документы — ТОТ ЖЕ РЯД, ЧТО И СВОДКА: того же вида, что доход и расход,
            долги и прибыль. Плитки в два этажа (другой рост, другой кегль, свой
            значок) глаз читал бы как объекты другого рода, хотя это такие же
            входы в тот же экран.
            Между шестью строками нет РАЗНИЦЫ ВООБЩЕ: каждая раскрывает
            свою панель внизу и объявляет состояние через `expanded`. Шеврона
            не осталось ни у одной — уводить с экрана они перестали (см. правило
            продукта у `HomeView`).
            Точка у счетов и документов чернильная: остаток на счетах — не
            приход и не расход, у него нет знака, а документ и вовсе не деньги;
            красить их в зелёное значило бы назвать это доходом. */}
        {showAccounts || showDocuments ? (
                <View className="flex-row" style={{ gap: 6 }}>
          {showAccounts ? (
          <SummaryToggle
            label={accountsTitle}
            color={t.ink}
            value={accounts.total === null ? UNKNOWN_BALANCE_TEXT : formatEUR(accounts.total)}
            quiet={accounts.total === null || moneySign(accounts.total) === 0}
            active={view === "accounts"}
            locked={locked || lockAccounts}
            onPress={() => onTap("accounts")}
          />
          ) : null}
          {/* ДОКУМЕНТ — НЕ ДЕНЬГИ: евро в документах не показываем. Сумма к оплате
              рядом с остатком на счетах читалась бы как второй кошелёк, хотя
              это обязательство клиента, а не наши деньги. Поэтому значение —
              ШТУКИ: сколько документов ждут оплату.
              КРАСНОГО ЗДЕСЬ НЕТ: неоплаченный документ —
              ничего страшного, не надо выставлять его якобы красным. Строка
              краснела бы на просрочку и превращала бы обычный рабочий счёт в тревогу;
              состояние документа названо словом в самой его строке
              («Просрочен»), и этого достаточно. */}
          {showDocuments ? (
          <SummaryToggle
            label="Документы"
            color={t.ink}
            // НОЛЬ ДОКУМЕНТОВ — ЦИФРОЙ, а не словом «нет»: плитка считает ШТУКИ, и ноль
            // штук — такое же число, как три. Голый «0» рядом с «€450» в том же ряду мог
            // бы прочесться как сумма, но бледным его держит `quiet`.
            value={String(invoices.count)}
            quiet={invoices.count === 0}
            active={view === "documents"}
            a11yValue={`${formatCountRu(invoices.count, FORMS_DOCUMENT)} за период`}
            locked={locked}
            // Нет в тарифе — плитка на месте и серая, тап поднимает плашку
            // «Нужно изменить тариф». Без обёртки: она ломала сетку ряда.
            dimmed={documentsTariffLocked}
            onPress={documentsTariffLocked ? tariffNudge : () => onTap("documents")}
          />
          ) : null}
        </View>
        ) : null}

        {/* ПЕРЕКЛЮЧАТЕЛИ — ОДИН ОБЪЕКТ: компактно, всё в одном стиле. Разных видов
            быть не должно (карточка в два этажа с цифрами 22pt у дохода и расхода,
            белая строка у долгов, тинт у прибыли и единственная без точки).
            Это один `SummaryToggle`: белая строка 44pt, точка цвета
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
            locked={locked || lockIncome}
            onPress={() => onTap("income")}
          />
          {/* МИНУСА ЗДЕСЬ НЕТ (расход и так даёт минус).
              Слово «Расход» и красный цвет уже сказали направление; знак был
              третьим способом сказать то же самое. */}
          <SummaryToggle
            label="Расход"
            color={t.danger}
            value={formatEUR(totals.expense)}
            quiet={moneySign(totals.expense) === 0}
            active={view === "expense"}
            locked={locked || lockExpense}
            onPress={() => onTap("expense")}
          />
        </View>

                <View className="flex-row" style={{ gap: 6 }}>
          {showDebts ? (
          <SummaryToggle
            label="Долги"
            color={t.warning}
            value={formatEUR(totals.debt)}
            quiet={moneySign(totals.debt) === 0}
            active={view === "debt"}
            locked={locked || lockDebts}
            onPress={() => onTap("debt")}
          />
          ) : null}
          {/* Минус печатает сам форматтер — по округлённым центам, а не по
              сырому знаку: убыток в 0,4 цента иначе показывал «−€0». */}
          <SummaryToggle
            label="Прибыль"
            color={t.brandAccent}
            value={formatEUR(totals.profit)}
            quiet={moneySign(totals.profit) === 0}
            active={view === "profit"}
            locked={locked || lockIncome || lockExpense || lockProfit}
            onPress={() => onTap("profit")}
          />
        </View>
        </TourTarget>

        {/* ПЛАШКИ «НДС К УПЛАТЕ» ЗДЕСЬ НЕТ: информацию о налоге переносят в другое место.
            Налог — квартальный вопрос
            к бухгалтеру, а этот экран отвечает на дневной: сколько заработали
            и кто должен. Сам расчёт цел и покрыт тестами —
            `summarizeVat` в `@babun/shared/local/finance/vat`; когда появится
            новое место, там его и зовут. */}
      </View>
    </View>
  );
}

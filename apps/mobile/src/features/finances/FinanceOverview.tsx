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
  locked = false,
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
  /** ДЕНЕГ ЗА СТРОКОЙ ЭТОМУ ЧЕЛОВЕКУ НЕ ПОКАЗЫВАЮТ (владелец 15.09: «доход
   *  серым, расход серым, долги серым, прибыль серым»). Точка, ярлык и
   *  значение — одним серым, строка не нажимается. Цвет смысла здесь соврал
   *  бы: зелёная точка у «Дохода» обещает деньги, которых экран не считал. */
  locked?: boolean;
  onPress: () => void;
}) {
  const t = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={locked}
      accessibilityRole="button"
      accessibilityState={{ expanded: active, disabled: locked }}
      // Закрытая строка не называет сумму вслух: «Доход: €0» прозвучал бы
      // фактом о деньгах, а их здесь просто не показывают.
      accessibilityLabel={`${label}: ${locked ? "нет доступа" : (a11yValue ?? value)}`}
      // Строка 38pt + зазор 6pt между рядами: цель касания добирает до 44
      // за счёт зазора, вид не меняется (тот же приём, что у Chip).
      hitSlop={{ top: 3, bottom: 3 }}
      className="flex-row items-center rounded-[10px] px-3.5 active:opacity-70"
      style={{
        // РОВНО ПОЛОВИНА РЯДА, А НЕ «СКОЛЬКО ПОПРОСИТ СОДЕРЖИМОЕ». Ширину
        // задаёт сетка, а не длина подписи: иначе «Счета | Документы» едут
        // относительно «Доход | Расход» — на узком экране совпадали, на
        // широком разъезжались на 12pt (поймано владельцем 20.09 на Pro Max,
        // измерено по пикселям: 572 и 646 против 609 и 609 у соседних рядов).
        // Базис нулевой и `minWidth: 0` — длинная подпись ужимается внутри
        // своей половины, а не отбирает место у соседней плитки.
        flexBasis: 0,
        flexGrow: 1,
        flexShrink: 1,
        minWidth: 0,
        minHeight: 38,
        // `1a` — тот же тинт, что у выбранного чипа: 10% цвета читается как
        // подсветка, но не спорит со значением, набранным тем же цветом.
        // Тинта ХВАТАЕТ: цветная рамка была третьей грамматикой выбора на
        // продукт (у Chip — заливка, у оттиск-рядов — углубление материала), и
        // 1.5px контур нигде больше не встречался.
        backgroundColor: active && !locked ? color + "1a" : t.surface,
        borderCurve: "continuous",
      }}
    >
      <View
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: locked ? t.muted : color }}
      />
      <Text
        className="ml-2 text-sm font-semibold"
        style={{ color: locked ? t.muted : t.sub }}
      >
        {label}
      </Text>
      <Text
        className={`ml-auto text-[15px] ${quiet || locked ? "font-semibold" : "font-bold"}`}
        style={{
          color: locked ? t.muted : quiet ? t.caption : color,
          fontVariant: ["tabular-nums"],
        }}
      >
        {value}
      </Text>
    </Pressable>
  );
}

/**
 * ЛЕНТА КОМАНД И СТРОКА ПЕРИОДА — ШАПКА ДЕНЕЖНЫХ ЭКРАНОВ. Одна вёрстка на
 * «Финансы» и «Аналитику» (владелец 2026-09-24: «всю нашу настройку, которую
 * мы использовали в финансах, такую же используй в аналитике»): две копии
 * разошлись бы на первой правке отступа.
 */
/** Id чипа «вся компания» — не пересекается ни с одним календарём. */
const ALL_TEAMS_CHIP = "__all_teams__";

export function ScopePeriodBar({
  teams,
  scopeTeamId,
  onScopeChange,
  period,
  onOpenPresets,
  onOpenCustom,
  locked = false,
  allLabel,
}: {
  teams: Team[];
  scopeTeamId: string | null;
  onScopeChange: (id: string | null) => void;
  period: Period;
  onOpenPresets: () => void;
  onOpenCustom: () => void;
  locked?: boolean;
  /** Чип «вся компания» первым в ленте — ТОЛЬКО у «Аналитики» (владелец
   *  2026-09-24: «кнопку „Все команды“, аналитика может быть по всем
   *  командам»). На «Финансах» его нет и не будет: деньги там всегда чьи-то
   *  (закон 2026-08-10), а итог компании — ровно вопрос аналитики. Выбран —
   *  `scopeTeamId === null`. */
  allLabel?: string;
}) {
  const t = useThemeColors();
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
        items={
          allLabel
            ? [{ id: ALL_TEAMS_CHIP, name: allLabel }, ...calendarChips.items]
            : calendarChips.items
        }
        // Пока идёт переход в другую компанию, подсвечен выбранный чип, а не
        // прежний: касание обязано отвечать сразу.
        activeId={
          calendarChips.pendingId ??
          (allLabel && scopeTeamId === null ? ALL_TEAMS_CHIP : scopeTeamId)
        }
        seam={false}
        onSelect={(id) =>
          id === ALL_TEAMS_CHIP ? onScopeChange(null) : calendarChips.pick(id)
        }
      />

      {/* period row — NAME opens the preset list, DATES open the wheels.
          У закрытых финансов ряд серый и глухой: месяц назван, а выбирать
          период не для чего — денег за ним не покажут. */}
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
          accessibilityLabel={`Период: ${periodTitle(period)}`}
          accessibilityState={{ disabled: locked }}
          className="flex-row items-center gap-1 py-2 active:opacity-60"
        >
          <Text
            className="text-[15px] font-semibold"
            style={{ color: locked ? t.muted : t.ink }}
          >
            {periodTitle(period)}
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
            {periodDates(period)}
          </Text>
        </Pressable>
      </View>
    </>
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
  showAccounts = true,
  showDebts = true,
  view,
  onTap,
  locked = false,
  lockAccounts = false,
  lockOps = false,
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
  /** Документы есть в тарифе. Нет — плитки нет ВОВСЕ (канон: без права блок
   *  не показывается либо только читается; «видно, но при нажатии ошибка» в
   *  продукте не бывает). «Счета» занимают ряд целиком. */
  showDocuments?: boolean;
  /** Функции компании (STORY-088): выключенные счета и долги — без плиток. */
  showAccounts?: boolean;
  showDebts?: boolean;
  view: HomeView;
  onTap: (v: HomeView) => void;
  /** ФИНАНСЫ ЭТОЙ КОМПАНИИ ЧЕЛОВЕКУ ЗАКРЫТЫ (`LockedFinances`, владелец 15.09:
   *  «всё серое, всё по нулям, но переключаться можно»). Период и плитки
   *  серые и не нажимаются; лента команд остаётся живой — по ней уходят в
   *  компанию, где деньги этого человека есть. */
  locked?: boolean;
  /** ЗАКРЫТ ОТДЕЛЬНЫЙ БЛОК, а не весь раздел (уровни доступа, этап 2): человек
   *  видит «Доходы и расходы» этой команды, но не видит её счета или долги.
   *  Такая плитка серая, по нулям и не нажимается — как при закрытом разделе,
   *  только поодиночке. */
  lockAccounts?: boolean;
  lockOps?: boolean;
  lockDebts?: boolean;
}) {
  const t = useThemeColors();

  // ПРОСТО «СЧЕТА» (владелец 2026-08-11). Уточнение «команды» было нужно, пока
  // рядом существовало понятие «счёт компании» и плитка могла соврать про чей
  // это остаток. Понятия больше нет: деньги в продукте всегда чьи-то, а чьи
  // именно — говорит выбранный чип прямо над плиткой.
  const accountsTitle = "Счета";

  return (
    <View>
      <ScopePeriodBar
        teams={teams}
        scopeTeamId={scopeTeamId}
        onScopeChange={onScopeChange}
        period={period}
        onOpenPresets={onOpenPresets}
        onOpenCustom={onOpenCustom}
        locked={locked}
      />
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
        {showAccounts || showDocuments ? (
        <View className="flex-row" style={{ gap: 6 }}>
          {showAccounts ? (
          <SummaryToggle
            label={accountsTitle}
            color={t.ink}
            value={formatEUR(accounts.total)}
            quiet={moneySign(accounts.total) === 0}
            active={view === "accounts"}
            locked={locked || lockAccounts}
            onPress={() => onTap("accounts")}
          />
          ) : null}
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
            // НОЛЬ ДОКУМЕНТОВ — ЦИФРОЙ (владелец 2026-09-20: «в документах
            // написано „нет“, а надо нолик поставить»). Здесь стояло слово:
            // боялись, что голый «0» рядом с «€450» в том же ряду прочтётся
            // как сумма. Владелец прочёл иначе: плитка считает ШТУКИ, и ноль
            // штук — такое же число, как три. Бледным его держит `quiet`.
            value={String(invoices.openCount)}
            quiet={invoices.openCount === 0}
            active={view === "documents"}
            // Глагол склоняется вместе с числительным: «1 документ ждёт»,
            // а не «1 документ ждут».
            a11yValue={`${formatCountRu(invoices.openCount, FORMS_DOCUMENT)} ${pluralRu(
              invoices.openCount,
              ["ждёт", "ждут", "ждут"],
            )} оплаты`}
            locked={locked}
            onPress={() => onTap("documents")}
          />
          ) : null}
        </View>
        ) : null}

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
            locked={locked || lockOps}
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
            locked={locked || lockOps}
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
            locked={locked || lockOps}
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

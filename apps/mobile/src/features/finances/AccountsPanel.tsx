import { useMemo, type ReactElement } from "react";
import { ScrollView, Text, View, type RefreshControlProps } from "react-native";
import { money, moneySign } from "@babun/shared/common/utils/money";
import { haptics } from "@/lib/haptics";
import { accountEditHref } from "./account-editor/editor-logic";
import type { FinanceTransaction } from "@babun/shared/local/finance/transaction";
import { EmptyState } from "@/components/ui/EmptyState";
import { GUTTER } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import {
  PaymentTile,
  TILE_GAP,
  useTileWidth,
} from "@/features/appointments/PaymentTiles";
import type { AccountWithBalance } from "./accounts";
import { accountIcon } from "./account-ui";
import { accountOperationRows } from "./account-operations";
import { sortAccountRows } from "./accounts-sections";
import { PanelHeader, panelCount } from "./PanelHeader";
import {
  dropAccountNames,
  rowsNet,
  type RecordRow,
  type RecordRowRefs,
} from "./record-rows";
import { RecordRowsPanel } from "./RecordRowsPanel";

// СЧЕТА РАСКРЫВАЮТСЯ ЗДЕСЬ, А НЕ УВОДЯТ (владелец 2026-08-11: «перекинем
// вниз, в операции»). Ответ «где лежат деньги» — такой же срез команды, как
// доход и долги, и уходить за ним на другой экран незачем.
//
// ЛЕНТА СЧЁТА — ПРЯМО ПОД ПЛИТКАМИ (владелец 2026-09-15: «нажимаю „Наличные“ —
// вниз листаются все операции по наличным; нажимаю „Карта“ — по карте»). Тап
// выбирает счёт, и лента ниже показывает только его; без выбора лента — все
// счета команды. Отдельной страницы операций счёта больше нет.
//
// ВТОРОЙ ТАП СНИМАЕТ ВЫБОР, А НЕ УВОДИТ (владелец 2026-09-15: «когда нажимаю
// второй раз — это снимается, вот и всё; переход в настройки нужно продумать
// по-другому»). Раньше тот же тап открывал настройки счёта: жест был
// невидим, а снять выбор можно было только словом «Все» над лентой — второй
// дверью к тому, что уже умеет сама плитка. «Все» ушло вместе с ним.
//
// ДВЕРЬ В СЧЕТА — ПОЛЗУНКИ В ШАПКЕ «СЧЕТА» (владелец 2026-09-15: «когда я
// захожу в счета — есть счета, два; справа сделай строчки. Я нажимаю на эти
// строчки — перекидывается именно на страницу»). Там порядок перетаскиванием,
// скрытие свайпом и правка каждого счёта шторкой — одна страница на всё, та
// же, что за шестерёнкой «Финансов». Отдельной двери в настройки у ленты
// выбранного счёта больше нет: в счёт входят через эту страницу.
//
// СЧЕТА — ПЛИТКАМИ, КАК В ОПЛАТЕ (владелец 2026-09-15: «как в счёт оплаты… и
// можно было вправо листать»). Та же плитка, что в блоке оплаты и в форме
// операции (`PaymentTile`): цвет и значок счёта, имя и остаток. Плитки идут
// одной лентой; то, что не влезло, уезжает вправо. Порядок — порядок счетов
// (`sortAccountRows`: место счёта, потом имя).
//
// ПЛИТКИ СТОЯТ НА МЕСТЕ (владелец 2026-09-15: «блок с наличными и картой
// остаётся, когда я листаю операции»): листается только лента под ними, и
// переключить счёт можно, не возвращаясь наверх.
export function AccountsPanel({
  accounts,
  transactions,
  refs,
  selectedId,
  onSelect,
  onOpen,
  onOpenRecord,
  refreshControl,
  canOpenSettings = true,
}: {
  /** Ровно тот набор, который просуммирован плиткой «Счета»: плитки и цифра
   *  над ними обязаны сходиться пальцем. */
  accounts: AccountWithBalance[];
  /** Журнал периода: вторая нога перевода может лежать на невыбранном счёте. */
  transactions: readonly FinanceTransaction[];
  refs: RecordRowRefs;
  /** Чья лента под плитками (`null` — всех счетов). Выбор держит экран, а не
   *  панель: от него зависит кнопка внизу экрана, а запись, открытая из ленты
   *  счёта, возвращает человека к ТОМУ ЖЕ счёту через адрес
   *  (`resolveReturnTo`). */
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onOpen: (href: string) => void;
  /** Дверь на страницу «Счета» (порядок, правка, архив). В срезе 1 она
   *  владельческая: уровни внутри самой страницы — следующий шаг, а ползунков,
   *  которые упрутся в отказ, быть не должно. */
  canOpenSettings?: boolean;
  /** Та же дверь строки, что у остальных панелей «Финансов». */
  onOpenRecord: (row: RecordRow) => void;
  /** Pull-to-refresh хозяина экрана (U86) — один жест на все панели. */
  refreshControl?: ReactElement<RefreshControlProps>;
}) {
  const t = useThemeColors();
  // Ширина плитки оплаты: три в ряд. В ленте во всю ширину экрана четвёртая
  // выглядывает справа — видно, что счетов больше и ленту листают.
  const tileWidth = useTileWidth();
  const rows = useMemo(() => sortAccountRows(accounts), [accounts]);
  // Счёт могли закрыть или увести в другую команду, пока он был выбран: тогда
  // лента возвращается ко всем счетам, а не показывает пустоту по пропавшему.
  const selected = rows.find((account) => account.id === selectedId) ?? null;
  const ids = useMemo(
    () => new Set(selected ? [selected.id] : rows.map((account) => account.id)),
    [selected, rows],
  );
  const operationRows = useMemo(() => {
    const feed = accountOperationRows(transactions, ids, refs);
    // Выбран счёт — его имя стоит заголовком ленты, в строках оно было бы
    // повтором (`dropAccountNames`).
    return selected ? dropAccountNames(feed) : feed;
  }, [transactions, ids, refs, selected]);

  // ОБОРОТ ВЫБРАННОГО СЧЁТА ЗА ПЕРИОД (владелец 2026-09-23, идея из отчёта
  // по счетам): остаток говорит «сколько лежит», а заголовок ленты — «сколько
  // прошло через счёт за период». Правило то же, что у итога дня (`rowsNet`),
  // поэтому число сходится с суммой дней ниже пальцем. У ленты всех счетов его
  // нет: там это «Прибыль» плитки выше, второй раз одно число не печатаем.
  const periodNet = selected ? rowsNet(operationRows) : null;
  const netSign = periodNet === null ? 0 : moneySign(periodNet);

  const header = (
    <PanelHeader
      title={panelCount("Счета", rows.length)}
      onSettings={canOpenSettings ? () => onOpen("/accounts/settings") : undefined}
      settingsLabel="Счета: порядок и настройки"
    />
  );

  if (rows.length === 0) {
    return (
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 96 }}
        refreshControl={refreshControl}
      >
        {header}
        {/* Только слова (владелец 2026-09-15: «никаких кнопок внутри»), и
            без указки на кнопки: двери к созданию — ползунки шапки и футер. */}
        <EmptyState
          title="У команды нет счетов"
          subtitle="Счёт — это касса или карта, где лежат деньги команды."
        />
      </ScrollView>
    );
  }

  const tiles = (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      // Без `flexGrow: 0` горизонтальная лента в колонке тянется по высоте и
      // делит экран пополам с лентой операций.
      style={{ flexGrow: 0 }}
      contentContainerStyle={{
        paddingHorizontal: GUTTER,
        paddingTop: 2,
        paddingBottom: 6,
        gap: TILE_GAP,
      }}
    >
      {rows.map((account) => {
        const isSelected = selected?.id === account.id;
        const sign = moneySign(account.balance);
        return (
          <PaymentTile
            key={account.id}
            icon={accountIcon(account)}
            label={account.name}
            color={account.color ?? t.ink}
            tint={account.color}
            width={tileWidth}
            // «Ещё немножечко компактней»: значок в строку с именем, 44pt.
            compact
            // Выбран другой — эта гаснет, но нажимается: видно, чья лента
            // ниже, и переключиться можно одним тапом.
            state={selected && !isSelected ? "dim" : "idle"}
            selected={isSelected}
            amount={money(account.balance)}
            // Минус — долг; ноль тише живых денег: иначе глаз не находит, где
            // деньги.
            amountColor={sign < 0 ? t.danger : sign === 0 ? t.sub : undefined}
            onPress={() => onSelect(isSelected ? null : account.id)}
            // ДОЛГОЕ НАЖАТИЕ — НАСТРОЙКИ ЭТОГО СЧЁТА (владелец 2026-09-15:
            // «переход в настройки нужно продумать по-другому» — тап занят
            // выбором ленты). Та же шторка, что на странице «Счета».
            onLongPress={
              canOpenSettings
                ? () => {
                    haptics.tap();
                    onOpen(accountEditHref(account.id) as string);
                  }
                : undefined
            }
            // «Выбран» озвучивает `accessibilityState` плитки — в подписи
            // слово было бы повтором. Подсказку отдельным `accessibilityHint`
            // плитка пока не принимает, поэтому действие остаётся в подписи.
            accessibilityLabel={[
              account.name,
              money(account.balance),
              isSelected
                ? "нажмите ещё раз, чтобы показать все счета"
                : "показать операции счёта",
            ].join(", ")}
          />
        );
      })}
    </ScrollView>
  );

  return (
    <View style={{ flex: 1 }}>
      {header}
      {tiles}
      {/* ЗАГОЛОВОК ЛЕНТЫ СТОИТ С ПЛИТКАМИ, А НЕ УЕЗЖАЕТ СО СПИСКОМ: он
          называет, чья лента под ними, и после короткой прокрутки выбранная
          плитка не остаётся без подписи. Значка у него нет — дверь в счета
          одна, ползунки шапки «Счета». */}
      <PanelHeader
        title={panelCount(selected ? selected.name : "Операции", operationRows.length)}
        right={
          periodNet !== null && netSign !== 0 ? (
            <Text
              maxFontSizeMultiplier={1.3}
              accessibilityLabel={`За период ${netSign > 0 ? "плюс" : "минус"} ${money(Math.abs(periodNet))}`}
              style={{
                fontSize: 13,
                fontWeight: "600",
                fontVariant: ["tabular-nums"],
                color: netSign > 0 ? t.success : t.danger,
              }}
            >
              {`${netSign > 0 ? "+" : "−"}${money(Math.abs(periodNet))}`}
            </Text>
          ) : undefined
        }
      />
      <RecordRowsPanel
        rows={operationRows}
        emptyTitle={
          selected
            ? `По счёту «${selected.name}» за период операций не было`
            : "Операций за период не было"
        }
        refreshControl={refreshControl}
        onOpenRecord={onOpenRecord}
      />
    </View>
  );
}

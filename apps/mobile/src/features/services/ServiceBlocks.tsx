import { Fragment } from "react";
import { Alert, Keyboard, Pressable, Text, TextInput, View } from "react-native";
import { Trash2 } from "lucide-react-native";

import { FieldLabel } from "@/components/ui/Field";
import { SwipeRow } from "@/components/ui/SwipeRow";
import { TimeWheelPair } from "@/components/ui/TimeWheel";
import { GUTTER } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import { durationLabel, tierSentence } from "./format";
import {
  displayValue,
  draftValue,
  type PriceEntryMode,
  type ServiceEconomicsDraft,
  type ServiceTierDraft,
} from "./economics";

// ОДНО КОЛИЧЕСТВО — ОДНА СТРОКА, И В НЕЙ НЕТ НИ ОДНОЙ ПОДПИСИ.
//
// Пятая редакция этого блока. Приговор владельца 2026-08-25 предыдущей:
// «я хочу, чтоб это было в одну строчку — не полноценный какой-то здоровый
// блок и под каждое всё три блока огромное; нет, одна маленькая аккуратная».
// До этого падали ещё три: таблица с колонками, четыре залитые плиты с шапкой
// и сетка табличек 2×2, где подпись стояла внутри своей клетки.
//
// ПРИЧИНА ВСЕХ ЧЕТЫРЁХ ПАДЕНИЙ ОДНА: место занимали ПОДПИСИ, а не числа.
// «Расход за всё» — 86pt, само число «−€6» — 34pt. Подпись в два с половиной
// раза шире того, что подписывает, и именно она заставляла числа переноситься
// на второй ряд, а блок — расти до 162pt на одно количество.
//
// ЧЕМ ЗАМЕНЕНЫ ПОДПИСИ: значения подписывают себя сами.
//   «3 м»    — количество названо единицей, а не словом «количество»;
//   «€135»   — знак валюты вместо слова «цена»;
//   «1 ч 30» — частицы времени вместо слов «время на всё»;
//   «−€18»   — минус вместо слова «расход», и он же приглушён `t.sub`.
// Ход подсказан живой строкой счёта на проде — «Трасса, 4 м»: человек уже
// пишет количество с единицей и без всякой подписи, потому что так короче и
// понятнее. Подписи никуда не делись из продукта — они ушли в озвучку
// (`accessibilityLabel`), где и нужны: для незрячего «€» подписью не является.
//
// АРИФМЕТИКА (346pt внутри карточки), сходится во всех четырёх раскладах:
//   лестница + расход:   72 + 8 + 70(flex) + 12 + 104 + 8 + 72 = 346
//   лестница без расхода: 72 + 8 + 150(flex) + 12 + 104        = 346
//   одна строка:          56 + 8 + 166(flex) + 12 + 104        = 346
//   одна строка + расход: 56 + 8 + 86(flex) + 12 + 104 + 8 + 72 = 346
// Высота одного количества — 48pt против 162 в забракованном блоке; лестница
// из трёх — 146 против ≈500.
//
// ЗАЗОР ПЕРЕД ВРЕМЕНЕМ 12, А НЕ 8: цена прижата вправо, время тоже, и между
// кареткой цены и нажимаемым временем должно остаться расстояние, которое
// палец не перепрыгнет. 8pt — это полтора миллиметра.

/** Потолок барабана: часы кольцом 0–23, минуты по 5. Больше суток услуга не
 *  длится, а ветка «конец суток» у примитива при 23 не срабатывает никогда. */
export const MAX_DURATION = 23 * 60 + 55;

/** Восемь слов покрывают выездной сервис, клининг и отделку. Своего текста в
 *  первой поставке нет намеренно: свободная строка немедленно даёт «м2», «м²»,
 *  «кв.м» и «метр» в одном прайсе, и в счёте это выглядит неряшливо. */
export const SERVICE_UNITS = ["шт", "м", "м²", "м³", "ч", "компл", "кг", "л"];

const QTY_W_LADDER = 72;
const QTY_W_SINGLE = 56;
// 104, а не 96: «1 ч 20 мин» при 16pt не влезало и обрывалось многоточием.
// Отобрано у цены — там запас есть, у времени его нет.
const TIME_W = 104;
const COST_W = 72;
const ROW_H = 48;

export function roundToStep(minutes: number): number {
  return Math.min(MAX_DURATION, Math.max(0, Math.round(minutes / 5) * 5));
}

function readMinutes(raw: string): number {
  const parsed = Number(raw.trim().replace(",", "."));
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
}

function readQuantity(raw: string): number {
  const parsed = Number(raw.trim().replace(",", "."));
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 1;
}

function hasMoney(raw: string): boolean {
  const parsed = Number(raw.trim().replace(",", "."));
  return Number.isFinite(parsed) && parsed !== 0;
}

/** ОДНА ПАНЕЛЬ НА ВЕСЬ ЛИСТ, И ОНА ЖЕ ПЕРЕЖИВАЕТ СМЕНУ УСЛУГИ.
 *
 *  Лист висит в дереве всегда и лишь гасится пропом `visible`, поэтому
 *  собственный `useState` переезжал бы от услуги к услуге. Кодировка:
 *    null            — всё закрыто
 *    "settings"      — под карточкой панель «Как считаем»
 *    "<rowId>|wheel" — под строкой барабан времени */
export const SETTINGS_PANEL = "settings";
const SETTINGS = SETTINGS_PANEL;
const wheelOn = (open: string | null, id: string) => open === `${id}|wheel`;

interface Row {
  id: string;
  /** `null` — первая строка: её количество и есть «1», менять нечего. */
  qty: string | null;
  price: string;
  cost: string;
  duration: string;
  onQty?: (v: string) => void;
  onPrice: (v: string) => void;
  onCost: (v: string) => void;
  onDuration: (v: string) => void;
}

export function ServiceBlocks({
  price,
  cost,
  duration,
  value,
  unit,
  priceEntry,
  costShown,
  onCostShownChange,
  openRow,
  onOpenRow,
  onPriceChange,
  onCostChange,
  onDurationChange,
  onUnitChange,
  onPriceEntryChange,
  onChange,
  currencySymbol = "€",
}: {
  /** Цена, расход и время ПЕРВОЙ строки — это числа самой услуги. */
  price: string;
  cost: string;
  duration: string;
  value: ServiceEconomicsDraft;
  /** Единица измерения услуги. `null` — «продаём штуками, слово лишнее». */
  unit: string | null;
  priceEntry: PriceEntryMode;
  /** Расход показан столбцом. Отдельный флаг, а не «есть ли ненулевое
   *  число»: расход включают ДО того, как впишут первую цифру, и ноль в нём
   *  законен — гарантийный выезд ничего не стоит компании. */
  costShown: boolean;
  onCostShownChange: (shown: boolean) => void;
  openRow: string | null;
  onOpenRow: (id: string | null) => void;
  onPriceChange: (value: string) => void;
  onCostChange: (value: string) => void;
  onDurationChange: (value: string) => void;
  onUnitChange: (unit: string | null) => void;
  onPriceEntryChange: (mode: PriceEntryMode) => void;
  onChange: (value: ServiceEconomicsDraft) => void;
  /** Знак валюты ТЕНАНТА. Зашитый «€» ломал мультитенантность: у компании в
   *  Польше прайс печатался бы в чужой валюте. */
  currencySymbol?: string;
}) {
  const t = useThemeColors();
  const tiers = value.tiers;
  const ladder = tiers.length > 0;
  const qtyW = ladder ? QTY_W_LADDER : QTY_W_SINGLE;
  // РАСХОД ВКЛЮЧЁН НА ВСЮ УСЛУГУ, А НЕ ПОСТРОЧНО. Расход во второй строке при
  // пустой первой оставляет дыру в столбце — а сравнивать деньги сверху вниз и
  // есть единственная причина, по которой его просили показывать.
  // Показан, если включили руками ИЛИ если у услуги он уже заведён: открыв
  // старую услугу с расходом, человек обязан увидеть свои деньги сразу.
  const showCost =
    costShown || hasMoney(cost) || tiers.some((tier) => hasMoney(tier.rowCost));
  const settingsOpen = openRow === SETTINGS;

  const updateTier = (id: string, patch: Partial<ServiceTierDraft>) =>
    onChange({
      ...value,
      tiers: tiers.map((tier) => (tier.id === id ? { ...tier, ...patch } : tier)),
    });

  const removeTier = (id: string) => {
    const tier = tiers.find((x) => x.id === id);
    if (!tier) return;
    // СИСТЕМНЫЙ алерт, а не нижний лист: мы внутри `BottomSheet` (RN Modal), и
    // канонический лист выбора уйдёт ЗА модалку.
    Alert.alert(
      "Убрать «от " + (tier.minQuantity.trim() || "…") + "»?",
      tierSentence(tier),
      [
        { text: "Отмена", style: "cancel" },
        {
          text: "Убрать",
          style: "destructive",
          onPress: () => {
            onOpenRow(null);
            onChange({ ...value, tiers: tiers.filter((x) => x.id !== id) });
          },
        },
      ],
    );
  };

  const rows: Row[] = [
    {
      id: "base",
      qty: null,
      price,
      cost,
      duration,
      onPrice: onPriceChange,
      onCost: onCostChange,
      onDuration: onDurationChange,
    },
    ...tiers.map((tier) => ({
      id: tier.id,
      qty: tier.minQuantity,
      price: tier.rowPrice,
      cost: tier.rowCost,
      duration: tier.totalDuration,
      onQty: (v: string) => updateTier(tier.id, { minQuantity: v }),
      onPrice: (v: string) => updateTier(tier.id, { rowPrice: v }),
      onCost: (v: string) => updateTier(tier.id, { rowCost: v }),
      onDuration: (v: string) => updateTier(tier.id, { totalDuration: v }),
    })),
  ];

  const openSettings = () => {
    Keyboard.dismiss();
    onOpenRow(settingsOpen ? null : SETTINGS);
  };

  /** Суффикс режима: в «за одну» каждое число уточняет, за что оно. */
  const perSuffix = priceEntry === "unit" ? (unit ? ` /${unit}` : " /1") : "";

  /** Цена, которая ФАКТИЧЕСКИ действует на этой строке, когда своя пустая:
   *  резолвер берёт последнюю заполненную сверху (`pricePerUnit`). Пустая
   *  клетка молчала, и человек читал её как «цены нет» — хотя цена есть,
   *  просто унаследованная. */
  const inheritedPrice = (index: number): string => {
    for (let i = index - 1; i >= 0; i -= 1) {
      const above = i === 0 ? price : tiers[i - 1].rowPrice;
      if (above.trim() !== "") return above;
    }
    return "";
  };

  const renderRow = (row: Row, index: number) => {
    const quantity = row.qty === null ? 1 : readQuantity(row.qty);
    const wheel = wheelOn(openRow, row.id);
    const minutes = roundToStep(readMinutes(row.duration));
    const emptyTime = row.duration.trim() === "";

    const body = (
      <View>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            height: ROW_H,
            paddingHorizontal: 12,
          }}
          accessibilityActions={
            row.qty === null
              ? undefined
              : [{ name: "delete", label: "Убрать количество" }]
          }
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === "delete") removeTier(row.id);
          }}
        >
          {/* ── КОЛИЧЕСТВО. У первой строки это «1» и править нечем: тап по
                нему открывает «Как считаем» — мёртвых зон на экране быть не
                должно. */}
          <View style={{ width: qtyW, flexDirection: "row", alignItems: "center" }}>
            {ladder ? (
              <Text
                maxFontSizeMultiplier={1.2}
                style={{ fontSize: 15, fontWeight: "400", color: t.faint }}
              >
                от{" "}
              </Text>
            ) : null}
            {row.qty === null ? (
              // Цель — ВЕСЬ слот, а не цифра: «1» шириной в десять пунктов
              // пальцем не берётся, и панель «Как считаем» была недостижима.
              <Pressable
                onPress={openSettings}
                accessibilityRole="button"
                accessibilityLabel={`Количество, 1${unit ? ` ${unit}` : ""} — как считаем`}
                style={{
                  flex: 1,
                  height: ROW_H,
                  justifyContent: "center",
                }}
              >
                <Text
                  maxFontSizeMultiplier={1.2}
                  className="tabular-nums"
                  style={{ fontSize: 16, fontWeight: "600", color: t.ink }}
                >
                  1
                </Text>
              </Pressable>
            ) : (
              <TextInput
                value={row.qty}
                onChangeText={(v) => row.onQty?.(v)}
                keyboardType="number-pad"
                selectTextOnFocus
                maxFontSizeMultiplier={1.2}
                accessibilityLabel={`Количество${unit ? `, ${unit}` : ""}`}
                selectionColor={t.accent}
                keyboardAppearance="light"
                className="tabular-nums"
                style={{
                  minWidth: 18,
                  padding: 0,
                  fontSize: 16,
                  fontWeight: "600",
                  color: t.ink,
                }}
              />
            )}
            {unit ? (
              <Pressable
                onPress={openSettings}
                onLongPress={row.qty === null ? undefined : () => removeTier(row.id)}
                delayLongPress={400}
                accessibilityRole="button"
                accessibilityLabel="Единица измерения"
                style={{ height: ROW_H, justifyContent: "center", paddingLeft: 3 }}
              >
                <Text
                  maxFontSizeMultiplier={1.2}
                  style={{ fontSize: 15, fontWeight: "500", color: t.sub }}
                >
                  {unit}
                </Text>
              </Pressable>
            ) : null}
          </View>

          {/* ── ЦЕНА. Знак валюты — отдельный Text у кромки числа, а не внутри
                значения: `selectTextOnFocus` стёр бы его вместе с цифрами, а
                `Number("€50")` — это NaN. Долгое нажатие по знаку открывает
                «Как считаем»: подписи, по которой раньше туда тапали, больше
                нет, и целью стал сам знак. */}
          <Slot
            flex
            align="right"
            label={`Цена${priceEntry === "unit" ? ` за 1 ${unit ?? ""}`.trimEnd() : " за всё"}`}
            prefix={currencySymbol}
            suffix={perSuffix}
            value={displayValue(row.price, quantity, priceEntry)}
            muted={!hasMoney(row.price)}
            // Плейсхолдер — не «—», а та цена, которая на этой строке
            // действительно сработает. Пустая цена ступени законна (лестницы
            // цены и времени независимы), но она означает «как выше», а не
            // «бесплатно», и это должно быть видно без единого тапа.
            placeholder={
              index === 0
                ? "—"
                : displayValue(inheritedPrice(index), quantity, priceEntry) || "—"
            }
            onChangeText={(v) => row.onPrice(draftValue(v, quantity, priceEntry))}
            onPrefixLongPress={openSettings}
          />

          <View style={{ width: 12 }} />

          {/* ── ВРЕМЯ. Барабан — закон продукта (ДС §5), полем ввода не
                заменяется. Открытая строка печатает своё время акцентом:
                «что я правлю» показывает место, метка не нужна. */}
          <Pressable
            onPress={() => {
              Keyboard.dismiss();
              onOpenRow(wheel ? null : `${row.id}|wheel`);
            }}
            accessibilityRole="button"
            accessibilityState={{ expanded: wheel }}
            accessibilityLabel={`Время${
              priceEntry === "unit" ? " за одну" : " на всё"
            }: ${emptyTime ? "не задано" : durationLabel(minutes)}`}
            style={{
              width: TIME_W,
              height: ROW_H,
              justifyContent: "center",
              alignItems: "flex-end",
            }}
          >
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.85}
              maxFontSizeMultiplier={1.2}
              className="tabular-nums"
              style={{
                fontSize: 16,
                fontWeight: wheel ? "700" : "600",
                color: wheel ? t.accent : emptyTime ? t.muted : t.ink,
              }}
            >
              {/* СУФФИКС РЕЖИМА ВРЕМЕНИ НЕ ПОЛОЖЕН. «30 мин /м» рядом с
                  «€45 /м» — два одинаковых хвоста в одной строке, и первым же
                  делом они съели ширину: время обрывалось многоточием. Что
                  время задано за одну штуку, говорит сам барабан строкой
                  «30 мин × 3 = 1 ч 30 мин». */}
              {emptyTime ? "—" : durationLabel(minutes)}
            </Text>
          </Pressable>

          {showCost ? (
            <>
              <View style={{ width: 8 }} />
              {/* ── РАСХОД тише цены целиком: красным он быть не может
                    (`danger` в продукте — это долг и разрушение), полным ink —
                    тоже, потому что до клиента не доходит вовсе. */}
              <Slot
                width={COST_W}
                align="right"
                label={`Расход${priceEntry === "unit" ? " за одну" : " за всё"}`}
                prefix={`−${currencySymbol}`}
                suffix={perSuffix}
                value={displayValue(row.cost, quantity, priceEntry)}
                tone="sub"
                onChangeText={(v) => row.onCost(draftValue(v, quantity, priceEntry))}
                onPrefixLongPress={openSettings}
              />
            </>
          ) : null}
        </View>

        {wheel ? (
          <View
            style={{
              marginHorizontal: 12,
              marginBottom: 10,
              paddingVertical: 8,
              alignItems: "center",
              backgroundColor: t.fill,
              borderRadius: t.radius.card,
              borderCurve: "continuous",
            }}
          >
            <TimeWheelPair
              hour={Math.floor(minutes / 60)}
              minute={minutes % 60}
              // Половины коммитятся порознь и каждая считает от ПРЕДЫДУЩЕГО
              // состояния: колонка знает соседнее значение только по пропу, и
              // два коммита в одном батче уносят устаревшую половину.
              onChangeHour={(next) =>
                row.onDuration(String(next * 60 + (minutes % 60)))
              }
              onChangeMinute={(next) =>
                row.onDuration(String(Math.floor(minutes / 60) * 60 + next))
              }
              labelPrefix="Время"
              // «00 : 30» в листе про цены читается как полпервого ночи —
              // подписи говорят, что это длительность.
              units
            />
            {priceEntry === "unit" && quantity > 1 && !emptyTime ? (
              // В режиме «за одну» барабан ставит время ОДНОЙ штуки, а в строку
              // уходит «минуты × количество». Продукт обязан показать, что
              // записалось, а не спрятать.
              <Text
                maxFontSizeMultiplier={1.2}
                style={{ fontSize: 13, color: t.sub, paddingTop: 6 }}
              >
                {`${durationLabel(
                  roundToStep(readMinutes(row.duration) / quantity),
                )} × ${quantity} = ${durationLabel(minutes)}`}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>
    );

    return (
      <Fragment key={row.id}>
        {index > 0 ? (
          <View style={{ height: 1, marginLeft: 12, backgroundColor: t.separator }} />
        ) : null}
        {row.qty === null ? (
          body
        ) : (
          // У первой строки свайпа нет: количество «1» — это сама услуга,
          // убрать её можно только вместе с услугой.
          <SwipeRow
            label="Убрать"
            color={t.danger}
            icon={Trash2}
            accessibilityLabel={`Убрать количество от ${row.qty || "…"}`}
            onAction={() => removeTier(row.id)}
          >
            {body}
          </SwipeRow>
        )}
      </Fragment>
    );
  };

  return (
    <View style={{ paddingHorizontal: GUTTER }}>
      <View
        style={{
          backgroundColor: t.surface,
          borderRadius: t.radius.card,
          borderCurve: "continuous",
          overflow: "hidden",
        }}
      >
        {rows.map(renderRow)}
      </View>

      {settingsOpen ? (
        <View
          style={{
            marginTop: 8,
            padding: 12,
            gap: 10,
            backgroundColor: t.fill,
            borderRadius: t.radius.card,
            borderCurve: "continuous",
          }}
        >
          <View>
            <FieldLabel text="Считаем" />
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              <Pill
                label="За всё"
                active={priceEntry === "total"}
                onPress={() => onPriceEntryChange("total")}
              />
              <Pill
                label={unit ? `За 1 ${unit}` : "За одну"}
                active={priceEntry === "unit"}
                onPress={() => onPriceEntryChange("unit")}
              />
            </View>
          </View>

          <View>
            <FieldLabel text="Единица" />
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {[null, ...SERVICE_UNITS].map((option) => (
                <Pill
                  key={option ?? "none"}
                  label={option ?? "Без единицы"}
                  active={unit === option}
                  // Единица одна на всю услугу: «от 3 в метрах, от 7 в штуках»
                  // — это две разные услуги.
                  onPress={() => onUnitChange(option)}
                />
              ))}
            </View>
          </View>

          <Pill
            label={showCost ? "Убрать расход" : "＋ Расход"}
            active={false}
            onPress={() => {
              if (showCost) {
                // Убрали столбец — обнуляем и сами числа: оставить расход
                // невидимым, но действующим значило бы тайно уменьшать
                // прибыль каждой записи с этой услугой.
                onCostChange("0");
                onChange({
                  ...value,
                  tiers: tiers.map((tier) => ({ ...tier, rowCost: "0" })),
                });
                onCostShownChange(false);
              } else {
                onCostShownChange(true);
                onOpenRow(null);
              }
            }}
          />
        </View>
      ) : null}
    </View>
  );
}

/** Слот числа: знак у кромки, значение — поле. Знак стоит ОТДЕЛЬНЫМ `Text`
 *  вне `value`, иначе `selectTextOnFocus` стирает его вместе с цифрами. */
function Slot({
  value,
  onChangeText,
  label,
  prefix,
  suffix,
  width,
  flex,
  align,
  muted,
  tone,
  placeholder,
  onPrefixLongPress,
}: {
  value: string;
  onChangeText: (v: string) => void;
  label: string;
  prefix: string;
  suffix?: string;
  width?: number;
  flex?: boolean;
  align?: "right";
  muted?: boolean;
  tone?: "sub";
  placeholder?: string;
  onPrefixLongPress?: () => void;
}) {
  const t = useThemeColors();
  const ink = tone === "sub" ? t.sub : muted ? t.muted : t.ink;
  return (
    <View
      style={{
        ...(flex ? { flex: 1 } : { width }),
        height: ROW_H,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: align === "right" ? "flex-end" : "flex-start",
      }}
    >
      <Pressable
        onLongPress={onPrefixLongPress}
        delayLongPress={400}
        accessibilityRole={onPrefixLongPress ? "button" : undefined}
        accessibilityLabel={onPrefixLongPress ? `${label} — как считаем` : undefined}
        style={{ height: ROW_H, justifyContent: "center" }}
      >
        <Text
          maxFontSizeMultiplier={1.2}
          style={{ fontSize: 15, fontWeight: "500", color: tone === "sub" ? t.sub : t.sub }}
        >
          {prefix}
        </Text>
      </Pressable>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        keyboardType="decimal-pad"
        selectTextOnFocus
        placeholder={placeholder ?? "—"}
        placeholderTextColor={t.muted}
        maxFontSizeMultiplier={1.2}
        accessibilityLabel={label}
        selectionColor={t.accent}
        keyboardAppearance="light"
        className="tabular-nums"
        // textAlign задаём СТИЛЕМ, а не классом: react-native-css объявляет у
        // TextInput nativeStyleMapping { textAlign: true } и делает
        // path.split(".") — на `true` это падает красной ошибкой.
        style={{
          // Резерв ровно под одну цифру: при 26 короткое «50» не заполняло
          // слот, и между знаком и числом зияла дыра — «€ 50» вместо «€50».
          // Прижимает их друг к другу выравнивание вправо у всего слота.
          minWidth: 12,
          padding: 0,
          fontSize: 16,
          fontWeight: "600",
          color: ink,
          textAlign: align === "right" ? "right" : "left",
        }}
      />
      {suffix ? (
        <Text
          maxFontSizeMultiplier={1.2}
          style={{ fontSize: 15, fontWeight: "500", color: t.sub }}
        >
          {suffix}
        </Text>
      ) : null}
    </View>
  );
}

function Pill({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const t = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      style={({ pressed }) => ({
        minHeight: 44,
        justifyContent: "center",
        paddingHorizontal: 14,
        borderRadius: t.radius.card,
        borderCurve: "continuous",
        backgroundColor: active ? t.accent : t.surface,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Text
        maxFontSizeMultiplier={1.2}
        style={{
          fontSize: 15,
          fontWeight: active ? "700" : "500",
          color: active ? t.onAccent : t.ink,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

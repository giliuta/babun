import { Fragment, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { Trash2 } from "lucide-react-native";

import { SectionCard } from "@/components/ui/SectionCard";
import { SwipeRow } from "@/components/ui/SwipeRow";
import { TimeWheelPair } from "@/components/ui/TimeWheel";
import { useThemeColors } from "@/theme/colors";
import { confirmThen } from "@/lib/confirm";
import { SERVICE_UNITS } from "./ServiceBlocks";
import { durationLabel } from "./format";
import type { PriceEntryMode, ServiceTierDraft } from "./economics";

// ЛЕСЕНКА УСЛУГИ — ТАБЛИЦА В ЧЕТЫРЕ КОЛОНКИ.
//
// Владелец 2026-08-27: «первая колонка — количество, и там я записываю 1, 2,
// 3, 4 вниз; вторая колонка — цена за штуку; третья — расход; четвёртая —
// время». То есть КОЛОНКИ РЯДОМ, а не блоки друг под другом: строка читается
// поперёк — «две штуки стоят €90, съедают €12 и занимают 1 ч 40».
//
// Первая редакция этого захода сложила те же данные четырьмя блоками
// (количество отдельно, цена отдельно…). Читалось это неверно: чтобы узнать
// цену двух штук, глаз шёл во второй блок и там отсчитывал вторую строку —
// то есть человек сам сшивал таблицу, которую разложили.
//
// АРИФМЕТИКА ШИРИН (346pt внутри карточки на экране 402):
//   46 + 6 + 100(flex) + 6 + 88 + 6 + 94 = 346
// Количество узкое — там одна-две цифры. Цена тянется: у неё бывают
// четырёхзначные суммы и знак валюты. Время шире расхода: «1 ч 40» длиннее
// любой суммы расхода, а переносить его нельзя.
//
// ЧИСЛА ПОДПИСЫВАЮТ СЕБЯ САМИ, шапка стоит ОДИН раз сверху — не в каждой
// строке. Это прямое требование прежней редакции блока (2026-08-25: подписи
// занимали в два с половиной раза больше места, чем числа под ними), и
// колонки его не отменяют, а исполняют буквально: подпись у колонки одна.

const ROW_H = 56;
/** Высота плитки внутри строки: 44 — минимальная цель пальца. */
const CELL_H = 44;

const W_QTY = 62;
const W_COST = 88;
const W_TIME = 94;
const GAP = 8;

// КОЛОНКИ РАЗДЕЛЕНЫ БЛОКАМИ, А НЕ ЧЕРТАМИ (владелец 2026-08-27: «разделение
// между столбиками не волосинка, а полноценно правильные блоки, красивые
// блоки как в iOS»).
//
// Волосинка стояла здесь один заход и была полумерой: она рисует границу, но
// не делает ячейку предметом — четыре числа всё равно читались одной строкой
// с насечками. Теперь у каждой ячейки СВОЯ залитая плитка со скруглением, а
// между плитками воздух. Так устроены группы в самом iOS: предмет отделяется
// не линией, а собственным телом и зазором вокруг него.
//
// Заливка ещё и подсказывает, что в ячейку МОЖНО ПИСАТЬ: на белом фоне поле
// ввода ничем не отличалось от подписи, и человек не понимал, где тут число,
// а где надпись.

export interface LadderStep {
  /** `null` — базовая строка (количество 1): её нельзя убрать, она и есть
   *  сама услуга. */
  tier: ServiceTierDraft | null;
  qty: string;
  price: string;
  cost: string;
  duration: string;
}

function Cell({
  value,
  onChange,
  width,
  prefix,
  suffix,
  align = "right",
  accessibilityLabel,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  width?: number;
  /** Приписка СЛЕВА от числа — «от» у количества. */
  prefix?: string;
  /** Знак валюты. Стоит СПРАВА ОТ ЧИСЛА, а не слева от ячейки: слева он
   *  прижимался к соседней колонке и читался её частью — строка начиналась
   *  «1 €», хотя единица это количество, а евро уже цена. */
  suffix?: string;
  align?: "right" | "center";
  accessibilityLabel: string;
  placeholder?: string;
}) {
  const t = useThemeColors();
  return (
    <View
      className="flex-row items-center justify-end"
      style={{
        width,
        flex: width ? undefined : 1,
        gap: 2,
        height: CELL_H,
        paddingHorizontal: 10,
        borderRadius: t.radius.input,
        borderCurve: "continuous",
        backgroundColor: t.fill,
      }}
    >
      {prefix ? (
        <Text style={{ fontSize: 13, color: t.sub }}>{prefix}</Text>
      ) : null}
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={t.placeholder}
        keyboardType="decimal-pad"
        accessibilityLabel={accessibilityLabel}
        selectionColor={t.accent}
        keyboardAppearance="light"
        style={{
          flex: 1,
          textAlign: align,
          fontSize: 16,
          fontWeight: "600",
          color: t.ink,
          fontVariant: ["tabular-nums"],
          paddingVertical: 8,
        }}
      />
      {suffix ? (
        <Text style={{ fontSize: 14, color: t.sub }}>{suffix}</Text>
      ) : null}
    </View>
  );
}

// ПИЛЮЛЯ ВЫБОРА. Своя, а не общий `chooseValue`: тот рисует нижний лист
// поверх экрана, а редактор услуги САМ живёт в листе-`Modal` — выбор честно
// появлялся бы ЗА ним и был бы не виден вовсе. Та же ловушка описана в шапке
// `NoticeBar`: из `Modal` нельзя показать то, что живёт в приложении.
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
        minHeight: 38,
        justifyContent: "center",
        paddingHorizontal: 12,
        borderRadius: t.radius.card,
        borderCurve: "continuous",
        backgroundColor: active ? t.accent : t.fill,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Text
        maxFontSizeMultiplier={1.2}
        style={{
          fontSize: 14,
          fontWeight: active ? "700" : "500",
          color: active ? t.onAccent : t.ink,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function ServiceLadder({
  steps,
  currencySymbol,
  unit,
  priceEntry,
  costEntry,
  onUnitChange,
  onPriceEntryChange,
  onCostEntryChange,
  openTimeId,
  onOpenTime,
  onQtyChange,
  onPriceChange,
  onCostChange,
  onDurationChange,
  onAdd,
  onRemove,
}: {
  steps: LadderStep[];
  currencySymbol: string;
  /** Единица измерения. `null` — считаем штуками, слово лишнее. */
  unit: string | null;
  /** Как ВВОДИТСЯ цена: за одну единицу (по умолчанию) или за всю строку.
   *  Владелец 2026-08-27 выбрал «за единицу» основным: тогда лесенка значит
   *  «сколько стоит один квадрат при таком объёме», и промежуточный объём
   *  считается сам. При «за всё» таблица становится справочником, и на 13 м²
   *  между ступенями 10 и 20 продукту пришлось бы гадать. */
  priceEntry: PriceEntryMode;
  costEntry: PriceEntryMode;
  onUnitChange: (u: string | null) => void;
  onPriceEntryChange: (m: PriceEntryMode) => void;
  onCostEntryChange: (m: PriceEntryMode) => void;
  /** Какая строка раскрыта барабаном времени. `null` — все закрыты. */
  openTimeId: string | null;
  onOpenTime: (id: string | null) => void;
  onQtyChange: (id: string, v: string) => void;
  onPriceChange: (id: string, v: string) => void;
  onCostChange: (id: string, v: string) => void;
  onDurationChange: (id: string, minutes: string) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
}) {
  const t = useThemeColors();
  const idOf = (s: LadderStep) => s.tier?.id ?? "base";

  // ЛЕСЕНКИ НЕТ — И ТАБЛИЦЫ НЕТ (владелец 2026-08-27, посмотрев вживую:
  // «услуга с одной ценой и одним временем выглядит электронной таблицей»).
  //
  // Так у подавляющего большинства услуг: одна цена, одно время, никаких
  // порогов. Столбец количества в этом случае показывает единственное «от 1»
  // — колонка ради строки, — а шапка из четырёх подписей превращает три
  // числа в отчёт. Ровно это владелец забраковал 25 августа на уровне
  // строки; здесь оно вернулось на уровне блока.
  //
  // Свёрнутый вид убирает КОЛИЧЕСТВО целиком: без порогов оно всегда 1 и
  // сообщать нечего. Остаются три числа и три подписи над ними — это уже не
  // таблица, а поля. «＋ Добавить» разворачивает блок в полную таблицу.
  const flat = steps.length === 1;
  /** Какая шапка раскрыта своим выбором. `null` — все закрыты. */
  const [panel, setPanel] = useState<"unit" | "price" | "cost" | null>(null);
  const toggle = (next: "unit" | "price" | "cost") =>
    setPanel((cur) => (cur === next ? null : next));

  // ШАПКА — НЕ ПОДПИСЬ, А НАСТРОЙКА КОЛОНКИ (владелец 2026-08-27: «если топаю
  // на количество, там выбирается не количество, а единица измерения; если
  // топаю на цену — можно выбрать цена за всё или цена за единицу»).
  //
  // Это и решает старую беду: подписи занимали больше места, чем числа. Здесь
  // подпись ОДНА на колонку и вдобавок работает — она же и есть тот
  // переключатель, который иначе стоял бы отдельной строкой.
  //
  // Нажимаемая подпись помечена цветом акцента: серая читалась бы обычным
  // ярлыком, и на неё никто бы не нажал.
  const headCell = (
    text: string,
    width?: number,
    onPress?: () => void,
  ) => {
    const label = (
      <Text
        maxFontSizeMultiplier={1.2}
        numberOfLines={2}
        style={{
          textAlign: "right",
          fontSize: 11,
          fontWeight: "700",
          letterSpacing: 0.6,
          textTransform: "uppercase",
          color: onPress ? t.accent : t.faint,
        }}
      >
        {text}
      </Text>
    );
    if (!onPress) {
      return (
        <View style={{ width, flex: width ? undefined : 1 }}>{label}</View>
      );
    }
    return (
      <Pressable
        onPress={onPress}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`${text} — изменить`}
        style={({ pressed }) => ({
          width,
          flex: width ? undefined : 1,
          opacity: pressed ? 0.5 : 1,
        })}
      >
        {label}
      </Pressable>
    );
  };

  // ШАПКА ВСЕГДА НАЗЫВАЕТ РЕЖИМ (владелец 2026-08-27, посмотрев вживую:
  // «глядя на 5 € невозможно понять, это за квадрат или за всё»). Раньше
  // подписан был только режим «за всё», а основной молчал — и число значило
  // одно из двух, не говоря какое. Подпись переносится на две строки: лучше
  // две строки правды, чем одна строка загадки.
  const modeLabel = (word: string, mode: PriceEntryMode) =>
    mode === "total" ? `${word} за всё` : `${word} за ${unit ?? "одну"}`;

  const modeRow = (
    current: PriceEntryMode,
    apply: (m: PriceEntryMode) => void,
  ) => (
    <View className="flex-row" style={{ flexWrap: "wrap", gap: 6 }}>
      {/* В свёрнутом виде подписи «Кол» нет, и единицу измерения выставить
          было бы негде — она живёт здесь, рядом с режимом, которому и
          придаёт смысл («за 1 м²»). */}
      {flat ? (
        <Pill
          label={unit ? `Единица: ${unit}` : "Единица"}
          active={false}
          onPress={() => setPanel("unit")}
        />
      ) : null}
      <Pill
        label={unit ? `За 1 ${unit}` : "За одну"}
        active={current === "unit"}
        onPress={() => {
          apply("unit");
          setPanel(null);
        }}
      />
      <Pill
        label="За всё"
        active={current === "total"}
        onPress={() => {
          apply("total");
          setPanel(null);
        }}
      />
    </View>
  );

  return (
    <SectionCard>
      {/* ШАПКА ОДИН РАЗ. Она и есть единственные подписи в блоке. */}
      <View
        className="flex-row items-center"
        style={{
          paddingHorizontal: 12,
          paddingTop: 12,
          paddingBottom: 6,
          gap: GAP,
        }}
      >
        {flat ? null : (
        <Pressable
          onPress={() => toggle("unit")}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Единица измерения — изменить"
          style={({ pressed }) => ({ width: W_QTY, opacity: pressed ? 0.5 : 1 })}
        >
          <Text
            maxFontSizeMultiplier={1.2}
            style={{
              textAlign: "center",
              fontSize: 11,
              fontWeight: "700",
              letterSpacing: 0.6,
              textTransform: "uppercase",
              color: t.accent,
            }}
          >
            {unit ?? "Кол"}
          </Text>
        </Pressable>
        )}
        {headCell(modeLabel("Цена", priceEntry), undefined, () => toggle("price"))}
        {headCell(modeLabel("Расход", costEntry), W_COST, () => toggle("cost"))}
        {headCell("Время", W_TIME)}
      </View>

      {/* ПАНЕЛЬ ВЫБОРА РАСКРЫВАЕТСЯ ПОД ШАПКОЙ, НАД ЧИСЛАМИ. Не над всей
          карточкой и не поверх экрана: человек нажал подпись колонки, и
          ответ обязан появиться там же, где вопрос. */}
      {panel ? (
        <View style={{ paddingHorizontal: 12, paddingBottom: 10, gap: 6 }}>
          {panel === "unit" ? (
            <View className="flex-row" style={{ flexWrap: "wrap", gap: 6 }}>
              {[null, ...SERVICE_UNITS].map((option) => (
                <Pill
                  key={option ?? "none"}
                  label={option ?? "Штуки"}
                  active={unit === option}
                  // Единица ОДНА на всю услугу: «от 3 в метрах, от 7 в штуках»
                  // — это две разные услуги, а не одна лесенка.
                  onPress={() => {
                    onUnitChange(option);
                    setPanel(null);
                  }}
                />
              ))}
            </View>
          ) : panel === "price" ? (
            modeRow(priceEntry, onPriceEntryChange)
          ) : (
            modeRow(costEntry, onCostEntryChange)
          )}
        </View>
      ) : null}

      {steps.map((s) => {
        const id = idOf(s);
        const minutes = Math.max(0, Number(s.duration) || 0);
        const open = openTimeId === id;
        const row = (
            <View
              className="flex-row items-center"
              style={{
                minHeight: ROW_H,
                backgroundColor: t.surface,
                paddingHorizontal: 12,
                gap: GAP,
                paddingVertical: 4,
              }}
            >
              {/* КОЛИЧЕСТВО. В свёрнутом виде его нет вовсе: без порогов оно
                  всегда «от 1» и сообщать нечего. */}
              {flat ? null : s.tier ? (
                <Cell
                  value={s.qty}
                  onChange={(v) => onQtyChange(id, v)}
                  width={W_QTY}
                  prefix="от"
                  placeholder="—"
                  accessibilityLabel="Количество, от"
                />
              ) : (
                <View
                  className="flex-row items-center justify-end"
                  style={{
                    width: W_QTY,
                    height: CELL_H,
                    paddingHorizontal: 10,
                    gap: 2,
                    borderRadius: t.radius.input,
                    borderCurve: "continuous",
                    backgroundColor: t.fill,
                  }}
                >
                  {/* «ОТ 1», А НЕ «1». Иначе в одном столбце два разных
                      смысла: первая строка значит «ровно одна», все
                      остальные — «от N». При метрах это ещё и звучало
                      бессмыслицей: «1 м²» никто не продаёт. */}
                  <Text style={{ fontSize: 13, color: t.sub }}>от</Text>
                  <Text
                    maxFontSizeMultiplier={1.2}
                    style={{
                      fontSize: 16,
                      fontWeight: "600",
                      color: t.ink,
                      fontVariant: ["tabular-nums"],
                    }}
                  >
                    1
                  </Text>
                </View>
              )}

              <Cell
                value={s.price}
                onChange={(v) => onPriceChange(id, v)}
                suffix={currencySymbol}
                placeholder="0"
                accessibilityLabel={`Цена за ${s.qty}`}
              />
              <Cell
                value={s.cost}
                onChange={(v) => onCostChange(id, v)}
                width={W_COST}
                suffix={currencySymbol}
                placeholder="0"
                accessibilityLabel={`Расход за ${s.qty}`}
              />

              {/* ВРЕМЯ — НЕ ПОЛЕ ВВОДА, А ДВЕРЬ К БАРАБАНАМ: «1 ч 40» с
                  клавиатуры не набирается, а «100 минут» человек не считает. */}
              <Pressable
                onPress={() => onOpenTime(open ? null : id)}
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
                accessibilityLabel={`Время за ${s.qty}`}
                hitSlop={6}
                style={({ pressed }) => ({
                  width: W_TIME,
                  height: CELL_H,
                  alignItems: "flex-end",
                  justifyContent: "center",
                  paddingHorizontal: 10,
                  borderRadius: t.radius.input,
                  borderCurve: "continuous",
                  backgroundColor: t.fill,
                  opacity: pressed ? 0.5 : 1,
                })}
              >
                <Text
                  maxFontSizeMultiplier={1.2}
                  numberOfLines={1}
                  style={{
                    textAlign: "right",
                    fontSize: 16,
                    fontWeight: "600",
                    color: open ? t.accent : t.ink,
                    fontVariant: ["tabular-nums"],
                  }}
                >
                  {durationLabel(minutes)}
                </Text>
              </Pressable>

            </View>
        );

        return (
          <Fragment key={id}>
            {/* УБИРАЕТСЯ СВАЙПОМ, А НЕ МУСОРКОЙ (владелец 2026-08-27: «эту
                мусорку убери, оно лучше сдвигать вправо»). Иконка занимала
                место в самой узкой строке продукта и стояла у КАЖДОЙ ступени,
                хотя убирают их редко. Свайп — общий язык всех списков
                продукта, и он же прячет разрушительное действие от
                случайного пальца.
                `fullSwipe` НЕ включён намеренно: закон канона — размашистый
                свайп не носит разрушительного, у «Убрать» промах стоил бы
                ступени. Подтверждение остаётся: строка уносит с собой цену,
                расход и время. */}
            {s.tier ? (
              <SwipeRow
                label="Убрать"
                color={t.danger}
                icon={Trash2}
                accessibilityLabel={`Убрать количество ${s.qty}`}
                onAction={() =>
                  confirmThen(
                    `Убрать количество «${s.qty}»?`,
                    { confirmLabel: "Убрать", destructive: true },
                    () => onRemove(id),
                  )
                }
              >
                {row}
              </SwipeRow>
            ) : (
              row
            )}

            {/* ДВА БАРАБАНА — ЧАСЫ И МИНУТЫ — под своей строкой, во всю ширину.
                Половины коммитятся ПОРОЗНЬ и каждая считает от предыдущего
                состояния: колонка знает соседнее значение только по пропу, и
                два коммита в одном батче унесли бы устаревшую половину. */}
            {open ? (
              <View
                style={{
                  alignItems: "center",
                  paddingBottom: 8,
                  backgroundColor: t.canvas,
                }}
              >
                <TimeWheelPair
                  hour={Math.floor(minutes / 60)}
                  minute={minutes % 60}
                  onChangeHour={(next) =>
                    onDurationChange(id, String(next * 60 + (minutes % 60)))
                  }
                  onChangeMinute={(next) =>
                    onDurationChange(
                      id,
                      String(Math.floor(minutes / 60) * 60 + next),
                    )
                  }
                  labelPrefix={`Время за ${s.qty}`}
                />
              </View>
            ) : null}
          </Fragment>
        );
      })}

      {/* ПОД СЕТКОЙ, КОМПАКТНО (владелец 2026-08-27: «кнопку убираем, делаем
          как „плюс добавить" под самой этой сеткой»). Полосой во всю карточку
          она читалась пятой строкой таблицы — пустой и без чисел.
          «＋» здесь допустим: он не голый, при нём стоит слово. Иконка Plus
          из lucide по-прежнему запрещена контрактным тестом. */}
      <Pressable
        onPress={onAdd}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Добавить количество"
        style={({ pressed }) => ({
          // СПРАВА, как «＋ Описание» у названия (владелец 2026-08-27).
          // Слева она вставала под колонкой «Кол» и читалась подписью к ней —
          // будто добавляет что-то в первый столбец, а не строку целиком.
          alignSelf: "flex-end",
          paddingHorizontal: 12,
          paddingTop: 2,
          paddingBottom: 12,
          opacity: pressed ? 0.5 : 1,
        })}
      >
        <Text style={{ fontSize: 15, fontWeight: "600", color: t.accent }}>
          ＋ Добавить
        </Text>
      </Pressable>
    </SectionCard>
  );
}

import { Fragment } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { Trash2 } from "lucide-react-native";

import { SectionCard } from "@/components/ui/SectionCard";
import { SwipeRow } from "@/components/ui/SwipeRow";
import { TimeWheelPair } from "@/components/ui/TimeWheel";
import { useThemeColors } from "@/theme/colors";
import { confirmThen } from "@/lib/confirm";
import { durationLabel } from "./format";
import { ladderRanges } from "./ladder-ranges";
import type { PriceEntryMode, ServiceTierDraft } from "./economics";

// ЕДИНИЦЫ ИЗМЕРЕНИЯ ЗДЕСЬ НЕТ, И ЭТО РЕШЕНИЕ, А НЕ УПРОЩЕНИЕ
// (владелец 2026-08-27, после живого прогона):
//
//   «Единица уезжает в НАЗВАНИЕ. Надо обмотку — пишу „Обмотка 1 м", и два
//    метра это просто количество 2: в счёте будет „Обмотка 1 м × 2".
//    Надо чистку — пишу „Чистка 10 м²", и тридцать метров это × 3 либо
//    отдельная услуга „Чистка 30 м²".»
//
// Почему это лучше отдельной колонки единиц:
//   · КЛИЕНТ ВИДИТ ТО ЖЕ, ЧТО И ТЫ. «Обмотка 1 м × 2» читается в счёте без
//     пояснений; «2 м» в служебной колонке требовало знать, чего именно два.
//   · Исчезает целый класс бессмыслицы: строка «от 2 м²» была абсурдом, а
//     «×2» абсурдом быть не может — это просто две штуки одного и того же.
//   · Количество снова значит РОВНО ОДНО: сколько раз взяли услугу.
//
// «ОТ» ТОЖЕ УБРАНО из подписи: строки читаются как 1, 2, 3, 4. Внутри они
// ОСТАЛИСЬ ПОРОГАМИ (`price_tiers.min_qty`), и на количестве, которого в
// таблице нет, берётся ближайшая меньшая строка — так работает опт везде.
//
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

const W_QTY = 50;
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

export function ServiceLadder({
  steps,
  currencySymbol,
  priceEntry,
  costEntry,
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
  /** Как ВВОДИТСЯ цена: за одну единицу (по умолчанию) или за всю строку.
   *  Владелец 2026-08-27 выбрал «за единицу» основным: тогда лесенка значит
   *  «сколько стоит один квадрат при таком объёме», и промежуточный объём
   *  считается сам. При «за всё» таблица становится справочником, и на 13 м²
   *  между ступенями 10 и 20 продукту пришлось бы гадать. */
  priceEntry: PriceEntryMode;
  costEntry: PriceEntryMode;
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
  // ШАПКА КОЛОНКИ: ИМЯ СВЕРХУ, РЕЖИМ В СКОБКАХ СНИЗУ, ТАП ПЕРЕКЛЮЧАЕТ
  // (владелец 2026-08-27: «цена — первая строчка, внизу в скобках „за одну";
  // топну один раз — скобки поменяются на „за всё"»).
  //
  // До этого тап открывал панель с двумя пилюлями. На ДВУХ значениях панель —
  // лишний ход: она занимала целую строку блока, толкала таблицу вниз и
  // висела, пока в неё не ткнут второй раз. Переключатель из двух положений
  // переключается тапом, а не выбором из списка.
  //
  // Имя колонки серое, как у «Кол» и «Время», — все четыре читаются
  // одинаково. Синие только скобки: они и есть то, что нажимается, и они же
  // говорят текущее состояние. Одна строка отвечает на оба вопроса.
  const headCell = (
    text: string,
    width?: number,
    mode?: PriceEntryMode,
    onToggle?: () => void,
  ) => {
    const body = (
      <>
        <Text
          maxFontSizeMultiplier={1.2}
          numberOfLines={1}
          style={{
            textAlign: "right",
            fontSize: 11,
            fontWeight: "700",
            letterSpacing: 0.6,
            textTransform: "uppercase",
            color: t.faint,
          }}
        >
          {text}
        </Text>
        {mode ? (
          <Text
            maxFontSizeMultiplier={1.2}
            numberOfLines={1}
            style={{
              textAlign: "right",
              fontSize: 11,
              fontWeight: "600",
              color: t.accent,
              marginTop: 1,
            }}
          >
            {mode === "total" ? "(за всё)" : "(за одну)"}
          </Text>
        ) : null}
      </>
    );
    if (!onToggle) {
      return (
        <View style={{ width, flex: width ? undefined : 1 }}>{body}</View>
      );
    }
    return (
      <Pressable
        onPress={onToggle}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`${text}, сейчас ${
          mode === "total" ? "за всё" : "за одну"
        }. Переключить`}
        style={({ pressed }) => ({
          width,
          flex: width ? undefined : 1,
          opacity: pressed ? 0.5 : 1,
        })}
      >
        {body}
      </Pressable>
    );
  };

  const flip = (m: PriceEntryMode): PriceEntryMode =>
    m === "total" ? "unit" : "total";

  const ranges = ladderRanges(steps.map((x) => x.qty));

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
          <Text
            maxFontSizeMultiplier={1.2}
            style={{
              width: W_QTY,
              textAlign: "center",
              fontSize: 11,
              fontWeight: "700",
              letterSpacing: 0.6,
              textTransform: "uppercase",
              color: t.faint,
            }}
          >
            Кол
          </Text>
        )}
        {headCell("Цена", undefined, priceEntry, () =>
          onPriceEntryChange(flip(priceEntry)),
        )}
        {headCell("Расход", W_COST, costEntry, () =>
          onCostEntryChange(flip(costEntry)),
        )}
        {headCell("Время", W_TIME)}
      </View>

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
                  align="center"
                  placeholder="—"
                  accessibilityLabel="Количество"
                />
              ) : (
                <View
                  className="flex-row items-center justify-center"
                  style={{
                    width: W_QTY,
                    height: CELL_H,
                    borderRadius: t.radius.input,
                    borderCurve: "continuous",
                    backgroundColor: t.fill,
                  }}
                >
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

      {ranges ? (
        <Text
          maxFontSizeMultiplier={1.2}
          style={{
            paddingHorizontal: 12,
            paddingTop: 2,
            fontSize: 12,
            lineHeight: 16,
            color: t.sub,
          }}
        >
          Считается по строкам: {ranges}
        </Text>
      ) : null}

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

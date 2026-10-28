import { Fragment } from "react";
import { Pressable, Text, View } from "react-native";
import { Trash2 } from "lucide-react-native";

import { SectionCard } from "@/components/ui/SectionCard";
import { SwipeRow } from "@/components/ui/SwipeRow";
import { TimeWheelPair } from "@/components/ui/TimeWheel";
import { useThemeColors } from "@/theme/colors";
import { durationShort } from "@/lib/service-format";
import type { PriceEntryMode, ServiceTierDraft } from "./economics";
import { LadderCell as Cell } from "./service-ladder/LadderCell";
import { LadderHeader } from "./service-ladder/LadderHeader";
import { CELL_H, GAP, ROW_H, W_COST, W_QTY, W_TIME } from "./service-ladder/layout";

// ЕДИНИЦЫ ИЗМЕРЕНИЯ ЗДЕСЬ НЕТ, И ЭТО РЕШЕНИЕ, А НЕ УПРОЩЕНИЕ.
//
// Единица уезжает в НАЗВАНИЕ услуги: «Обмотка 1 м» — два метра это просто
// количество 2, в счёте будет «Обмотка 1 м × 2». «Чистка 10 м²» — тридцать
// метров это × 3 либо отдельная услуга «Чистка 30 м²».
//
// Почему это лучше отдельной колонки единиц:
//   · КЛИЕНТ ВИДИТ ТО ЖЕ, ЧТО И ТЫ. «Обмотка 1 м × 2» читается в счёте без
//     пояснений; «2 м» в служебной колонке требовало знать, чего именно два.
//   · Исчезает целый класс бессмыслицы: строка «от 2 м²» была бы абсурдом, а
//     «×2» абсурдом быть не может — это просто две штуки одного и того же.
//   · Количество значит РОВНО ОДНО: сколько раз взяли услугу.
//
// «ОТ» убрано из подписи: строки читаются как 1, 2, 3, 4. Внутри они остаются
// ПОРОГАМИ (`price_tiers.min_qty`), и на количестве, которого в таблице нет,
// берётся ближайшая меньшая строка — так работает опт везде.
//
// ЛЕСЕНКА УСЛУГИ — ТАБЛИЦА В ЧЕТЫРЕ КОЛОНКИ: количество (1, 2, 3, 4 вниз), цена
// за штуку, расход, время. КОЛОНКИ РЯДОМ, а не блоки друг под другом: строка
// читается поперёк — «две штуки стоят €90, съедают €12 и занимают 1 ч 40».
// Четыре блока заставили бы глаз самому сшивать таблицу: чтобы узнать цену
// двух штук, пришлось бы идти во второй блок и отсчитывать вторую строку.
//
// АРИФМЕТИКА ШИРИН (346pt внутри карточки на экране 402):
//   46 + 6 + 100(flex) + 6 + 88 + 6 + 94 = 346
// Количество узкое — там одна-две цифры. Цена тянется: у неё бывают
// четырёхзначные суммы и знак валюты. Время шире расхода: «1 ч 40» длиннее
// любой суммы расхода, а переносить его нельзя.
//
// ЧИСЛА ПОДПИСЫВАЮТ СЕБЯ САМИ, шапка стоит ОДИН раз сверху — не в каждой
// строке: подписи в каждой строке занимали бы в два с половиной раза больше
// места, чем числа под ними. Подпись у колонки одна.
//
// Размеры — `service-ladder/layout.ts`, ячейка и шапка — там же.

export interface LadderStep {
  /** `null` — базовая строка (количество 1): её нельзя убрать, она и есть
   *  сама услуга. */
  tier: ServiceTierDraft | null;
  qty: string;
  price: string;
  cost: string;
  duration: string;
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
   *  «За единицу» основной: тогда лесенка значит «сколько стоит один квадрат
   *  при таком объёме», и промежуточный объём считается сам. При «за всё»
   *  таблица становится справочником, и на 13 м² между ступенями 10 и 20
   *  продукту пришлось бы гадать. */
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

  return (
    <SectionCard>
      <LadderHeader
        priceEntry={priceEntry}
        costEntry={costEntry}
        onPriceEntryChange={onPriceEntryChange}
        onCostEntryChange={onCostEntryChange}
      />

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
              {/* КОЛИЧЕСТВО. Первая строка — сама услуга: её «1» не
                  правится, это точка отсчёта, а не ступень. */}
              {s.tier ? (
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
                // Пустая БАЗОВАЯ цена — «бесплатно», подсказка
                // «0». Пустая цена СТУПЕНИ — «как выше»: строка без цены
                // меняет только время, и «0» обещал бы бесплатное, которого нет.
                placeholder={id === "base" ? "0" : "—"}
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
                {/* КОМПАКТНО, «1 ч 30»: полное «1 ч 30 мин» в ячейку не
                    входит и резалось многоточием (`durationShort`). Сжатие
                    шрифта — только страховка для длинных языков («12 Std.
                    30»), а не способ уместить русский. */}
                <Text
                  maxFontSizeMultiplier={1.2}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.8}
                  style={{
                    textAlign: "right",
                    fontSize: 16,
                    fontWeight: "600",
                    color: open ? t.accent : t.ink,
                    fontVariant: ["tabular-nums"],
                  }}
                >
                  {durationShort(minutes)}
                </Text>
              </Pressable>

            </View>
        );

        return (
          <Fragment key={id}>
            {/* УБИРАЕТСЯ СВАЙПОМ, А НЕ МУСОРКОЙ: иконка занимала бы место в
                самой узкой строке продукта и стояла бы у КАЖДОЙ ступени,
                хотя убирают их редко. Свайп — общий язык всех списков
                продукта, и он же прячет разрушительное действие от
                случайного пальца.
                `fullSwipe` НЕ включён намеренно: закон канона — размашистый
                свайп не носит разрушительного, у «Убрать» промах стоил бы
                ступени.

                БЕЗ ВОПРОСА «УБРАТЬ?». Вопрос рисует `ChoiceSheetHost` своим
                `Modal`, а лестница живёт внутри листа услуги — тоже `Modal`;
                второе окно поверх первого iOS молча не показывает, и тап по
                «Убрать» ничего бы не делал (тот же капкан описан у меток,
                `LabelsScreen`). Спрашивать и незачем: строка — черновик листа,
                в базу она уходит только по «Создать» или «Сохранить», а лист
                закрывается без сохранения. */}
            {s.tier ? (
              <SwipeRow
                label="Убрать"
                color={t.danger}
                icon={Trash2}
                accessibilityLabel={`Убрать количество ${s.qty}`}
                onAction={() => onRemove(id)}
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

      {/* ПОД СЕТКОЙ, КОМПАКТНО: «＋ добавить» под самой сеткой. Полосой во
          всю карточку она читалась бы пятой строкой таблицы — пустой и без
          чисел.
          «＋» здесь допустим: он не голый, при нём стоит слово. Иконка Plus
          из lucide по-прежнему запрещена контрактным тестом. */}
      <Pressable
        onPress={onAdd}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Добавить количество"
        style={({ pressed }) => ({
          // СПРАВА, как «＋ Описание» у названия. Слева она вставала бы под
          // колонкой «Кол» и читалась подписью к ней — будто добавляет что-то в
          // первый столбец, а не строку целиком.
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

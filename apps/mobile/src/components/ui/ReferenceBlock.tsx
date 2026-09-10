import { Pressable, Text, View } from "react-native";
import type { LucideIcon } from "lucide-react-native";
import { ChooseRow } from "@/components/ui/ChooseRow";
import { SectionCard } from "@/components/ui/SectionCard";
import { ICON } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";

// БЛОК ВЫБОРА ИЗ СПРАВОЧНИКА — ОДНО ТЕЛО НА ВСЕ СПРАВОЧНИКИ (владелец
// 2026-09-10: «сделай его точно таким же, как в категории в финансах… тип
// события выбирается точно так же, как категория, вся архитектура как у
// категории»).
//
// Устроен как блок клиента и блок объекта, и это закон продукта, а не
// совпадение: предмет выбирают в блоке со своей шапкой, пустое состояние —
// строка-дверь «Выбрать …», выбранное — сам предмет, и тап по нему открывает
// выбор заново. Стрелки справа у выбранного нет нигде (владелец 2026-09-04).
//
// СЛОВО СПРАВОЧНИКА НЕ ПОВТОРЯЕТСЯ В СТРОКЕ: его говорит шапка. Строка,
// которая звучит дважды («КАТЕГОРИЯ» сверху и «Категория» в строке, значение
// мелким серым у правого края) — это два заголовка и спрятанное значение.
//
// ЗНАЧОК И ЦВЕТ — ИЗ САМОЙ ЗАПИСИ СПРАВОЧНИКА. Они лежат рядом с именем (⛽ 🧰
// у категорий, ☕ 💼 ✈ у типов событий, свой цвет у каждой), и человек узнаёт
// «Топливо» по оранжевому кружку быстрее, чем читает слово. Кружок и его
// размер — те же, что у строки-двери, поэтому при выборе ничего не прыгает.
//
// ЛЕНТЫ ПЛИТОК ЗДЕСЬ НЕТ. Тип события до 2026-09-10 стоял горизонтальной
// лентой кружков с подписями: свой жест (листать вбок), своя геометрия (40pt
// кружок, подпись 11pt в две строки), своя дверь в справочник (ползунки в
// шапке блока) и свой способ снять выбор (повторный тап). Всё это — второй
// диалект выбора в продукте, где выбор уже описан: блок + шторка. Владелец
// свёл их: «мне кажется, тип события будет гораздо лучше выглядеть под
// категорию».

export interface ReferenceValue {
  /** Имя записи справочника — то, что человек и выбирал. */
  name: string;
  /** Цвет записи; нет — берём акцент. */
  color?: string | null;
  /** Значок из словаря справочника (`iconPreset`, `eventTypeIcon`). */
  Icon?: LucideIcon | null;
  /** Справочник хранит эмодзи как есть — категории операций умеют так. */
  emoji?: string | null;
}

export function ReferenceBlock({
  title,
  emptyIcon,
  emptyLabel,
  emptyHint,
  value,
  dense = false,
  onPress,
}: {
  /** Шапка блока: «Категория», «Тип события». */
  title: string;
  /** Значок закрытой двери — общий значок сущности, а не первой записи. */
  emptyIcon: LucideIcon;
  emptyLabel: string;
  emptyHint?: string;
  /** Выбранное; `null` — ещё не выбрано. */
  value: ReferenceValue | null | undefined;
  /** ПЛОТНЫЙ СЛУЧАЙ — ФОРМА В ШТОРКЕ (см. `ChooseRow.compact`): в листе долга
   *  блоков шесть, и лишние точки на каждый съедают треть листа. На странице
   *  записи блок дышит вместе с соседями «Клиент» и «Объект». */
  dense?: boolean;
  onPress: () => void;
}) {
  const t = useThemeColors();

  if (!value) {
    return (
      <SectionCard title={title} dense={dense}>
        <ChooseRow
          icon={emptyIcon}
          label={emptyLabel}
          hint={emptyHint}
          compact={dense}
          onPress={onPress}
        />
      </SectionCard>
    );
  }

  const tint = value.color ?? t.accent;
  // Подложка кружка — цвет записи в 12%. Токены темы записаны в `rgba()`, и
  // приписать к ним альфу строкой нельзя: `rgba(...)1f` — не цвет, RN рисует
  // им ЧЁРНЫЙ кружок (поймано на симуляторе 2026-09-08 на плитках типов).
  const fill = /^#[0-9a-f]{6}$/i.test(tint) ? `${tint}1f` : t.rowFill;
  const size = dense ? 30 : 34;
  // Своего значка у записи может не быть — тогда стоит общий значок сущности,
  // тот же, что на закрытой двери: пустого кружка в блоке не бывает.
  const Glyph = value.Icon ?? emptyIcon;

  return (
    <SectionCard title={title} dense={dense}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${title}: ${value.name}`}
        accessibilityHint={emptyHint}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          paddingHorizontal: 16,
          paddingVertical: dense ? 10 : 12,
          minHeight: dense ? 60 : 62,
          backgroundColor: pressed ? t.pressed : "transparent",
        })}
      >
        <View
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: fill,
          }}
        >
          {value.emoji ? (
            <Text maxFontSizeMultiplier={1.2} style={{ fontSize: dense ? 16 : 18 }}>
              {value.emoji}
            </Text>
          ) : (
            <Glyph color={tint} size={dense ? ICON.sm : ICON.md} strokeWidth={2.2} />
          )}
        </View>
        <Text
          maxFontSizeMultiplier={1.2}
          numberOfLines={1}
          style={{ flex: 1, fontSize: 17, fontWeight: "600", color: t.ink }}
        >
          {value.name}
        </Text>
      </Pressable>
    </SectionCard>
  );
}

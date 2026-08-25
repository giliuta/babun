import { Pressable, Text, View } from "react-native";
import { ChevronDown, Filter, X } from "lucide-react-native";
import { countWordRu } from "@babun/shared/common/utils/pluralize";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";
import type { ActiveToken } from "./filter";

// Бар над списком — вход в лист «Фильтры» и снятие выбранного.
// Говорит на диалекте листа (полировка 2026-07-26): токен = материал
// rowFill с радиусом 12 и вертикальным тиком сущности (не пилюля с
// круглой точкой — круглых пилюль в продукте нет), бейдж — сплошной ink,
// кобальт живёт ровно в одном месте — «Сбросить». Счётчик найденного —
// ОДИН, по одной формуле, в обоих состояниях; вторая строка «Найдено: N»
// удалена как дубль. Тап по телу токена открывает попап именно этого
// измерения, ✕ — снимает его.

/** Больше пяти токенов бар не печатает: остальное сворачивается в «+K»,
 *  иначе бар отжимает список на пол-экрана. */
const TOKEN_LIMIT = 5;

export function ClientsFilterBar({
  totalCount,
  foundCount,
  activeCount,
  tokens,
  onOpen,
  onOpenToken,
  onRemoveToken,
  onReset,
}: {
  /** Всего клиентов у тенанта — показывается в idle. */
  totalCount: number;
  /** После фильтров — «Найдено N из M». */
  foundCount: number;
  /** Число активных значений фильтра (бейдж). */
  activeCount: number;
  tokens: ActiveToken[];
  onOpen: () => void;
  /** Тап по телу токена — открыть лист сразу на его измерении. */
  onOpenToken: (token: ActiveToken) => void;
  onRemoveToken: (token: ActiveToken) => void;
  onReset: () => void;
}) {
  const t = useThemeColors();
  const active = activeCount > 0;
  const shown = tokens.slice(0, TOKEN_LIMIT);
  const hidden = tokens.length - shown.length;

  // ТОЛЬКО ЧИСЛО (владелец 2026-08-07: «просто четыре клиента, лучше вообще
  // все слова убрать»). Ушли «Всего», «Найдено» и приписка сортировки: строка
  // отвечает на один вопрос — сколько людей в списке под ней. Ось сортировки
  // видна там, где её и меняют, — в самом листе.
  const countLine =
    foundCount < totalCount
      ? `${foundCount} из ${totalCount}`
      : `${totalCount} ${countWordRu(totalCount, "клиент", "клиента", "клиентов")}`;

  return (
    <View style={{ marginHorizontal: 16, marginBottom: 8 }}>
      <Pressable
        onPress={() => {
          haptics.tap();
          onOpen();
        }}
        accessibilityRole="button"
        accessibilityLabel={
          active ? `Фильтры, активно ${activeCount}. ${countLine}` : "Фильтры"
        }
        accessibilityHint="Открывает фильтры"
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          minHeight: 44,
          opacity: pressed ? 0.8 : 1,
        })}
      >
        <Filter
          color={active ? t.ink : t.sub}
          size={16}
          strokeWidth={2.2}
        />
        {active ? (
          <View
            style={{
              minWidth: 18,
              height: 18,
              paddingHorizontal: 6,
              borderRadius: t.radius.card,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: t.ink,
            }}
          >
            <Text
              maxFontSizeMultiplier={1.3}
              style={{
                fontSize: 11,
                fontWeight: "700",
                color: "#FFFFFF",
                fontVariant: ["tabular-nums"],
              }}
            >
              {activeCount}
            </Text>
          </View>
        ) : null}
        <Text
          maxFontSizeMultiplier={1.3}
          style={{ fontSize: 14, fontWeight: "600", color: t.ink }}
        >
          Фильтры
        </Text>
        <View style={{ flex: 1 }} />
        <Text
          maxFontSizeMultiplier={1.3}
          numberOfLines={1}
          style={{ fontSize: 13, color: t.sub, fontVariant: ["tabular-nums"] }}
        >
          {countLine}
        </Text>
        <ChevronDown color={t.chevron} size={16} strokeWidth={2.2} />
      </Pressable>

      {active ? (
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 6,
            marginTop: 2,
          }}
        >
          {shown.map((tok) => (
            <View
              key={`${tok.key}:${tok.val}`}
              style={{
                flexDirection: "row",
                alignItems: "center",
                minHeight: 32,
                borderRadius: t.radius.card,
                backgroundColor: t.rowFill,
              }}
            >
              <Pressable
                onPress={() => {
                  haptics.tap();
                  onOpenToken(tok);
                }}
                accessibilityRole="button"
                accessibilityLabel={tok.label}
                accessibilityHint="Открывает это измерение"
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  paddingLeft: 10,
                  paddingRight: 2,
                  paddingVertical: 6,
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                {tok.color ? (
                  <View
                    style={{
                      width: 2,
                      height: 14,
                      borderRadius: 1,
                      marginRight: 7,
                      backgroundColor: tok.color,
                    }}
                  />
                ) : null}
                <Text
                  maxFontSizeMultiplier={1.3}
                  numberOfLines={1}
                  style={{
                    maxWidth: 140,
                    fontSize: 13,
                    fontWeight: "600",
                    color: t.ink,
                  }}
                >
                  {tok.label}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  haptics.tap();
                  onRemoveToken(tok);
                }}
                accessibilityRole="button"
                accessibilityLabel={`Убрать ${tok.label}`}
                // Асимметрично: зона ✕ не должна залезать на соседний токен.
                hitSlop={{ top: 10, bottom: 10, left: 2, right: 10 }}
                style={({ pressed }) => ({
                  width: 30,
                  alignSelf: "stretch",
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: pressed ? 0.5 : 1,
                })}
              >
                <X color={t.faint} size={13} strokeWidth={2.6} />
              </Pressable>
            </View>
          ))}
          {hidden > 0 ? (
            <Pressable
              onPress={() => {
                haptics.tap();
                onOpen();
              }}
              accessibilityRole="button"
              accessibilityLabel={`Ещё ${hidden} условий`}
              style={({ pressed }) => ({
                minHeight: 32,
                justifyContent: "center",
                paddingHorizontal: 10,
                borderRadius: t.radius.card,
                backgroundColor: t.rowFill,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Text
                maxFontSizeMultiplier={1.3}
                style={{
                  fontSize: 13,
                  fontWeight: "600",
                  color: t.faint,
                  fontVariant: ["tabular-nums"],
                }}
              >
                {`+${hidden}`}
              </Text>
            </Pressable>
          ) : null}
          <View style={{ flex: 1 }} />
          <Pressable
            onPress={() => {
              haptics.tap();
              onReset();
            }}
            accessibilityRole="button"
            accessibilityLabel="Сбросить фильтры"
            hitSlop={10}
            style={({ pressed }) => ({
              minHeight: 32,
              justifyContent: "center",
              paddingHorizontal: 4,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Text
              maxFontSizeMultiplier={1.3}
              style={{ fontSize: 13, fontWeight: "600", color: t.accent }}
            >
              Сбросить
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

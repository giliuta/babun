import { Pressable, Text, View } from "react-native";
import { ChevronDown, Filter, X } from "lucide-react-native";
import { countWordRu } from "@babun/shared/common/utils/pluralize";
import { useThemeColors } from "@/theme/colors";
import type { ActiveToken } from "./filter";

// Волна 2 — порт web ClientsFilterBar (v809/v812). Idle: воронка +
// «Фильтры» + «Всего N клиентов» + шеврон. Active: акцентная воронка +
// бейдж-счётчик + перенос удаляемых токенов с цветными точками, ниже —
// тонкая строка «Найдено: N» / «Сбросить». Тап по бару (кроме ✕ токена)
// открывает панель.

export function ClientsFilterBar({
  totalCount,
  foundCount,
  activeCount,
  tokens,
  onOpen,
  onRemoveToken,
  onReset,
}: {
  /** Всего клиентов у тенанта — показывается в idle. */
  totalCount: number;
  /** После фильтров — строка «Найдено» в active. */
  foundCount: number;
  /** Число активных значений фильтра (бейдж). */
  activeCount: number;
  tokens: ActiveToken[];
  onOpen: () => void;
  onRemoveToken: (token: ActiveToken) => void;
  onReset: () => void;
}) {
  const t = useThemeColors();
  const active = activeCount > 0;

  return (
    <View className="mx-4 mb-2">
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={
          active ? `Фильтры, активно ${activeCount}` : "Фильтры"
        }
        className="min-h-[44px] flex-row items-center gap-2 rounded-xl border px-3 py-1.5 active:opacity-80"
        style={
          active
            ? {
                backgroundColor: t.dark ? `${t.accent}29` : `${t.accent}14`,
                borderColor: "transparent",
              }
            : { backgroundColor: t.surface, borderColor: t.separator }
        }
      >
        <Filter color={active ? t.accent : t.sub} size={16} strokeWidth={2.2} />

        {active ? (
          <>
            <View
              className="h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5"
              style={{ backgroundColor: t.accent }}
            >
              <Text
                className="text-[11px] font-bold"
                style={{ color: t.onAccent, fontVariant: ["tabular-nums"] }}
              >
                {activeCount}
              </Text>
            </View>
            <View className="flex-1 flex-row flex-wrap items-center gap-1.5">
              {tokens.map((tok) => (
                <View
                  key={`${tok.key}:${tok.val}`}
                  className="h-7 flex-row items-center gap-1 rounded-full border pl-2 pr-1"
                  style={{ backgroundColor: t.surface, borderColor: t.separator }}
                >
                  {tok.color ? (
                    <View
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 4,
                        backgroundColor: tok.color,
                      }}
                    />
                  ) : null}
                  <Text
                    className="max-w-[120px] text-xs font-semibold"
                    style={{ color: t.ink }}
                    numberOfLines={1}
                  >
                    {tok.label}
                  </Text>
                  <Pressable
                    onPress={() => onRemoveToken(tok)}
                    hitSlop={12}
                    accessibilityRole="button"
                    accessibilityLabel={`Убрать ${tok.label}`}
                    className="h-5 w-5 items-center justify-center rounded-full active:opacity-60"
                  >
                    <X color={t.faint} size={12} strokeWidth={2.6} />
                  </Pressable>
                </View>
              ))}
            </View>
          </>
        ) : (
          <>
            <Text className="text-sm font-semibold" style={{ color: t.ink }}>
              Фильтры
            </Text>
            <View className="flex-1" />
            <Text
              className="text-[13px]"
              style={{ color: t.sub, fontVariant: ["tabular-nums"] }}
            >
              Всего {totalCount}{" "}
              {countWordRu(totalCount, "клиент", "клиента", "клиентов")}
            </Text>
            <ChevronDown color={t.faint} size={16} strokeWidth={2.2} />
          </>
        )}
      </Pressable>

      {active ? (
        <View className="mt-1.5 flex-row items-center justify-between px-1">
          <Text
            className="text-xs"
            style={{ color: t.sub, fontVariant: ["tabular-nums"] }}
          >
            Найдено:{" "}
            <Text className="font-semibold" style={{ color: t.ink }}>
              {foundCount}
            </Text>
          </Text>
          <Pressable
            onPress={onReset}
            hitSlop={14}
            accessibilityRole="button"
            accessibilityLabel="Сбросить фильтры"
            className="active:opacity-60"
          >
            <Text className="text-xs font-semibold" style={{ color: t.accent }}>
              Сбросить
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

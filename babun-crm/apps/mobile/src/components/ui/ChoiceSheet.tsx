import { useEffect, useState, type ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

// ВЫБОР «ЧТО СДЕЛАТЬ» — СНИЗУ, КАК ВСЁ ОСТАЛЬНОЕ.
//
// Владелец 2026-07-27: «мне не нравится, когда в телефоне справа нажимаешь на
// эту штуку и оно посередине вылазит — некрасиво; пусть снизу выезжает, как и
// всё». Нативный ActionSheetIOS на новых iOS всплывает по центру и выпадает из
// языка приложения, где ВСЁ приезжает снизу одним и тем же движением.
//
// Почему провайдер, а не компонент на каждом экране: выбор зовут из
// обработчиков (`await chooseOption(...)`), а не рисуют в разметке. Хост
// монтируется один раз в корне и отдаёт императивный мост — тот же приём, что
// у тостов. Экраны при этом ничего не знают: они по-прежнему зовут
// chooseOption() из @/lib/choose.

export interface SheetChoice {
  label: string;
  /** Красный пункт: удаление, снятие, отмена. */
  destructive?: boolean;
}

interface Request {
  title?: string;
  message?: string;
  choices: SheetChoice[];
  resolve: (index: number | null) => void;
}

let present: ((request: Request) => void) | null = null;

/** Есть ли смонтированный хост (иначе вызывающий уходит на системный лист). */
export function choiceSheetReady(): boolean {
  return present !== null;
}

export function presentChoiceSheet(
  title: string | undefined,
  choices: SheetChoice[],
  opts?: { message?: string },
): Promise<number | null> {
  if (!present) return Promise.resolve(null);
  return new Promise((resolve) => {
    present?.({ title, message: opts?.message, choices, resolve });
  });
}

export function ChoiceSheetHost({ children }: { children?: ReactNode }) {
  const t = useThemeColors();
  const insets = useSafeAreaInsets();
  const [request, setRequest] = useState<Request | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    present = (next) => {
      // Один лист за раз: предыдущий обещал ответ — закрываем его отменой.
      setRequest((cur) => {
        cur?.resolve(null);
        return next;
      });
      setVisible(true);
    };
    return () => {
      present = null;
    };
  }, []);

  const answer = (index: number | null) => {
    request?.resolve(index);
    setRequest((cur) => (cur === request ? cur : cur));
    setVisible(false);
  };

  return (
    <>
      {children}
      <BottomSheet
        visible={visible}
        onClose={() => answer(null)}
        maxHeightRatio={0.8}
      >
        {request?.title || request?.message ? (
          <View style={{ paddingHorizontal: 20, paddingTop: 4, paddingBottom: 10 }}>
            {request.title ? (
              <Text
                accessibilityRole="header"
                maxFontSizeMultiplier={1.2}
                numberOfLines={2}
                style={{
                  fontSize: 17,
                  fontWeight: "600",
                  color: t.ink,
                  textAlign: "center",
                }}
              >
                {request.title}
              </Text>
            ) : null}
            {request.message ? (
              <Text
                maxFontSizeMultiplier={1.2}
                style={{
                  marginTop: 4,
                  fontSize: 13,
                  color: t.sub,
                  textAlign: "center",
                }}
              >
                {request.message}
              </Text>
            ) : null}
          </View>
        ) : null}

        <ScrollView
          style={{ flexShrink: 1 }}
          contentContainerStyle={{ paddingHorizontal: 12 }}
        >
          <View
            style={{
              borderRadius: t.radius.card,
              overflow: "hidden",
              backgroundColor: t.fill,
            }}
          >
            {(request?.choices ?? []).map((choice, index) => (
              <Pressable
                key={`${choice.label}-${index}`}
                onPress={() => {
                  haptics.tap();
                  answer(index);
                }}
                accessibilityRole="button"
                accessibilityLabel={choice.label}
                style={({ pressed }) => ({
                  minHeight: 56,
                  justifyContent: "center",
                  paddingHorizontal: 16,
                  borderTopWidth: index > 0 ? 1 : 0,
                  borderTopColor: t.separator,
                  backgroundColor: pressed ? t.rowFillPressed : "transparent",
                })}
              >
                <Text
                  maxFontSizeMultiplier={1.3}
                  style={{
                    fontSize: 17,
                    fontWeight: "500",
                    color: choice.destructive ? t.danger : t.ink,
                  }}
                >
                  {choice.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>

        <View
          style={{
            paddingHorizontal: 12,
            paddingTop: 8,
            paddingBottom: Math.max(insets.bottom, 12),
          }}
        >
          <Pressable
            onPress={() => answer(null)}
            accessibilityRole="button"
            accessibilityLabel="Отмена"
            style={({ pressed }) => ({
              minHeight: 52,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: t.radius.card,
              backgroundColor: pressed ? t.rowFillPressed : t.fill,
            })}
          >
            <Text
              maxFontSizeMultiplier={1.2}
              style={{ fontSize: 17, fontWeight: "600", color: t.ink }}
            >
              Отмена
            </Text>
          </Pressable>
        </View>
      </BottomSheet>
    </>
  );
}

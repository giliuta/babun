import { Pressable, ScrollView, Text, View } from "react-native";
import { Check } from "lucide-react-native";
import { getAvatarColor } from "@babun/shared/common/utils/avatar-color";
import { haptics } from "@/lib/haptics";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { useCities } from "@/features/reference/queries";
import { useThemeColors } from "@/theme/colors";

// Пикер метки клиента — строго из библиотеки Кабинета (решение владельца
// 2026-07-22, свободного ввода нет). Тап по метке применяет и закрывает.
// «Убрать метку» возвращает клиента в АВТО-режим: метка снова подхватится
// из метки дня при следующей записи (тумблер «обновлять автоматически»
// отклонён — снятие метки и есть путь назад в авто).

export function LabelPickerSheet({
  visible,
  current,
  onSelect,
  onClear,
  onClose,
}: {
  visible: boolean;
  /** Текущее значение client.city ("" = метки нет). */
  current: string;
  /** Выбор из библиотеки — родитель пишет {city, city_manual: true}. */
  onSelect: (name: string) => void;
  /** «Убрать метку» — родитель пишет {city: "", city_manual: false}. */
  onClear: () => void;
  onClose: () => void;
}) {
  const t = useThemeColors();
  const { data: cities = [] } = useCities();
  const value = current.trim();
  const inLibrary = cities.some((c) => c.name === value);

  return (
    <BottomSheet padded={false} visible={visible} onClose={onClose}>
      <View className="items-center pb-2 pt-2">
        <Text
          accessibilityRole="header"
          maxFontSizeMultiplier={1.2}
          className="text-[17px] font-semibold"
          style={{ color: t.ink }}
        >
          Метка
        </Text>
      </View>

      {/* px через contentContainerStyle — className на ScrollView
          NativeWind молча роняет (контент липнет к краям). */}
      <ScrollView
        style={{ flexShrink: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20 }}
      >
        <View className="gap-2 pb-2">
          {/* Legacy-значение вне библиотеки: показываем честно, но выбрать
              заново нельзя — только библиотека или «Убрать метку». */}
          {value !== "" && !inLibrary ? (
            <View
              className="h-11 flex-row items-center gap-2.5 px-3"
              style={{ borderRadius: t.radius.input, backgroundColor: t.fill }}
            >
              <View
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 5,
                  backgroundColor: getAvatarColor(value),
                }}
              />
              <Text
                maxFontSizeMultiplier={1.3}
                numberOfLines={1}
                className="flex-1 text-sm font-medium"
                style={{ color: t.sub }}
              >
                {value}
              </Text>
              <Text
                maxFontSizeMultiplier={1.3}
                className="text-[12px]"
                style={{ color: t.faint }}
              >
                текущее значение
              </Text>
            </View>
          ) : null}

          {cities.map((c) => {
            const on = c.name === value;
            const dot = c.color ?? getAvatarColor(c.name);
            return (
              <Pressable
                key={c.id}
                onPress={() => {
                  haptics.tap();
                  if (!on) onSelect(c.name);
                  onClose();
                }}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                accessibilityLabel={c.name}
                className="h-11 flex-row items-center gap-2.5 border px-3 active:opacity-70"
                style={{
                  borderRadius: t.radius.input,
                  borderColor: on ? t.accent : "transparent",
                  backgroundColor: on ? `${t.accent}1F` : t.fill,
                }}
              >
                <View
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 5,
                    backgroundColor: dot,
                  }}
                />
                <Text
                  maxFontSizeMultiplier={1.3}
                  numberOfLines={1}
                  className="flex-1 text-sm font-medium"
                  style={{ color: on ? t.accent : t.ink }}
                >
                  {c.name}
                </Text>
                {on ? <Check color={t.accent} size={16} strokeWidth={2.6} /> : null}
              </Pressable>
            );
          })}

          {cities.length === 0 ? (
            <Text
              maxFontSizeMultiplier={1.3}
              className="px-1 py-2 text-[13px]"
              style={{ color: t.faint }}
            >
              В библиотеке пока нет меток — создайте их в Кабинете, раздел
              «Метки».
            </Text>
          ) : null}

          {value !== "" ? (
            <Pressable
              onPress={() => {
                haptics.tap();
                onClear();
                onClose();
              }}
              accessibilityRole="button"
              accessibilityLabel="Убрать метку"
              className="h-11 items-center justify-center active:opacity-70"
              style={{ borderRadius: t.radius.input, backgroundColor: t.fill }}
            >
              <Text
                maxFontSizeMultiplier={1.3}
                className="text-sm font-semibold"
                style={{ color: t.accent }}
              >
                Убрать метку
              </Text>
            </Pressable>
          ) : null}
        </View>

        <Text
          maxFontSizeMultiplier={1.3}
          className="pb-6 pt-1 text-[13px] leading-5"
          style={{ color: t.faint }}
        >
          Пока метка не выбрана вручную, она подхватывается сама — из метки
          дня, в который вы записываете клиента. «Убрать метку» возвращает
          авто-режим.
        </Text>
      </ScrollView>
    </BottomSheet>
  );
}

import { View } from "react-native";
import { GradientButton } from "@/components/ui/GradientButton";
import { haptics } from "@/lib/haptics";
import { Text } from "./book-text";
import type { BookModel } from "./use-book-form";

/** липкий футер — внутри KAV, чтобы клавиатура (цифровые поля денег)
 *  поднимала кнопку, а не закрывала её */
export function BookFooter({ form }: { form: BookModel }) {
  const {
    t,
    insets,
    keyboardShown,
    groundBg,
    workLocked,
    canSave,
    bookingBusy,
    missingHint,
    isEdit,
    kind,
    save,
    nudgeTariff,
    toast,
  } = form;
  return (
    <View
      style={{
        paddingHorizontal: 14,
        paddingTop: 8,
        // Клавиатура iOS уже включает полосу home-индикатора: с её
        // отступом под кнопкой висели лишние ~34pt пустоты (тот же
        // закон, что у футера листов, DS §5).
        paddingBottom: keyboardShown ? 8 : insets.bottom + 8,
        backgroundColor: groundBg,
        borderTopWidth: 1,
        borderTopColor: t.separator,
      }}
    >
      {/* Причина, почему кнопка ещё не активна — всегда видна над CTA
          (раньше disabled-кнопка молчала, и весь missingHint был мёртв). */}
      {!workLocked && !canSave && !bookingBusy ? (
        <Text
          accessibilityLiveRegion="polite"
          style={{
            fontSize: 13,
            color: t.sub,
            textAlign: "center",
            marginBottom: 8,
          }}
        >
          {missingHint}
        </Text>
      ) : null}
      {/* Дата · время · сумма уже названы в докете и «Итого» — CTA их не
          дублирует. ЦВЕТ КНОПКИ — СИСТЕМНЫЙ, НЕ ЦВЕТ ЗАПИСИ (владелец
          2026-09-06: «кнопка не должна менять цвет, она должна оставаться
          единой в стиле нашей системы»): оранжевая запись давала бурую
          кнопку, и главное действие экрана переставало быть узнаваемым. */}
      <GradientButton
        label={
          isEdit
            ? "Сохранить"
            : kind === "event"
              ? "Создать событие"
              : "Создать запись"
        }
        onPress={save}
        disabled={workLocked || !canSave || bookingBusy}
        // Серая кнопка отвечает плашкой сверху: «Выберите клиента»,
        // «Выберите услугу» — что мешает сохранить; без тарифа — «Нужно
        // изменить тариф».
        onDisabledPress={() => {
          if (workLocked) {
            nudgeTariff();
            return;
          }
          haptics.warning();
          toast(missingHint, "info");
        }}
        loading={bookingBusy}
      />
    </View>
  );
}

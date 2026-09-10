import { Pressable, Text, TextInput, View } from "react-native";
import { UserRound } from "lucide-react-native";
import type { Client } from "@babun/shared/local/clients";
import type { ClientStats } from "@babun/shared/local/selectors/client-stats";
import type { DebtDirection } from "@babun/shared/local/finance/debt";
import { ChooseRow } from "@/components/ui/ChooseRow";
import { ClientHistoryLine } from "@/features/clients/history-line";
import { useThemeColors } from "@/theme/colors";

// КТО ДОЛЖЕН — ЗАВИСИТ ОТ СТОРОНЫ, И ЭТО НЕ ПРИХОТЬ ВЁРСТКИ.
//
// «МНЕ ДОЛЖНЫ» — это всегда человек из справочника клиентов (владелец
// 2026-09-10: «сделай возможность добавить клиента, именно такой же блок, как
// в записи; если клиента нет — открывается всё то же самое, и там просто
// внесу, кто он»). Раньше здесь было свободное поле «Клиент или имя»: долг
// записывался на строку текста, и связи с карточкой не возникало — ни истории,
// ни телефона, ни «сколько он уже должен». Теперь блок тот же, что в записи:
// выбранный клиент показывает вводную о себе, тап открывает выбор заново.
//
// «Я ДОЛЖЕН» — это поставщик, магазин, сосед: в справочнике клиентов их нет и
// заводить их там нельзя, иначе список клиентов перестанет быть списком тех,
// кому мы ездим. Здесь остаётся свободное имя.

export function DebtWhoBlock({
  direction,
  client,
  stats,
  counterparty,
  onCounterparty,
  onOpenPicker,
}: {
  direction: DebtDirection;
  /** Выбранный клиент — только для стороны «мне должны». */
  client: Client | null;
  stats: ClientStats | undefined;
  counterparty: string;
  onCounterparty: (next: string) => void;
  onOpenPicker: () => void;
}) {
  const t = useThemeColors();

  if (direction === "outgoing") {
    return (
      <View className="min-h-[52px] flex-row items-center gap-3 px-4 py-2.5">
        <Text className="text-base" style={{ color: t.ink }}>
          Кто
        </Text>
        <TextInput
          value={counterparty}
          onChangeText={onCounterparty}
          placeholder="Поставщик, магазин"
          placeholderTextColor={t.placeholder}
          selectionColor={t.accent}
          keyboardAppearance="light"
          maxFontSizeMultiplier={1.2}
          accessibilityLabel="Кому мы должны"
          maxLength={120}
          className="flex-1 text-base"
          style={{ color: t.ink, textAlign: "right" }}
        />
      </View>
    );
  }

  if (!client) {
    return (
      <ChooseRow
        icon={UserRound}
        label="Выбрать клиента"
        hint="Открывает поиск по имени или телефону"
        onPress={onOpenPicker}
      />
    );
  }

  // ТА ЖЕ СТРОКА, ЧТО В ЗАПИСИ: имя, вводная, телефон. Стрелки справа нет —
  // в продукте тап по выбранному открывает выбор заново, а не «вглубь».
  // Кнопки звонка и карточки здесь нет нарочно: связь с должником живёт в
  // самой карточке клиента (владелец 2026-09-09 убрал «Напомнить» из долгов),
  // а лист поверх листа iOS всё равно не покажет.
  return (
    <Pressable
      className="flex-row items-center px-4 py-2.5"
      onPress={onOpenPicker}
      accessibilityRole="button"
      accessibilityLabel={`Клиент: ${client.full_name || "без имени"}`}
      accessibilityHint="Открывает выбор клиента"
      style={({ pressed }) => ({
        backgroundColor: pressed ? t.pressed : "transparent",
      })}
    >
      <View className="flex-1">
        <Text style={{ fontSize: 17, fontWeight: "700", color: t.ink }}>
          {client.full_name || "Без имени"}
        </Text>
        <ClientHistoryLine client={client} stats={stats} />
        <Text
          style={{
            fontSize: 13,
            color: client.phone ? t.sub : t.placeholder,
            marginTop: 2,
          }}
          numberOfLines={1}
        >
          {client.phone ?? "без телефона"}
        </Text>
      </View>
    </Pressable>
  );
}

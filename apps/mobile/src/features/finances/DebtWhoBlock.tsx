import { Pressable, Text, View } from "react-native";
import { UserRound } from "lucide-react-native";
import type { Client } from "@babun/shared/local/clients";
import type { ClientStats } from "@babun/shared/local/selectors/client-stats";
import { ChooseRow } from "@/components/ui/ChooseRow";
import { ClientHistoryLine } from "@/features/clients/history-line";
import { useThemeColors } from "@/theme/colors";

// КТО ДОЛЖЕН — ВСЕГДА КЛИЕНТ ИЗ СПРАВОЧНИКА, В ОБЕ СТОРОНЫ.
//
// Здесь стояло свободное поле «Клиент или имя», а «я должен» я оставил
// текстом с доводом «поставщику в списке клиентов не место». Владелец
// поправил (2026-09-10): «это телефонная база — у клиента просто не будет
// записи, вот и всё; в другой CRM у нас около восьмидесяти клиентов, которые
// ни разу не заказали услуги; можно заводить клиента через того, кто должен,
// и при этом иметь право к нему не выезжать».
//
// Значит справочник — это КОНТАКТЫ, а не список тех, кому мы ездим, и
// поставщик в нём такой же контакт. Отсюда один блок на обе стороны: тот же,
// что в записи, — выбранный показывает свою вводную, тап открывает выбор
// заново, а «Создать клиента» заводит нового прямо по дороге.
//
// Имя БЕЗ карточки остаётся живым случаем: клиента могли удалить, а долг за
// ним остаётся, и старые долги записывались текстом. Такую строку печатаем
// как есть и предлагаем связать с карточкой.

export function DebtWhoBlock({
  client,
  stats,
  counterparty,
  onOpenPicker,
}: {
  /** Выбранный клиент. */
  client: Client | null;
  stats: ClientStats | undefined;
  /** Имя, сохранённое в долге: у него может не быть карточки. */
  counterparty: string;
  onOpenPicker: () => void;
}) {
  const t = useThemeColors();
  const orphan = !client && counterparty.trim().length > 0;

  if (!client && !orphan) {
    return (
      <ChooseRow
        icon={UserRound}
        label="Выбрать клиента"
        hint="Открывает поиск по имени или телефону"
        compact
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
      className="flex-row items-center px-4 py-2"
      onPress={onOpenPicker}
      accessibilityRole="button"
      accessibilityLabel={`Клиент: ${client?.full_name || counterparty || "без имени"}`}
      accessibilityHint="Открывает выбор клиента"
      style={({ pressed }) => ({
        backgroundColor: pressed ? t.pressed : "transparent",
      })}
    >
      <View className="flex-1">
        <Text style={{ fontSize: 17, fontWeight: "700", color: t.ink }}>
          {client?.full_name || counterparty || "Без имени"}
        </Text>
        {client ? <ClientHistoryLine client={client} stats={stats} /> : null}
        <Text
          style={{
            fontSize: 13,
            color: client?.phone ? t.sub : t.placeholder,
            marginTop: 2,
          }}
          numberOfLines={1}
        >
          {client ? (client.phone ?? "без телефона") : "имя без карточки"}
        </Text>
      </View>
    </Pressable>
  );
}

import { ScrollView } from "react-native";
import { EmptyState } from "@/components/ui/EmptyState";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { useTenant } from "@/features/settings/tenant";
import { InvoiceSettingsBlocks } from "./InvoiceSettingsBlocks";
import { useCurrentRole } from "@/features/settings/tenant";

// «ИНВОЙСЫ» — ДВЕРЬ ШЕСТЕРЁНКИ «ФИНАНСОВ» (владелец 03.10): бланк вышел из-за
// шестерёнки «Реквизитов» в блок «Документы» рядом с ними, заголовок — словом
// двери. Адрес прежний, `/finances/invoice-blank`; копия поверх документа
// (`(shared)`) снята — её открывала только снятая шестерёнка.
//
// БЫЛО: БЛАНК ИНВОЙСА — ЗА ШЕСТЕРЁНКОЙ СТРАНИЦЫ «РЕКВИЗИТЫ» (владелец 2026-09-30:
// «страницу реквизитов — по нашей архитектуре, как теги и услуги»). Сама
// страница реквизитов — только список наборов; то, что одно на все бланки
// (строки счёта, срок, название строки, приписка, вид номера), — настройка
// раздела и живёт за его шестерёнкой (канон: у настройки одна дверь в её
// разделе). Номер каждого набора — в его карточке.
export function InvoiceBlankScreen() {
  const tenant = useTenant();
  // Партнёр видит бланк только для чтения (право «Инвойсы», 03.10).
  const owner = useCurrentRole().data === "owner";
  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Инвойсы" />
      {tenant.isError && !tenant.data ? (
        <EmptyState
          state="error"
          fill
          title="Нет связи с сервером"
          subtitle="Настройки загрузятся, как только появится интернет."
          action={{ label: "Повторить", onPress: () => void tenant.refetch() }}
        />
      ) : !tenant.data ? (
        <EmptyState state="loading" fill />
      ) : (
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingTop: 8, paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
        >
          <InvoiceSettingsBlocks readOnly={!owner} />
        </ScrollView>
      )}
    </Screen>
  );
}

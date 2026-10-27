import { Linking, Pressable, ScrollView, Text, View } from "react-native";
import { ChevronRight, Phone } from "lucide-react-native";
import type { Client } from "@babun/shared/local/clients";
import type { Appointment } from "@babun/shared/local/appointments";
import { STATUS_LABELS } from "@babun/shared/local/appointments";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { RowActionButton } from "@/components/ui/card-rows";
import { LIST_ROW, TYPE } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import { humanDay } from "@/features/appointments/helpers";
import { newestFirst, serviceNamesOf } from "./card-history";

/** Клиент своей записи у мастера без базы: как связаться и какие работы. */
export function MasterClientOperationalView({
  client,
  appointments,
  services,
  onBack,
  onOpenAppointment,
}: {
  client: Client;
  appointments: Appointment[];
  services: readonly { id: string; name: string }[];
  onBack: () => void;
  onOpenAppointment: (appointment: Appointment) => void;
}) {
  const t = useThemeColors();
  const phoneDigits = client.phone.replace(/[^+\d]/g, "");
  const serviceById = new Map(services.map((service) => [service.id, service.name]));
  const assigned = newestFirst(appointments);

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Клиент" onBack={onBack} />
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        {/* ТОТ ЖЕ БЛОК «КЛИЕНТ», ЧТО В ЗАПИСИ И КАРТОЧКЕ: имя 17/700, телефон
            13, звонок круглой кнопкой строки. Своя шкала (имя-герой 24,
            подписи 12/16/14) делала одного клиента у мастера другим. */}
        <SectionCard title="Клиент">
          <View className="flex-row items-center gap-3 px-4 py-2.5">
            <View className="min-w-0 flex-1">
              <Text numberOfLines={2} style={{ ...TYPE.headline, fontWeight: "700", color: t.ink }}>
                {client.full_name || "Клиент"}
              </Text>
              <Text style={{ ...LIST_ROW.sub, marginTop: 2, color: phoneDigits ? t.sub : t.faint }}>
                {phoneDigits ? client.phone : "Телефон не указан"}
              </Text>
            </View>
            {phoneDigits ? (
              <RowActionButton
                icon={Phone}
                color={t.accent}
                label={`Позвонить ${client.phone}`}
                onPress={() => void Linking.openURL(`tel:${phoneDigits}`)}
              />
            ) : null}
          </View>
          <Text style={{ ...LIST_ROW.sub, color: t.faint, paddingHorizontal: 16, paddingBottom: 10 }}>
            Только рабочая информация по назначенным записям.
          </Text>
        </SectionCard>

        <SectionCard title="Назначенные записи">
          {assigned.length === 0 ? (
            <Text style={{ padding: 16, ...LIST_ROW.sub, color: t.sub }}>
              Доступных заявок нет
            </Text>
          ) : (
            assigned.map((appointment, index) => {
              const names = serviceNamesOf(appointment, serviceById);
              return (
                <View key={appointment.id}>
                  {index > 0 ? (
                    <View style={{ height: 1, backgroundColor: t.separator }} />
                  ) : null}
                  <Pressable
                    onPress={() => onOpenAppointment(appointment)}
                    accessibilityRole="button"
                    accessibilityLabel={`Открыть запись ${humanDay(appointment.date)} ${appointment.time_start}`}
                    className="flex-row items-center gap-3 px-4 py-2 active:opacity-70"
                    style={{ minHeight: LIST_ROW.minHeight }}
                  >
                    <View className="min-w-0 flex-1">
                      <Text style={{ ...LIST_ROW.name, color: t.ink }}>
                        {humanDay(appointment.date)} · {appointment.time_start}–{appointment.time_end}
                      </Text>
                      <Text
                        style={{ marginTop: 1, ...LIST_ROW.sub, color: t.sub }}
                        numberOfLines={2}
                      >
                        {[
                          STATUS_LABELS[appointment.status],
                          names.join(" · "),
                          appointment.address,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </Text>
                    </View>
                    <ChevronRight color={t.chevron} size={20} />
                  </Pressable>
                </View>
              );
            })
          )}
        </SectionCard>
      </ScrollView>
    </Screen>
  );
}

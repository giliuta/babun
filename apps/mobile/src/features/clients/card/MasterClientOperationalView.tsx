import { Linking, Pressable, ScrollView, Text, View } from "react-native";
import { ChevronRight, Phone } from "lucide-react-native";
import type { Client } from "@babun/shared/local/clients";
import type { Appointment } from "@babun/shared/local/appointments";
import { STATUS_LABELS } from "@babun/shared/local/appointments";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
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
        <View className="px-4 pb-2 pt-3">
          <Text style={{ fontSize: 24, fontWeight: "700", color: t.ink }}>
            {client.full_name || "Клиент"}
          </Text>
          <Text style={{ marginTop: 4, fontSize: 13, lineHeight: 18, color: t.sub }}>
            Только рабочая информация по назначенным записям.
          </Text>
        </View>

        <SectionCard title="Контакт">
          {phoneDigits ? (
            <Pressable
              onPress={() => void Linking.openURL(`tel:${phoneDigits}`)}
              accessibilityRole="button"
              accessibilityLabel={`Позвонить ${client.phone}`}
              className="min-h-14 flex-row items-center gap-3 px-4 py-3 active:opacity-70"
            >
              <Phone color={t.accent} size={20} />
              <View className="flex-1">
                <Text style={{ fontSize: 12, color: t.sub }}>Телефон для выезда</Text>
                <Text style={{ marginTop: 2, fontSize: 16, color: t.ink }}>
                  {client.phone}
                </Text>
              </View>
            </Pressable>
          ) : (
            <Text style={{ padding: 16, fontSize: 14, color: t.sub }}>
              Телефон не указан
            </Text>
          )}
        </SectionCard>

        <SectionCard title="Назначенные записи">
          {assigned.length === 0 ? (
            <Text style={{ padding: 16, fontSize: 14, color: t.sub }}>
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
                    className="min-h-[72px] flex-row items-center gap-3 px-4 py-3 active:opacity-70"
                  >
                    <View className="min-w-0 flex-1">
                      <Text style={{ fontSize: 15, fontWeight: "600", color: t.ink }}>
                        {humanDay(appointment.date)} · {appointment.time_start}–{appointment.time_end}
                      </Text>
                      <Text
                        style={{ marginTop: 3, fontSize: 13, color: t.sub }}
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

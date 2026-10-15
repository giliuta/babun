import { ScrollView, Text, View } from "react-native";
import { Trash2 } from "lucide-react-native";
import type { Client } from "@babun/shared/local/clients";
import type { Appointment } from "@babun/shared/local/appointments";
import { STATUS_LABELS } from "@babun/shared/local/appointments";
import { Button } from "@/components/ui/Button";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { useThemeColors } from "@/theme/colors";
import { archivedVisitTag } from "@/features/clients/archived-visit";
import { daysLeft, daysWordRu } from "@/features/clients/HiddenClientsScreen";
import { humanDay } from "@/features/appointments/helpers";
import { useTeams } from "@/features/reference/queries";
import { newestFirst, serviceNamesOf } from "./card-history";

/** Карточка удалённого клиента: только чтение и «Восстановить». */
export function ArchivedClientView({
  client,
  appointments,
  services,
  restoring,
  onBack,
  onRestore,
}: {
  client: Client;
  appointments: Appointment[];
  services: readonly { id: string; name: string }[];
  restoring: boolean;
  onBack: () => void;
  onRestore: () => Promise<void>;
}) {
  const t = useThemeColors();
  // УДАЛЁННЫЙ КЛИЕНТ (архива нет). Срок есть — страница говорит,
  // когда его сотрут; нет (у клиента история) — только когда удалён.
  const daysToPurge = client.purge_at ? daysLeft(client.purge_at) : null;
  const archivedAt = client.deleted_at ? new Date(client.deleted_at) : null;
  const archivedLabel =
    archivedAt && !Number.isNaN(archivedAt.getTime())
      ? new Intl.DateTimeFormat("ru-RU", {
          day: "numeric",
          month: "long",
          year: "numeric",
        }).format(archivedAt)
      : null;
  const serviceById = new Map(services.map((service) => [service.id, service.name]));
  const history = newestFirst(appointments);
  // Заявка архивного календаря называет свою команду (`archived-visit.ts`).
  const { data: allTeams = [] } = useTeams({ includeInactive: true });
  const teamsById = new Map(allTeams.map((team) => [team.id, team]));

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Удалённый клиент" onBack={onBack} />
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <View className="items-center px-5 pb-5 pt-5">
          <View
            className="h-14 w-14 items-center justify-center rounded-[10px]"
            style={{ backgroundColor: t.fill }}
          >
            <Trash2 color={t.sub} size={26} />
          </View>
          <Text
            className="mt-3 text-center text-2xl font-bold"
            style={{ color: t.ink }}
          >
            {client.full_name || client.phone || "Клиент"}
          </Text>
          <Text
            className="mt-1 text-center text-[13px] leading-5"
            style={{ color: t.sub }}
          >
            {`${archivedLabel ? `Удалён ${archivedLabel}. ` : "Удалён. "}${
              daysToPurge === null
                ? ""
                : daysToPurge <= 0
                  ? "Будет стёрт сегодня. "
                  : `Будет стёрт через ${daysToPurge} ${daysWordRu(daysToPurge)}. `
            }`}
            Карточка доступна только для чтения; история записей и инвойсов сохранена.
          </Text>
        </View>

        <SectionCard title="Контакт">
          <View className="px-4 py-3">
            <Text className="text-xs" style={{ color: t.sub }}>Телефон</Text>
            <Text className="mt-1 text-base" style={{ color: t.ink }}>
              {client.phone || "Не указан"}
            </Text>
          </View>
        </SectionCard>

        <SectionCard title={`История записей · ${history.length}`}>
          {history.length === 0 ? (
            <Text className="px-4 py-4 text-sm" style={{ color: t.sub }}>
              Записей нет
            </Text>
          ) : (
            history.slice(0, 20).map((appointment, index) => {
              const names = serviceNamesOf(appointment, serviceById);
              return (
                <View key={appointment.id}>
                  {index > 0 ? (
                    <View className="h-px" style={{ backgroundColor: t.separator }} />
                  ) : null}
                  <View className="px-4 py-3">
                    <Text className="text-sm font-semibold" style={{ color: t.ink }}>
                      {humanDay(appointment.date)} · {appointment.time_start}–{appointment.time_end}
                    </Text>
                    <Text className="mt-1 text-xs" style={{ color: t.sub }} numberOfLines={2}>
                      {[
                        archivedVisitTag(appointment.team_id, teamsById),
                        names.join(" · ") || STATUS_LABELS[appointment.status] || "Запись",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </Text>
                  </View>
                </View>
              );
            })
          )}
        </SectionCard>

        <View className="px-4 pt-5">
          {/* КНОПКА ОДНА НА ПРОДУКТ: была своя, 48pt со значком внутри.
              Значка у канонической кнопки нет — слово и так называет
              действие, а спиннер ожидания она умеет сама. */}
          <Button
            label="Восстановить клиента"
            loading={restoring}
            onPress={() => void onRestore()}
          />
        </View>
      </ScrollView>
    </Screen>
  );
}

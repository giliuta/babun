import { useRecordFeaturesOff } from "@/features/appointments/booking-prefs";
import { useMemo } from "react";
import { Linking, Modal, ScrollView, Text } from "react-native";
import { useRouter } from "expo-router";
import { ExternalLink, MapPin } from "lucide-react-native";
import type {
  Appointment,
  PersonalEventRepeat,
} from "@babun/shared/local/appointments";

import { MirrorBanner } from "@/features/access/mirror/MirrorBanner";
import { useMyAccess } from "@/features/access/queries";
import { Divider } from "@/components/ui/Divider";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { ICON } from "@/components/ui/tokens";
import { useClients } from "@/features/clients/queries";
import { useTeams } from "@/features/reference/queries";
import { useCurrentRole } from "@/features/settings/tenant";
import { useAllServices } from "@/features/services/queries";
import { crewAddress, crewBlocks } from "@/features/appointments/crew-blocks";
import { crewMoney, crewWorkLines } from "@/features/appointments/crew-work";
import { ActionRow, InfoRow } from "@/features/appointments/crew-rows";
import { CrewWorkRecord } from "@/features/appointments/CrewWorkRecord";
import { humanDay } from "@/features/appointments/helpers";
import { useThemeColors } from "@/theme/colors";

const REPEAT_LABELS: Record<PersonalEventRepeat["kind"], string> = {
  none: "Не повторяется",
  daily: "Каждый день",
  weekdays: "По будням",
  weekly: "Каждую неделю",
  biweekly: "Каждые 2 недели",
  monthly: "Каждый месяц",
  yearly: "Каждый год",
  custom_weekdays: "По выбранным дням",
};

function eventRepeatLabel(repeat: PersonalEventRepeat | undefined): string {
  if (!repeat || repeat.kind === "none") return REPEAT_LABELS.none;
  return `${REPEAT_LABELS[repeat.kind]}${repeat.until ? ` · до ${humanDay(repeat.until)}` : ""}`;
}

function externalUrl(value: string): string {
  return /^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value}`;
}

/** Restricted appointment detail. Work records show each block by the
 * person's level in the record's calendar (`crew-blocks.ts`). Team events are
 * read-only for a master and for an operator who is not the event's creator. */
export function CrewAppointmentSheet({
  appointment,
  onClose,
}: {
  appointment: Appointment | null;
  onClose: () => void;
}) {
  const t = useThemeColors();
  const router = useRouter();
  const { data: clients = [] } = useClients();
  const { data: teams = [] } = useTeams();
  // Наряд только ЧИТАЕТ услуги — значит читает все, включая убранные:
  // команда не должна видеть в сегодняшнем наряде безымянную «Услуга».
  const { data: services = [] } = useAllServices();
  // В зеркале роль и карта — его: карточка показывает то, что увидит он.
  const role = useCurrentRole().data;
  const access = useMyAccess().data;

  // Функции компании плюс блоки «Дизайна» команды записи (24.09).
  const disabledFeatures = useRecordFeaturesOff(appointment?.team_id ?? null);
  const blocks = crewBlocks({
    role,
    map: access,
    teamId: appointment?.team_id ?? null,
    disabledFeatures,
  });
  const client =
    blocks.client && appointment?.client_id
      ? clients.find((item) => item.id === appointment.client_id) ?? null
      : null;
  const team = appointment?.team_id
    ? teams.find((item) => item.id === appointment.team_id) ?? null
    : null;
  // СНИМОК ЗАПИСИ ПЕРВЫМ, каталог вторым (`crew-work.ts`): наряд читает
  // бригада НА ОБЪЕКТЕ, и имя работы на день визита лежит в самой записи.
  const catalogNames = useMemo(
    () => new Map(services.map((item) => [item.id, item.name])),
    [services],
  );

  if (!appointment) return null;

  const isEvent = appointment.kind === "event" || appointment.kind === "personal";
  // Адрес события — его собственный, а не объект выезда: «Объект в записи»
  // его не касается.
  const address = isEvent
    ? (appointment.address || client?.address || "").trim()
    : crewAddress(appointment.address, client?.address, blocks);

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      {/* ЛИСТ — ОТДЕЛЬНОЕ ОКНО, И КОРНЕВАЯ ПЛАШКА ПОД НИМ НЕ ВИДНА. А это
          главный экран зеркала: при роли мастера тап по любой записи ведёт
          сюда, и владелец оказывался в режиме без признака и без выхода. */}
      <MirrorBanner inModal />
      <Screen edges={["top"]}>
        <ScreenHeader
          title={client?.full_name || appointment.comment || "Заявка"}
          subtitle={`${humanDay(appointment.date)} · ${appointment.time_start}–${appointment.time_end}`}
          onBack={onClose}
        />
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: 32 }}
        >
          {isEvent ? (
            <>
              <SectionCard title="Событие">
                <InfoRow
                  label="Когда"
                  value={
                    appointment.event_all_day
                      ? `${humanDay(appointment.date)}, весь день`
                      : `${humanDay(appointment.date)}, ${appointment.time_start}–${appointment.time_end}`
                  }
                />
                <Divider inset={16} />
                <InfoRow
                  label="Календарь"
                  value={team?.name ?? "Личное событие"}
                />
                <Divider inset={16} />
                <InfoRow
                  label="Повтор"
                  value={eventRepeatLabel(appointment.event_repeat)}
                />
              </SectionCard>

              {appointment.event_notes?.trim() ? (
                <SectionCard title="Заметка">
                  <Text
                    style={{ padding: 16, fontSize: 15, lineHeight: 21, color: t.ink }}
                  >
                    {appointment.event_notes.trim()}
                  </Text>
                </SectionCard>
              ) : null}

              {address || appointment.event_url?.trim() ? (
                <SectionCard title="Ссылки">
                  {address ? (
                    <ActionRow
                      icon={<MapPin color={t.accent} size={ICON.sm} />}
                      title={address}
                      subtitle="Открыть маршрут"
                      onPress={() =>
                        void Linking.openURL(
                          `https://maps.apple.com/?daddr=${encodeURIComponent(address)}`,
                        )
                      }
                    />
                  ) : null}
                  {address && appointment.event_url?.trim() ? (
                    <Divider inset={16} />
                  ) : null}
                  {appointment.event_url?.trim() ? (
                    <ActionRow
                      icon={<ExternalLink color={t.accent} size={ICON.sm} />}
                      title={appointment.event_url.trim()}
                      subtitle="Открыть ссылку"
                      onPress={() =>
                        void Linking.openURL(externalUrl(appointment.event_url!.trim()))
                      }
                    />
                  ) : null}
                </SectionCard>
              ) : null}

              <Text
                style={{
                  paddingHorizontal: 24,
                  paddingTop: 8,
                  fontSize: 13,
                  lineHeight: 18,
                  textAlign: "center",
                  color: t.sub,
                }}
              >
                Просмотр события. Изменить его может только автор.
              </Text>
            </>
          ) : (
            <CrewWorkRecord
              appointment={appointment}
              blocks={blocks}
              client={client}
              address={address}
              teamName={team?.name ?? null}
              workLines={crewWorkLines(appointment, catalogNames, blocks)}
              money={crewMoney(appointment, blocks)}
              role={role}
              onOpenClient={(clientId) => {
                onClose();
                router.push(`/clients/${clientId}`);
              }}
            />
          )}
        </ScrollView>
      </Screen>
    </Modal>
  );
}

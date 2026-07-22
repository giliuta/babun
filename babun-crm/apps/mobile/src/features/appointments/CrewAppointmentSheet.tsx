import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Alert,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { ExternalLink, MapPin, Phone, UserRound } from "lucide-react-native";
import type {
  Appointment,
  AppointmentStatus,
  PersonalEventRepeat,
} from "@babun/shared/local/appointments";

import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Divider } from "@/components/ui/Divider";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { ICON } from "@/components/ui/tokens";
import { useToast } from "@/components/ui/Toast";
import { useUpdateAppointment } from "@/features/calendar/mutations";
import { useClients } from "@/features/clients/queries";
import { useTeams } from "@/features/reference/queries";
import { useServices } from "@/features/services/queries";
import { AppointmentPhotos } from "@/features/appointments/AppointmentPhotos";
import { humanDay } from "@/features/appointments/helpers";
import { useThemeColors } from "@/theme/colors";

const CREW_STATUSES: readonly {
  value: Exclude<AppointmentStatus, "cancelled">;
  label: string;
}[] = [
  { value: "scheduled", label: "Запланировано" },
  { value: "in_progress", label: "В работе" },
  { value: "completed", label: "Выполнено" },
];

function canCrewSelectStatus(
  current: AppointmentStatus,
  next: Exclude<AppointmentStatus, "cancelled">,
): boolean {
  return (
    current === next ||
    (current === "scheduled" && next === "in_progress") ||
    (current === "in_progress" && next === "completed")
  );
}

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

/** Restricted appointment detail. Work records expose the two writes allowed
 * to a master (forward status + comment). Team events are read-only for a
 * master and for an operator who is not the event's creator. */
export function CrewAppointmentSheet({
  appointment,
  onClose,
}: {
  appointment: Appointment | null;
  onClose: () => void;
}) {
  const t = useThemeColors();
  const router = useRouter();
  const toast = useToast();
  const update = useUpdateAppointment();
  const { data: clients = [] } = useClients();
  const { data: teams = [] } = useTeams();
  const { data: services = [] } = useServices();
  const [comment, setComment] = useState("");
  const [savedComment, setSavedComment] = useState("");
  const [status, setStatus] = useState<AppointmentStatus>("scheduled");

  useEffect(() => {
    setComment(appointment?.comment ?? "");
    setSavedComment(appointment?.comment ?? "");
    setStatus(appointment?.status ?? "scheduled");
  }, [appointment?.id, appointment?.comment, appointment?.status]);

  const client = appointment?.client_id
    ? clients.find((item) => item.id === appointment.client_id) ?? null
    : null;
  const team = appointment?.team_id
    ? teams.find((item) => item.id === appointment.team_id) ?? null
    : null;
  const serviceNames = useMemo(() => {
    if (!appointment) return [];
    const byId = new Map(services.map((item) => [item.id, item.name]));
    return appointment.service_ids.map((id) => byId.get(id) ?? "Услуга");
  }, [appointment, services]);

  if (!appointment) return null;

  const phone = client?.phone?.trim() ?? "";
  const address = (appointment.address || client?.address || "").trim();
  const commentChanged = comment.trim() !== savedComment.trim();
  const isEvent = appointment.kind === "event" || appointment.kind === "personal";

  const patch = async (next: Partial<Appointment>, success: string) => {
    try {
      await update.mutateAsync({ id: appointment.id, patch: next });
      if (next.status) setStatus(next.status);
      if (next.comment !== undefined) setSavedComment(next.comment);
      toast(success, "success");
    } catch (error) {
      Alert.alert(
        "Не удалось сохранить",
        error instanceof Error ? error.message : "Попробуйте ещё раз",
      );
    }
  };

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
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
            <>
          <SectionCard title="Статус">
            {status === "cancelled" ? (
              <Text style={{ padding: 16, fontSize: 15, color: t.danger }}>
                Запись отменена диспетчером
              </Text>
            ) : (
              <View className="flex-row flex-wrap gap-2 p-3">
                {CREW_STATUSES.map((item) => (
                  <Chip
                    key={item.value}
                    label={item.label}
                    radio
                    selected={status === item.value}
                    disabled={!canCrewSelectStatus(status, item.value)}
                    dimmed={!canCrewSelectStatus(status, item.value)}
                    onPress={() => {
                      if (status !== item.value) {
                        void patch({ status: item.value }, `Статус: ${item.label}`);
                      }
                    }}
                  />
                ))}
              </View>
            )}
          </SectionCard>

          <SectionCard title="Выезд">
            <InfoRow label="Когда" value={`${humanDay(appointment.date)}, ${appointment.time_start}–${appointment.time_end}`} />
            <Divider inset={16} />
            <InfoRow label="Бригада" value={team?.name ?? "Не указана"} />
            {address ? (
              <>
                <Divider inset={16} />
                <ActionRow
                  icon={<MapPin color={t.accent} size={ICON.sm} />}
                  title={address}
                  subtitle={appointment.address_note || "Открыть маршрут"}
                  onPress={() =>
                    void Linking.openURL(
                      `https://maps.apple.com/?daddr=${encodeURIComponent(address)}`,
                    )
                  }
                />
              </>
            ) : null}
          </SectionCard>

          <SectionCard title="Клиент">
            <InfoRow label="Имя" value={client?.full_name || "Без имени"} />
            {phone ? (
              <>
                <Divider inset={16} />
                <ActionRow
                  icon={<Phone color={t.accent} size={ICON.sm} />}
                  title={phone}
                  subtitle="Позвонить"
                  onPress={() =>
                    void Linking.openURL(`tel:${phone.replace(/[^+\d]/g, "")}`)
                  }
                />
              </>
            ) : null}
            {client ? (
              <>
                <Divider inset={16} />
                <ActionRow
                  icon={<UserRound color={t.accent} size={ICON.sm} />}
                  title="Открыть карточку клиента"
                  subtitle="Контакты и назначенные выезды"
                  onPress={() => {
                    onClose();
                    router.push(`/clients/${client.id}`);
                  }}
                />
              </>
            ) : null}
          </SectionCard>

          <SectionCard title="Работы">
            <Text style={{ padding: 16, fontSize: 15, lineHeight: 21, color: t.ink }}>
              {serviceNames.length > 0 ? serviceNames.join(" · ") : "Услуги не указаны"}
            </Text>
          </SectionCard>

          <AppointmentPhotos
            appointmentId={appointment.id}
            locationId={appointment.location_id}
            consentGiven={appointment.consent_given}
            canUpload={status !== "cancelled"}
            canDelete={false}
          />

          <SectionCard title="Заметка бригады" padded>
            <TextInput
              keyboardAppearance="light"
              accessibilityLabel="Комментарий к заявке"
              value={comment}
              onChangeText={setComment}
              multiline
              placeholder="Что важно знать по заявке"
              placeholderTextColor={t.placeholder}
              style={{
                minHeight: 88,
                borderRadius: 14,
                borderWidth: 1,
                borderColor: t.separator,
                padding: 12,
                fontSize: 15,
                lineHeight: 20,
                color: t.ink,
                textAlignVertical: "top",
              }}
            />
            <View style={{ marginTop: 12 }}>
              <Button
                label="Сохранить заметку"
                onPress={() => void patch({ comment: comment.trim() }, "Заметка сохранена")}
                disabled={!commentChanged || update.isPending}
                loading={update.isPending}
              />
            </View>
          </SectionCard>
            </>
          )}
        </ScrollView>
      </Screen>
    </Modal>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  const t = useThemeColors();
  return (
    <View style={{ minHeight: 52, paddingHorizontal: 16, paddingVertical: 10 }}>
      <Text style={{ fontSize: 12, color: t.faint }}>{label}</Text>
      <Text style={{ marginTop: 2, fontSize: 15, color: t.ink }}>{value}</Text>
    </View>
  );
}

function ActionRow({
  icon,
  title,
  subtitle,
  onPress,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  const t = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${subtitle}`}
      style={({ pressed }) => ({
        minHeight: 56,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 10,
        backgroundColor: pressed ? t.pressed : "transparent",
      })}
    >
      {icon}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={2} style={{ fontSize: 15, color: t.ink }}>
          {title}
        </Text>
        <Text numberOfLines={1} style={{ marginTop: 2, fontSize: 12, color: t.sub }}>
          {subtitle}
        </Text>
      </View>
    </Pressable>
  );
}

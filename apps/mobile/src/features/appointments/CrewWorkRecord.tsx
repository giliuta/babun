import { useEffect, useState } from "react";
import { Linking, Text, TextInput, View } from "react-native";
import { MapPin, Phone, UserRound } from "lucide-react-native";
import type { Appointment, AppointmentStatus } from "@babun/shared/local/appointments";
import type { Client } from "@babun/shared/local/clients";
import { formatEURExact } from "@babun/shared/common/utils/money";

import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Divider } from "@/components/ui/Divider";
import { SectionCard } from "@/components/ui/SectionCard";
import { ICON } from "@/components/ui/tokens";
import { useToast } from "@/components/ui/Toast";
import { useUpdateAppointment } from "@/features/calendar/mutations";
import { AppointmentFilesBlock } from "@/features/appointments/AppointmentFilesBlock";
import { humanDay } from "@/features/appointments/helpers";
import { notify } from "@/lib/notify";
import { useThemeColors } from "@/theme/colors";

import type { CrewBlocks } from "./crew-blocks";
import { ActionRow, AmountRow, InfoRow, WorkLineRow } from "./crew-rows";
import type { CrewMoney, CrewWorkLine } from "./crew-work";

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

/** Запись глазами команды. Каждый блок стоит на своём праве (`crew-blocks.ts`):
 *  закрытого нет вовсе, «Смотрит» — без кнопок, «Меняет» — как было. */
export function CrewWorkRecord({
  appointment,
  blocks,
  client,
  address,
  teamName,
  workLines,
  money,
  role,
  onOpenClient,
}: {
  appointment: Appointment;
  blocks: CrewBlocks;
  /** Уже по праву: при закрытом «Клиенте» здесь `null`. */
  client: Client | null;
  /** Уже по праву: при закрытом «Объекте» здесь пусто. */
  address: string;
  teamName: string | null;
  /** Уже по праву: без «Услуг» пусто, без «Суммы» — без цен (`crew-work.ts`). */
  workLines: CrewWorkLine[];
  money: CrewMoney;
  role: "owner" | "dispatcher" | "master" | null | undefined;
  onOpenClient: (clientId: string) => void;
}) {
  const t = useThemeColors();
  const toast = useToast();
  const update = useUpdateAppointment();
  const [comment, setComment] = useState(appointment.comment ?? "");
  const [savedComment, setSavedComment] = useState(appointment.comment ?? "");
  const [status, setStatus] = useState<AppointmentStatus>(appointment.status);

  useEffect(() => {
    setComment(appointment.comment ?? "");
    setSavedComment(appointment.comment ?? "");
    setStatus(appointment.status);
  }, [appointment.id, appointment.comment, appointment.status]);

  const phone = client?.phone?.trim() ?? "";
  const commentChanged = comment.trim() !== savedComment.trim();
  // Заметку пишет тот, кто меняет статус (владелец 21.09: «если статус
  // меняется — значит он может писать заметку»); остальные её только читают.
  const canWriteNote = blocks.status === "write";

  const patch = async (next: Partial<Appointment>, success: string) => {
    try {
      await update.mutateAsync({ id: appointment.id, patch: next });
      if (next.status) setStatus(next.status);
      if (next.comment !== undefined) setSavedComment(next.comment);
      toast(success, "success");
    } catch (error) {
      notify(
        "Не удалось сохранить",
        error instanceof Error ? error.message : "Попробуйте ещё раз",
      );
    }
  };

  return (
    <>
      {blocks.status !== "hidden" ? (
        <SectionCard title="Статус">
          {status === "cancelled" ? (
            <Text style={{ padding: 16, fontSize: 15, color: t.danger }}>
              Запись отменена диспетчером
            </Text>
          ) : blocks.status === "read" ? (
            <Text style={{ padding: 16, fontSize: 15, color: t.ink }}>
              {CREW_STATUSES.find((item) => item.value === status)?.label ?? "Запланировано"}
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
      ) : null}

      <SectionCard title="Выезд">
        <InfoRow
          label="Когда"
          value={`${humanDay(appointment.date)}, ${appointment.time_start}–${appointment.time_end}`}
        />
        <Divider inset={16} />
        <InfoRow label="Команда" value={teamName ?? "Не указана"} />
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

      {blocks.client ? (
        <SectionCard title="Клиент">
          <InfoRow label="Имя" value={client?.full_name || "Без имени"} />
          {phone ? (
            <>
              <Divider inset={16} />
              <ActionRow
                icon={<Phone color={t.accent} size={ICON.sm} />}
                title={phone}
                subtitle="Позвонить"
                onPress={() => void Linking.openURL(`tel:${phone.replace(/[^+\d]/g, "")}`)}
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
                onPress={() => onOpenClient(client.id)}
              />
            </>
          ) : null}
        </SectionCard>
      ) : null}

      {/* РАБОТЫ И «ИТОГО» — ОДИН БЛОК, как в записи у владельца («блок в
          услугах — итого», владелец 21.09). Без «Услуг» блока нет вовсе,
          без «Суммы» строки идут без цен и без «Итого». */}
      {blocks.services ? (
        <SectionCard title="Работы">
          {workLines.length > 0 ? (
            workLines.map((line, index) => (
              <View
                key={line.key}
                style={{ borderTopWidth: index > 0 ? 1 : 0, borderTopColor: t.separator }}
              >
                <WorkLineRow line={line} />
              </View>
            ))
          ) : (
            <Text style={{ padding: 16, fontSize: 15, lineHeight: 21, color: t.ink }}>
              Услуги не указаны
            </Text>
          )}
          {money.total !== null ? (
            <>
              <Divider inset={16} />
              <TotalRow money={money} />
            </>
          ) : null}
        </SectionCard>
      ) : null}

      {/* ОПЛАТА — СВОИМ БЛОКОМ, как в записи у владельца. Статус словом, а
          сколько внесено — только вместе с «Суммой»: это деньги. «Итого»
          переезжает сюда, лишь когда блока работ нет. */}
      {money.payment || (!blocks.services && money.total !== null) ? (
        <SectionCard title="Оплата">
          {!blocks.services && money.total !== null ? <TotalRow money={money} /> : null}
          {money.payment ? (
            <>
              {!blocks.services && money.total !== null ? <Divider inset={16} /> : null}
              <AmountRow
                label={money.payment.word}
                value={money.payment.paid !== null ? formatEURExact(money.payment.paid) : null}
              />
            </>
          ) : null}
        </SectionCard>
      ) : null}

      {blocks.files !== "hidden" ? (
        <AppointmentFilesBlock
          appointmentId={appointment.id}
          clientId={null}
          locationId={blocks.object ? appointment.location_id : null}
          canUpload={blocks.files === "write" && status !== "cancelled"}
          // Удалять файлы сервер пускает только владельца и диспетчера, и то
          // при «Меняет»; мастеру корзинку не рисуем (15.09).
          canDelete={blocks.files === "write" && role !== "master"}
          pending={[]}
          onPendingChange={() => {}}
        />
      ) : null}

      {canWriteNote ? (
        <SectionCard title="Заметка команды" padded>
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
              borderRadius: t.radius.card,
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
      ) : savedComment.trim() ? (
        <SectionCard title="Заметка команды">
          <Text style={{ padding: 16, fontSize: 15, lineHeight: 21, color: t.ink }}>
            {savedComment.trim()}
          </Text>
        </SectionCard>
      ) : null}
    </>
  );
}

function TotalRow({ money }: { money: CrewMoney }) {
  if (money.total === null) return null;
  return (
    <AmountRow
      label="Итого"
      value={formatEURExact(money.total)}
      note={money.discount !== null ? `Скидка ${formatEURExact(money.discount)}` : null}
      strong
    />
  );
}

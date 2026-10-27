import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
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
import { formatPhoneForDisplay } from "@/lib/phone";
import { useDefaultCountry } from "@/features/reference/default-country";
import { addressLines } from "@/features/clients/object-address";
import { extraLabelText } from "@/features/clients/extra-contacts/extra-labels";

/** Строка «подпись — значение» карточки только для чтения. */
function ReadRow({ label, value, first }: { label: string; value: string; first?: boolean }) {
  const t = useThemeColors();
  return (
    <View>
      {first ? null : <View className="ml-4 h-px" style={{ backgroundColor: t.separator }} />}
      <View className="px-4 py-3">
        <Text className="text-xs" style={{ color: t.sub }}>{label}</Text>
        <Text className="mt-1 text-base" style={{ color: t.ink }}>{value}</Text>
      </View>
    </View>
  );
}

/** Карточка удалённого клиента: только чтение и «Вернуть». */
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
  /** Вернуть клиента. Нет — кнопки нет: вернуть может только владелец своей
   *  базы (так же решает сервер), остальным кнопка обещала бы отказ. */
  onRestore?: () => Promise<void>;
}) {
  const t = useThemeColors();
  const insets = useSafeAreaInsets();
  const country = useDefaultCountry(client.team_id ?? null);
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
  const contactRows: { label: string; value: string }[] = [
    client.phone?.trim()
      ? { label: "Телефон", value: formatPhoneForDisplay(client.phone, country) }
      : null,
    ...(client.phones ?? [])
      .filter((entry) => entry.number?.trim())
      .map((entry) => ({ label: extraLabelText(entry.label), value: formatPhoneForDisplay(entry.number, country) })),
    client.email?.trim() ? { label: "Почта", value: client.email.trim() } : null,
    client.telegram_username?.trim() ? { label: "Telegram", value: `@${client.telegram_username.trim().replace(/^@/, "")}` } : null,
    client.instagram_username?.trim() ? { label: "Instagram", value: `@${client.instagram_username.trim().replace(/^@/, "")}` } : null,
  ].filter((row): row is { label: string; value: string } => row !== null);
  const places = (client.locations ?? []).map((loc) => {
    const lines = addressLines(loc);
    return {
      id: loc.id,
      label: loc.label?.trim() || "Объект",
      value: [lines.main, lines.detail].filter(Boolean).join(" · ") || "Адрес не указан",
    };
  });
  const note = [...(client.notes ?? [])]
    .filter((n) => n.text?.trim())
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];

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
            Карточка доступна только для чтения; история записей сохранена.
          </Text>
        </View>

        {/* КАРТОЧКА ПОЛНАЯ, ТОЛЬКО ДЛЯ ЧТЕНИЯ: всё, что было у клиента, — в
            том же виде, что на живой карточке (номера — общим видом, доп.
            номера — с подписью), чтобы решить, возвращать ли его. */}
        <SectionCard title="Контакт">
          {contactRows.length === 0 ? (
            <Text className="px-4 py-4 text-sm" style={{ color: t.sub }}>
              Контактов нет
            </Text>
          ) : (
            contactRows.map((row, index) => (
              <ReadRow key={`${row.label}-${index}`} label={row.label} value={row.value} first={index === 0} />
            ))
          )}
        </SectionCard>

        {places.length > 0 ? (
          <SectionCard title="Объекты">
            {places.map((place, index) => (
              <ReadRow key={place.id} label={place.label} value={place.value} first={index === 0} />
            ))}
          </SectionCard>
        ) : null}

        {note ? (
          <SectionCard title="Заметка">
            <ReadRow label={humanDay(note.created_at.slice(0, 10))} value={note.text} first />
          </SectionCard>
        ) : null}

        <SectionCard title={`История записей · ${history.length}`}>
          {history.length === 0 ? (
            <Text className="px-4 py-4 text-sm" style={{ color: t.sub }}>
              Записей нет
            </Text>
          ) : (
            history.map((appointment, index) => {
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

      </ScrollView>
      {/* «ВЕРНУТЬ» — В ФУТЕРЕ СТРАНИЦЫ, как главное действие любой страницы, а
          не посреди прокрутки после истории. Нет права — футера нет. */}
      {onRestore ? (
        <View
          style={{
            paddingHorizontal: 20,
            paddingTop: 8,
            paddingBottom: Math.max(insets.bottom, 12),
            borderTopWidth: 1,
            borderTopColor: t.separator,
            backgroundColor: t.surface,
          }}
        >
          <Button
            label="Вернуть клиента"
            loading={restoring}
            onPress={() => void onRestore()}
          />
        </View>
      ) : null}
    </Screen>
  );
}

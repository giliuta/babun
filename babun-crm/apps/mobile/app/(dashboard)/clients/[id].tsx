// Client detail card — COMPOSER (mobile port of the web ClientCardPage,
// «Карта-диспетчер» LOCKED design).
//
// This screen does ALL data wiring; the blocks are presentational. It
// fetches the client + its appointments, computes the shared `stats`
// (client-stats selector) and `serviceDue` (service-due selector), then
// renders in the web ClientCardPage order:
//
//   ClientHeader (карточка-идентичность) · ClientNextJob (hero)
//   · CardActions (Звонок · WhatsApp · Чат · Напомнить [· Записать])
//   · ServiceBlock («Обслуживание» spine, hero unit de-duped)
//   · ObjectsBlock (equipment-first) · NotesBlock
//   · collapsed reference: Visits · Finance · Attachments
//     · Contacts · Personal · Meta
//
// СОЗДАНИЕ = ЭТА ЖЕ СТРАНИЦА (решение владельца 2026-07-13, уточнено
// 2026-07-14): роут /clients/new попадает сюда с id="new" → карточка
// работает с ЧЕРНОВИКОМ (createBlankClient) через локальный update.
// Шапка НЕ подменяется формой — это тот же ClientHeader с `draft`:
// те же поля пустые, телефон с автофокусом и live-дедупом по phone_e164
// (clients-99 F1.5/F2.7). «Готово» создаёт клиента и router.replace
// приводит на этот же экран уже с сервера.
//
// ЧТО ВИДНО В ЧЕРНОВИКЕ: идентичность + объекты + заметки — то, что
// реально можно заполнить заранее; всё внесённое уезжает одним create.
// Скрыты (а) блоки-ДЕЙСТВИЯ — hero, ряд, ТО, вложения: им нужен реальный
// id; (б) блоки-ИСТОРИЯ и справочник — Визиты/Финансы/Контакты/Личное/
// Мета: до создания у них НЕТ данных, и «Записей пока нет · Финансы —»
// вокруг двух полей были чистым шумом.
//
// A top chrome row owns the back button + a ⋯ action menu (message via
// Linking sms:, share via RN Share, blacklist toggle via update) — the
// blocks stay free of screen-level concerns.

import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Share,
  Text,
  View,
} from "react-native";
import { Archive, ChevronRight, Phone, RotateCcw } from "lucide-react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import type { Client } from "@babun/shared/local/clients";
import type { Appointment } from "@babun/shared/local/appointments";
import { STATUS_LABELS } from "@babun/shared/local/appointments";
import { buildStats } from "@babun/shared/local/selectors/client-stats";
import { buildServiceDue } from "@babun/shared/local/selectors/service-due";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { useThemeColors } from "@/theme/colors";
import {
  useClient,
  useClientTags,
  useArchiveClients,
  useRestoreClient,
  useUpdateClient,
} from "@/features/clients/queries";
import { useClientAppointments } from "@/features/clients/appointments";
import { useServices } from "@/features/services/queries";
import ClientHeader from "@/features/clients/ClientHeader";
import { ClientDataNotice } from "@/features/clients/ClientDataNotice";
import { ClientDetailChrome } from "@/features/clients/ClientDetailChrome";
import { ClientDraftNotice } from "@/features/clients/ClientDraftNotice";
import { ClientProfileBlocks } from "@/features/clients/ClientProfileBlocks";
import { useClientDraft } from "@/features/clients/useClientDraft";
import ClientNextJob from "@/features/clients/ClientNextJob";
import CardActions from "@/features/clients/card-actions";
import ServiceBlock from "@/features/clients/blocks/ServiceBlock";
import { useCurrentRole } from "@/features/settings/tenant";
import { humanDay } from "@/features/appointments/helpers";

export default function ClientDetailScreen() {
  const t = useThemeColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const roleQuery = useCurrentRole();
  const role = roleQuery.data;

  // «new» → черновик без запросов; иначе обычная карточка с сервера.
  const isDraft = id === "new";
  const clientQuery = useClient(isDraft ? "" : id);
  const {
    data: client,
    isLoading,
    isError: clientFailed,
    error: clientError,
    isRefetching: clientRetrying,
    refetch: retryClient,
  } = clientQuery;
  const updateClient = useUpdateClient(isDraft ? "" : id);
  const archiveClients = useArchiveClients();
  const restoreClient = useRestoreClient();
  const appointmentsQuery = useClientAppointments(isDraft ? "" : id);
  const {
    data: appointments = [],
    isError: appointmentsFailed,
    isRefetching: appointmentsRetrying,
    refetch: retryAppointments,
  } = appointmentsQuery;
  const tagsQuery = useClientTags();
  const {
    data: tags = [],
    isError: tagsFailed,
    isRefetching: tagsRetrying,
    refetch: retryTags,
  } = tagsQuery;
  // Web parity: VisitsBlock resolves service NAMES from the catalog.
  const servicesQuery = useServices();
  const {
    data: services = [],
    isError: servicesFailed,
    isRefetching: servicesRetrying,
    refetch: retryServices,
  } = servicesQuery;
  const [menuOpen, setMenuOpen] = useState(false);
  const {
    draft,
    updateDraft,
    duplicate,
    createError,
    e164,
    isDirty: isDraftDirty,
    canSave,
    isSaving,
    onPhoneChange: onDraftPhoneChange,
    onPickContacts,
    save: saveDraft,
  } = useClientDraft(isDraft);

  // Единый persist-путь для блоков: черновик — локально, карточка — PATCH.
  const update = async (patch: Partial<Client>): Promise<boolean> => {
    if (isDraft) {
      updateDraft(patch);
      return true;
    }
    try {
      await updateClient.mutateAsync(patch);
      return true;
    } catch {
      // useUpdateClient owns the actionable alert. Returning false lets an
      // inline editor keep the user's draft open instead of discarding it.
      return false;
    }
  };

  // Объект, который видят блоки (черновик или серверная строка).
  const c: Client | undefined = isDraft ? draft : client ?? undefined;

  // Shared selectors — memoized so unrelated state changes don't re-scan
  // every appointment. Hooks must run unconditionally, hence the guards
  // before the early returns below.
  const stats = useMemo(
    () => (c ? buildStats(c, appointments) : undefined),
    [c, appointments],
  );
  const serviceDue = useMemo(
    () => buildServiceDue(c ?? { locations: [] }),
    [c],
  );

  // The unit the NEXT-JOB hero already names — the «Обслуживание» spine
  // drops it so the same overdue/soon fact never appears twice (web
  // ClientCardPage parity: one home per fact).
  const heroUnitId = useMemo(() => {
    if (stats?.nextApt) return null;
    return serviceDue.overdue[0]?.unitId ?? serviceDue.soon[0]?.unitId ?? null;
  }, [serviceDue, stats]);

  if (roleQuery.isPending) {
    return (
      <Screen className="items-center justify-center">
        <ActivityIndicator accessibilityLabel="Проверяем доступ" />
      </Screen>
    );
  }

  if (roleQuery.isError || !role) {
    return (
      <Screen>
        <ClientDataNotice
          fullScreen
          title="Доступ не подтверждён"
          message="Не удалось проверить роль сотрудника. Повторите попытку."
          onRetry={() => void roleQuery.refetch()}
          retrying={roleQuery.isRefetching}
        />
      </Screen>
    );
  }

  if (!isDraft && isLoading) {
    return (
      <Screen className="items-center justify-center">
        <ActivityIndicator accessibilityLabel="Загрузка карточки клиента" />
      </Screen>
    );
  }

  if (!isDraft && clientFailed && !c) {
    return (
      <Screen>
        <ClientDataNotice
          fullScreen
          title="Не удалось загрузить клиента"
          message={
            (clientError as Error | null)?.message ||
            "Проверьте соединение и повторите попытку."
          }
          onRetry={() => void retryClient()}
          retrying={clientRetrying}
        />
      </Screen>
    );
  }

  if (!c) {
    return (
      <Screen className="items-center justify-center px-6">
        <Text className="mb-3 text-sm" style={{ color: t.sub }}>
          Клиент не найден
        </Text>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Назад к списку клиентов"
          className="min-h-11 justify-center rounded-xl px-4 py-2 active:opacity-80"
          style={{ backgroundColor: t.accent }}
        >
          <Text className="font-semibold" style={{ color: t.onAccent }}>
            ← К списку
          </Text>
        </Pressable>
      </Screen>
    );
  }

  if (role === "master") {
    return (
      <MasterClientOperationalView
        client={c}
        appointments={appointments}
        services={services}
        onBack={() => router.back()}
        onOpenAppointment={(appointment) =>
          router.push({
            pathname: "/(dashboard)",
            params: {
              appointmentId: appointment.id,
              date: appointment.date,
              ...(appointment.team_id
                ? { teamId: appointment.team_id }
                : {}),
            },
          })
        }
      />
    );
  }

  if (c.deleted_at) {
    return (
      <ArchivedClientView
        client={c}
        appointments={appointments}
        services={services}
        restoring={restoreClient.isPending}
        onBack={() => router.back()}
        onRestore={async () => {
          try {
            await restoreClient.mutateAsync(c);
          } catch (error) {
            Alert.alert(
              "Не удалось восстановить",
              (error as Error).message || "Проверьте соединение и повторите.",
            );
          }
        }}
      />
    );
  }

  const phoneDigits = c.phone?.replace(/\D/g, "") ?? "";

  const onMessage = () => {
    setMenuOpen(false);
    if (phoneDigits) Linking.openURL(`sms:${phoneDigits}`);
  };

  const onShare = async () => {
    setMenuOpen(false);
    const lines = [
      c.full_name || "Клиент",
      c.phone || "",
      c.locations?.find((l) => l.isPrimary)?.address ??
        c.locations?.[0]?.address ??
        "",
    ].filter(Boolean);
    try {
      await Share.share({ message: lines.join("\n") });
    } catch {
      // user dismissed the share sheet — no-op.
    }
  };

  const onToggleBlacklist = () => {
    setMenuOpen(false);
    update({ blacklisted: !c.blacklisted });
  };

  const onBack = () => {
    if (!isDraftDirty) {
      router.back();
      return;
    }
    Alert.alert(
      "Удалить черновик?",
      "Введённые данные клиента ещё не сохранены.",
      [
        { text: "Продолжить заполнение", style: "cancel" },
        { text: "Удалить черновик", style: "destructive", onPress: () => router.back() },
      ],
    );
  };

  const onArchive = () => {
    setMenuOpen(false);
    Alert.alert(
      "Архивировать клиента?",
      "Клиент исчезнет из рабочего списка, но заявки, инвойсы и финансовая история сохранятся. Его можно восстановить в настройках клиентов.",
      [
        { text: "Отмена", style: "cancel" },
        {
          text: "Архивировать",
          style: "destructive",
          onPress: () =>
            archiveClients.mutate([c.id], {
              onSuccess: (res) => {
                if (res.archived > 0) router.back();
              },
            }),
        },
      ],
    );
  };

  return (
    <>
      <Stack.Screen options={{ gestureEnabled: !isDraftDirty }} />
      <Screen edges={["top"]}>
      <ClientDetailChrome
        draft={isDraft}
        canSave={canSave}
        saving={isSaving}
        menuOpen={menuOpen}
        phoneAvailable={!!phoneDigits}
        blacklisted={c.blacklisted}
        onBack={onBack}
        onSave={() => void saveDraft()}
        onToggleMenu={() => setMenuOpen((open) => !open)}
        onCloseMenu={() => setMenuOpen(false)}
        onMessage={onMessage}
        onShare={() => void onShare()}
        onToggleBlacklist={onToggleBlacklist}
        onArchive={onArchive}
      />

      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
      >
        {!isDraft && clientFailed ? (
          <ClientDataNotice
            title="Показана сохранённая копия"
            message="Свежие изменения пока не удалось получить. Карточка остаётся доступной."
            onRetry={() => void retryClient()}
            retrying={clientRetrying}
          />
        ) : null}

        {tagsFailed || (!isDraft && (appointmentsFailed || servicesFailed)) ? (
          <ClientDataNotice
            title="Часть данных не загрузилась"
            message={
              isDraft
                ? "Каталог тегов пока недоступен. Остальные данные можно заполнить и сохранить."
                : "История визитов, финансы или справочники могут быть неполными."
            }
            onRetry={() => {
              if (isDraft) void retryTags();
              else void Promise.all([retryAppointments(), retryTags(), retryServices()]);
            }}
            retrying={
              tagsRetrying ||
              (!isDraft && (appointmentsRetrying || servicesRetrying))
            }
          />
        ) : null}

        {/* ОДНА карточка-идентичность на оба режима: в черновике те же
            поля пустые (телефон с автофокусом и ✓), «Из контактов» вместо
            бейджей, слот дедупа под номером. */}
        <ClientHeader
          client={c}
          stats={stats}
          update={update}
          draft={
            isDraft
              ? {
                  valid: e164 !== null,
                  onNameChange: (v) => updateDraft({ full_name: v }),
                  onPhoneChange: onDraftPhoneChange,
                  onPickContacts,
                  footer: (
                    <ClientDraftNotice
                      duplicate={duplicate}
                      error={createError}
                      onOpenDuplicate={(duplicateId) =>
                        router.replace(`/clients/${duplicateId}`)
                      }
                    />
                  ),
                }
              : undefined
          }
        />

        {/* Действия существующего клиента — hero, ряд и спайн ТО: всем нужен
            реальный id, поэтому в черновике их нет (createBlankClient пуст). */}
        {!isDraft ? (
          <>
            <ClientNextJob
              client={c}
              appointments={appointments}
              stats={stats}
              serviceDue={serviceDue}
            />
            <CardActions client={c} stats={stats} update={update} />
            <ServiceBlock
              client={c}
              stats={stats}
              serviceDue={serviceDue}
              excludeUnitId={heroUnitId}
            />
          </>
        ) : null}

        <ClientProfileBlocks
          client={c}
          draft={isDraft}
          appointments={appointments}
          services={services}
          tags={tags}
          stats={stats}
          update={update}
        />
      </ScrollView>
      </KeyboardAvoidingView>

    </Screen>
    </>
  );
}

function ArchivedClientView({
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
  const history = [...appointments].sort((a, b) =>
    `${b.date}T${b.time_start}`.localeCompare(`${a.date}T${a.time_start}`),
  );

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Архивный клиент" onBack={onBack} />
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <View className="items-center px-5 pb-5 pt-5">
          <View
            className="h-14 w-14 items-center justify-center rounded-[18px]"
            style={{ backgroundColor: t.fill }}
          >
            <Archive color={t.sub} size={26} />
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
            {archivedLabel ? `В архиве с ${archivedLabel}. ` : "В архиве. "}
            Карточка доступна только для чтения; история заявок и инвойсов сохранена.
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

        <SectionCard title={`История заявок · ${history.length}`}>
          {history.length === 0 ? (
            <Text className="px-4 py-4 text-sm" style={{ color: t.sub }}>
              Заявок нет
            </Text>
          ) : (
            history.slice(0, 20).map((appointment, index) => {
              const names = appointment.service_ids
                .map((serviceId) => serviceById.get(serviceId))
                .filter((name): name is string => !!name);
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
                      {names.join(" · ") || STATUS_LABELS[appointment.status] || "Заявка"}
                    </Text>
                  </View>
                </View>
              );
            })
          )}
        </SectionCard>

        <View className="px-4 pt-5">
          <Pressable
            onPress={() => void onRestore()}
            disabled={restoring}
            accessibilityRole="button"
            accessibilityLabel="Восстановить клиента"
            accessibilityState={{ disabled: restoring }}
            className="min-h-12 flex-row items-center justify-center gap-2 rounded-2xl active:opacity-70"
            style={{ backgroundColor: t.accent, opacity: restoring ? 0.6 : 1 }}
          >
            {restoring ? (
              <ActivityIndicator color={t.onAccent} />
            ) : (
              <RotateCcw color={t.onAccent} size={18} />
            )}
            <Text className="text-[15px] font-semibold" style={{ color: t.onAccent }}>
              {restoring ? "Восстанавливаем…" : "Восстановить клиента"}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </Screen>
  );
}

function MasterClientOperationalView({
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
  const assigned = [...appointments].sort((a, b) =>
    `${b.date}T${b.time_start}`.localeCompare(`${a.date}T${a.time_start}`),
  );

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Клиент" onBack={onBack} />
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <View className="px-4 pb-2 pt-3">
          <Text style={{ fontSize: 24, fontWeight: "700", color: t.ink }}>
            {client.full_name || "Клиент"}
          </Text>
          <Text style={{ marginTop: 4, fontSize: 13, lineHeight: 18, color: t.sub }}>
            Только рабочая информация по назначенным заявкам.
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

        <SectionCard title="Назначенные заявки">
          {assigned.length === 0 ? (
            <Text style={{ padding: 16, fontSize: 14, color: t.sub }}>
              Доступных заявок нет
            </Text>
          ) : (
            assigned.map((appointment, index) => {
              const names = appointment.service_ids
                .map((serviceId) => serviceById.get(serviceId))
                .filter((name): name is string => !!name);
              return (
                <View key={appointment.id}>
                  {index > 0 ? (
                    <View style={{ height: 1, backgroundColor: t.separator }} />
                  ) : null}
                  <Pressable
                    onPress={() => onOpenAppointment(appointment)}
                    accessibilityRole="button"
                    accessibilityLabel={`Открыть заявку ${humanDay(appointment.date)} ${appointment.time_start}`}
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

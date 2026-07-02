import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Check, ChevronLeft, Minus, Plus, Search, X } from "lucide-react-native";
import {
  appointmentTotal,
  globalDiscountAmount,
  totalDuration,
} from "@babun/shared/local/finance/appointment-calc";
import {
  createBlankAppointment,
  type Appointment,
  type AppointmentStatus,
  type Discount,
} from "@babun/shared/local/appointments";
import { formatEUR } from "@babun/shared/common/utils/money";
import { Button } from "@/components/ui/Button";
import { SectionCard } from "@/components/ui/SectionCard";
import { ICON } from "@/components/ui/tokens";
import { useToast } from "@/components/ui/Toast";
import { useThemeColors } from "@/theme/colors";
import { useClients, useCreateClient } from "@/features/clients/queries";
import { useServices, type Service } from "@/features/services/queries";
import { useMasters, useTeams } from "@/features/reference/queries";
import {
  useCreateAppointment,
  useDeleteAppointment,
  useUpdateAppointment,
} from "@/features/calendar/mutations";
import {
  addMinutesHM,
  buildServices,
  formatHM,
  formatYMD,
  parseHM,
  parseYMD,
  type ServiceOverride,
} from "./helpers";

const CANCEL_REASONS = [
  "Клиент перенёс",
  "Клиент отменил",
  "Погода",
  "Не дозвонились",
  "Нет доступа",
  "Дубль",
];

const STATUSES: { value: AppointmentStatus; label: string }[] = [
  { value: "scheduled", label: "Запланировано" },
  { value: "in_progress", label: "В работе" },
  { value: "completed", label: "Выполнено" },
  { value: "cancelled", label: "Отменено" },
];

export function AppointmentSheet({
  visible,
  onClose,
  appointment,
  defaults,
}: {
  visible: boolean;
  onClose: () => void;
  appointment?: Appointment | null;
  defaults?: {
    date?: string;
    time_start?: string;
    client_id?: string | null;
    team_id?: string | null;
  };
}) {
  const t = useThemeColors();
  const isEdit = !!appointment;
  const { data: clients = [] } = useClients();
  const createClient = useCreateClient();
  const { data: services = [] } = useServices();
  const { data: teams = [] } = useTeams();
  const { data: masters = [] } = useMasters();
  const createMut = useCreateAppointment();
  const updateMut = useUpdateAppointment();
  const deleteMut = useDeleteAppointment();
  const toast = useToast();

  const catalog = useMemo(
    () => new Map(services.map((s) => [s.id, s])),
    [services],
  );

  const [clientId, setClientId] = useState<string | null>(null);
  const [date, setDate] = useState("");
  const [timeStart, setTimeStart] = useState("10:00");
  const [timeEnd, setTimeEnd] = useState("11:00");
  const [durationTouched, setDurationTouched] = useState(false);
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [masterId, setMasterId] = useState<string | null>(null);
  const [total, setTotal] = useState("0");
  const [customTotal, setCustomTotal] = useState(false);
  const [status, setStatus] = useState<AppointmentStatus>("scheduled");
  const [comment, setComment] = useState("");
  const [locationId, setLocationId] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, ServiceOverride>>({});
  const [discountType, setDiscountType] = useState<"fixed" | "percent" | null>(null);
  const [discountValue, setDiscountValue] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [kind, setKind] = useState<"work" | "event">("work");
  const [eventColor, setEventColor] = useState<string | null>(null);

  const [clientPicker, setClientPicker] = useState(false);
  const [servicePicker, setServicePicker] = useState(false);

  // Hydrate on open.
  useEffect(() => {
    if (!visible) return;
    if (appointment) {
      setClientId(appointment.client_id);
      setDate(appointment.date);
      setTimeStart(appointment.time_start);
      setTimeEnd(appointment.time_end);
      setServiceIds(
        appointment.service_ids?.length
          ? appointment.service_ids
          : (appointment.services ?? []).map((s) => s.serviceId),
      );
      setTeamId(appointment.team_id);
      setMasterId(appointment.master_id ?? null);
      setTotal(String(appointment.total_amount ?? 0));
      setCustomTotal(!!appointment.custom_total);
      setStatus(appointment.status);
      setComment(appointment.comment ?? "");
      setLocationId(appointment.location_id ?? null);
      setOverrides(
        Object.fromEntries(
          (appointment.services ?? []).map((s) => [
            s.serviceId,
            { qty: s.quantity, price: s.pricePerUnit },
          ]),
        ),
      );
      setDiscountType(appointment.global_discount?.type ?? null);
      setDiscountValue(
        appointment.global_discount ? String(appointment.global_discount.value) : "",
      );
      setCancelReason(appointment.cancel_reason ?? "");
      setKind(appointment.kind === "work" ? "work" : "event");
      setEventColor(appointment.color_override ?? null);
      setDurationTouched(true);
    } else {
      const today = formatYMD(new Date());
      setClientId(defaults?.client_id ?? null);
      setDate(defaults?.date ?? today);
      setTimeStart(defaults?.time_start ?? "10:00");
      setTimeEnd(addMinutesHM(defaults?.time_start ?? "10:00", 60));
      setServiceIds([]);
      setTeamId(defaults?.team_id ?? null);
      setMasterId(null);
      setTotal("0");
      setCustomTotal(false);
      setStatus("scheduled");
      setComment("");
      setLocationId(null);
      setOverrides({});
      setDiscountType(null);
      setDiscountValue("");
      setCancelReason("");
      setKind("work");
      setEventColor(null);
      setDurationTouched(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, appointment?.id]);

  const globalDiscount = useMemo<Discount | null>(
    () =>
      discountType && Number(discountValue) > 0
        ? { type: discountType, value: Number(discountValue) }
        : null,
    [discountType, discountValue],
  );
  const selectedServices = useMemo(
    () => buildServices(serviceIds, catalog, overrides),
    [serviceIds, catalog, overrides],
  );
  const computedTotal = useMemo(
    () => appointmentTotal(selectedServices, globalDiscount),
    [selectedServices, globalDiscount],
  );
  const computedDuration = useMemo(
    () => totalDuration(selectedServices),
    [selectedServices],
  );

  // Auto-extend end time from service duration unless the operator set it.
  useEffect(() => {
    if (durationTouched) return;
    setTimeEnd(addMinutesHM(timeStart, computedDuration || 60));
  }, [timeStart, computedDuration, durationTouched]);

  // Keep total in sync with catalog unless the operator overrode it.
  useEffect(() => {
    if (!customTotal) setTotal(String(computedTotal));
  }, [computedTotal, customTotal]);

  const effectiveTotal = customTotal ? Number(total) || 0 : computedTotal;
  const client = clients.find((c) => c.id === clientId) ?? null;
  const canSave = !!date && !createMut.isPending && !updateMut.isPending;

  const buildPatch = (): Partial<Appointment> => {
    const cancel =
      status === "cancelled" ? cancelReason.trim() || null : null;
    if (kind === "event") {
      // Personal/team event (meeting, lunch, break) — no client/services/money.
      return {
        kind: "event",
        date,
        time_start: timeStart,
        time_end: timeEnd,
        team_id: teamId,
        master_id: masterId,
        status,
        comment: comment.trim(),
        color_override: eventColor,
        client_id: null,
        location_id: null,
        service_ids: [],
        services: [],
        total_amount: 0,
        custom_total: false,
        global_discount: null,
        discount_amount: 0,
        cancel_reason: cancel,
      };
    }
    return {
      kind: "work",
      client_id: clientId,
      date,
      time_start: timeStart,
      time_end: timeEnd,
      team_id: teamId,
      master_id: masterId,
      service_ids: serviceIds,
      services: selectedServices,
      total_amount: effectiveTotal,
      custom_total: customTotal,
      total_duration: computedDuration,
      comment: comment.trim(),
      status,
      location_id: locationId,
      color_override: eventColor,
      global_discount: globalDiscount,
      discount_amount: globalDiscountAmount(selectedServices, globalDiscount),
      cancel_reason: cancel,
    };
  };

  const save = async () => {
    try {
      if (isEdit && appointment) {
        await updateMut.mutateAsync({ id: appointment.id, patch: buildPatch() });
      } else {
        await createMut.mutateAsync(createBlankAppointment(buildPatch()));
      }
      toast(
        isEdit
          ? "Сохранено"
          : kind === "event"
            ? "Событие создано"
            : "Запись создана",
      );
      onClose();
    } catch (e) {
      Alert.alert("Ошибка", (e as Error).message);
    }
  };

  const remove = () => {
    if (!appointment) return;
    Alert.alert("Удалить запись?", "Действие необратимо.", [
      { text: "Отмена", style: "cancel" },
      {
        text: "Удалить",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteMut.mutateAsync(appointment.id);
            onClose();
          } catch (e) {
            Alert.alert("Ошибка", (e as Error).message);
          }
        },
      },
    ]);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end" style={{ backgroundColor: t.scrim }}>
        <Pressable className="flex-1" onPress={onClose} />
        <View className="h-[88%] overflow-hidden rounded-t-3xl" style={{ backgroundColor: t.canvas }}>
          {/* header */}
          <View className="flex-row items-center border-b px-2 py-2" style={{ borderColor: t.separator, backgroundColor: t.surface }}>
            <Pressable
              onPress={onClose}
              hitSlop={8}
              className="h-10 w-10 items-center justify-center rounded-full active:opacity-60"
            >
              <X color={t.body} size={ICON.md} />
            </Pressable>
            <Text className="flex-1 text-center text-base font-semibold" style={{ color: t.ink }}>
              {kind === "event"
                ? isEdit
                  ? "Событие"
                  : "Новое событие"
                : isEdit
                  ? "Запись"
                  : "Новая запись"}
            </Text>
            <View className="w-10" />
          </View>

          <ScrollView className="flex-1" keyboardShouldPersistTaps="handled">
            {/* kind toggle */}
            <View className="mx-3 mt-3 flex-row rounded-xl p-1" style={{ backgroundColor: t.dark ? "rgba(255,255,255,0.07)" : "#eef1f5" }}>
              {(["work", "event"] as const).map((k) => (
                <Pressable
                  key={k}
                  onPress={() => setKind(k)}
                  className="flex-1 items-center rounded-lg py-2"
                  style={kind === k ? { backgroundColor: t.surface } : undefined}
                >
                  <Text
                    className="text-sm font-semibold"
                    style={{ color: kind === k ? t.ink : t.sub }}
                  >
                    {k === "work" ? "Работа" : "Событие"}
                  </Text>
                </Pressable>
              ))}
            </View>

            {kind === "work" ? (
              <>
            {/* client */}
            <SectionCard title="Клиент">
              <Pressable
                onPress={() => setClientPicker(true)}
                className="flex-row items-center px-4 py-3 active:opacity-60"
              >
                <View className="flex-1">
                  {client ? (
                    <>
                      <Text className="text-base font-semibold" style={{ color: t.ink }}>
                        {client.full_name || "Без имени"}
                      </Text>
                      {client.phone ? (
                        <Text className="text-sm" style={{ color: t.sub }}>
                          {client.phone}
                        </Text>
                      ) : null}
                    </>
                  ) : (
                    <Text className="text-base" style={{ color: t.accent }}>Выбрать клиента</Text>
                  )}
                </View>
                {client ? (
                  <Text className="text-sm font-medium" style={{ color: t.accent }}>Изменить</Text>
                ) : null}
              </Pressable>
            </SectionCard>

            {/* object / location */}
            {client?.locations && client.locations.length > 0 ? (
              <SectionCard title="Объект">
                <ChipRow
                  items={client.locations.map((l) => ({
                    id: l.id,
                    label: l.label || "Объект",
                  }))}
                  selected={locationId}
                  onSelect={(id) => setLocationId(id === locationId ? null : id)}
                />
                {locationId ? (
                  <Text className="px-4 pb-3 text-sm" style={{ color: t.sub }}>
                    {client.locations.find((l) => l.id === locationId)?.address}
                  </Text>
                ) : null}
              </SectionCard>
            ) : null}

              </>
            ) : null}

            {/* date + time */}
            <SectionCard title="Когда">
              <View className="flex-row items-center justify-between px-4 py-2.5">
                <Text className="text-base" style={{ color: t.ink }}>Дата</Text>
                <DateTimePicker
                  value={date ? parseYMD(date) : new Date()}
                  mode="date"
                  display="compact"
                  onChange={(_, d) => d && setDate(formatYMD(d))}
                />
              </View>
              <View className="ml-4 h-px" style={{ backgroundColor: t.separator }} />
              <View className="flex-row items-center justify-between px-4 py-2.5">
                <Text className="text-base" style={{ color: t.ink }}>Время</Text>
                <View className="flex-row items-center">
                  <DateTimePicker
                    value={parseHM(timeStart)}
                    mode="time"
                    display="compact"
                    minuteInterval={5}
                    onChange={(_, d) => d && setTimeStart(formatHM(d))}
                  />
                  <Text className="px-1" style={{ color: t.faint }}>–</Text>
                  <DateTimePicker
                    value={parseHM(timeEnd)}
                    mode="time"
                    display="compact"
                    minuteInterval={5}
                    onChange={(_, d) => {
                      if (d) {
                        setTimeEnd(formatHM(d));
                        setDurationTouched(true);
                      }
                    }}
                  />
                </View>
              </View>
            </SectionCard>

            {kind === "work" ? (
              <>
            {/* services */}
            <SectionCard
              title="Услуги"
              action={{ label: "Изменить", onPress: () => setServicePicker(true) }}
            >
              {serviceIds.length === 0 ? (
                <Pressable
                  onPress={() => setServicePicker(true)}
                  className="px-4 py-3 active:opacity-60"
                >
                  <Text className="text-base" style={{ color: t.accent }}>Добавить услуги</Text>
                </Pressable>
              ) : (
                serviceIds.map((id) => {
                  const s = catalog.get(id);
                  const ov = overrides[id] ?? {};
                  const qty = ov.qty ?? 1;
                  const price = ov.price ?? (s ? Number(s.price) : 0);
                  const setOv = (p: ServiceOverride) =>
                    setOverrides((o) => ({ ...o, [id]: { ...o[id], ...p } }));
                  return (
                    <View
                      key={id}
                      className="flex-row items-center px-4 py-2.5"
                    >
                      <Text className="flex-1 pr-2 text-base tabular-nums" style={{ color: t.ink }} numberOfLines={1}>
                        {s?.name ?? "Услуга"}
                      </Text>
                      <Pressable
                        onPress={() => setOv({ qty: Math.max(1, qty - 1) })}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel="Уменьшить количество"
                        className="h-7 w-7 items-center justify-center rounded-full active:opacity-70"
                        style={{ backgroundColor: t.dark ? "rgba(255,255,255,0.07)" : "#eef1f5" }}
                      >
                        <Minus color={t.body} size={13} />
                      </Pressable>
                      <Text className="w-6 text-center text-sm tabular-nums" style={{ color: t.sub }}>
                        {qty}
                      </Text>
                      <Pressable
                        onPress={() => setOv({ qty: qty + 1 })}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel="Увеличить количество"
                        className="h-7 w-7 items-center justify-center rounded-full active:opacity-70"
                        style={{ backgroundColor: t.dark ? "rgba(255,255,255,0.07)" : "#eef1f5" }}
                      >
                        <Plus color={t.body} size={13} />
                      </Pressable>
                      <TextInput
                        value={String(price)}
                        onChangeText={(v) =>
                          setOv({ price: Number(v.replace(",", ".")) || 0 })
                        }
                        keyboardType="decimal-pad"
                        className="ml-2 w-14 text-right text-sm tabular-nums"
                        style={{ color: t.sub }}
                        placeholderTextColor={t.placeholder}
                        selectionColor={t.accent}
                        keyboardAppearance={t.dark ? "dark" : "light"}
                      />
                      <Text className="text-sm" style={{ color: t.faint }}>€</Text>
                    </View>
                  );
                })
              )}
            </SectionCard>

              </>
            ) : null}

            {/* team / master */}
            {teams.length > 0 ? (
              <SectionCard title="Команда">
                <ChipRow
                  items={teams.map((t) => ({ id: t.id, label: t.name }))}
                  selected={teamId}
                  onSelect={(id) => setTeamId(id === teamId ? null : id)}
                />
              </SectionCard>
            ) : null}
            {masters.length > 0 ? (
              <SectionCard title="Мастер">
                <ChipRow
                  items={masters.map((m) => ({ id: m.id, label: m.full_name }))}
                  selected={masterId}
                  onSelect={(id) => setMasterId(id === masterId ? null : id)}
                />
              </SectionCard>
            ) : null}

            {kind === "work" ? (
              <>
            {/* total */}
            <SectionCard title="Сумма">
              <View className="flex-row items-center px-4 py-2.5">
                <TextInput
                  value={customTotal ? total : String(computedTotal)}
                  onChangeText={(v) => {
                    setCustomTotal(true);
                    setTotal(v);
                  }}
                  keyboardType="decimal-pad"
                  className="flex-1 text-2xl font-bold"
                  style={{ color: t.ink }}
                  placeholder="0"
                  placeholderTextColor={t.placeholder}
                  selectionColor={t.accent}
                  keyboardAppearance={t.dark ? "dark" : "light"}
                />
                <Text className="text-2xl font-bold" style={{ color: t.faint }}>€</Text>
                {customTotal ? (
                  <Pressable
                    onPress={() => setCustomTotal(false)}
                    hitSlop={8}
                    className="ml-3"
                  >
                    <Text className="text-sm font-medium" style={{ color: t.accent }}>Авто</Text>
                  </Pressable>
                ) : null}
              </View>
            </SectionCard>

            {/* discount */}
            <SectionCard title="Скидка">
              <View className="flex-row items-center gap-2 p-3">
                {(
                  [
                    { v: null, label: "Нет" },
                    { v: "fixed", label: "€" },
                    { v: "percent", label: "%" },
                  ] as const
                ).map((opt) => {
                  const active = discountType === opt.v;
                  return (
                    <Pressable
                      key={opt.label}
                      onPress={() => setDiscountType(opt.v)}
                      className="rounded-full px-3.5 py-1.5"
                      style={{ backgroundColor: active ? t.accent : (t.dark ? "rgba(255,255,255,0.07)" : "#eef1f5") }}
                    >
                      <Text
                        className="text-sm font-medium"
                        style={{ color: active ? "#fff" : t.sub }}
                      >
                        {opt.label}
                      </Text>
                    </Pressable>
                  );
                })}
                {discountType ? (
                  <TextInput
                    value={discountValue}
                    onChangeText={setDiscountValue}
                    keyboardType="decimal-pad"
                    placeholder={discountType === "percent" ? "10" : "20"}
                    placeholderTextColor={t.placeholder}
                    selectionColor={t.accent}
                    keyboardAppearance={t.dark ? "dark" : "light"}
                    className="ml-2 flex-1 text-base"
                    style={{ color: t.ink }}
                  />
                ) : null}
              </View>
              {globalDiscount ? (
                <Text className="px-4 pb-3 text-sm font-medium" style={{ color: t.success }}>
                  −{formatEUR(globalDiscountAmount(selectedServices, globalDiscount))}
                </Text>
              ) : null}
            </SectionCard>

              </>
            ) : null}

            {/* event color (event only) */}
            {kind === "event" ? (
              <SectionCard title="Цвет">
                <View className="flex-row flex-wrap gap-3 p-3">
                  {(
                    [
                      ["#4338ca", "Индиго"],
                      ["#10b981", "Зелёный"],
                      ["#ef4444", "Красный"],
                      ["#f59e0b", "Оранжевый"],
                      ["#06b6d4", "Голубой"],
                      ["#a855f7", "Фиолетовый"],
                      ["#ec4899", "Розовый"],
                      ["#737373", "Серый"],
                    ] as const
                  ).map(([c, name]) => (
                    <Pressable
                      key={c}
                      onPress={() => setEventColor(c)}
                      accessibilityRole="button"
                      accessibilityLabel={name}
                      accessibilityState={{ selected: eventColor === c }}
                      className="h-9 w-9 rounded-full"
                      style={[
                        { backgroundColor: c },
                        eventColor === c ? { borderWidth: 2, borderColor: t.ink } : null,
                      ]}
                    />
                  ))}
                </View>
              </SectionCard>
            ) : null}

            {/* status */}
            <SectionCard title="Статус">
              <View className="flex-row flex-wrap gap-2 p-3">
                {STATUSES.map((s) => {
                  const active = status === s.value;
                  return (
                    <Pressable
                      key={s.value}
                      onPress={() => setStatus(s.value)}
                      className="rounded-full px-3 py-1.5"
                      style={{ backgroundColor: active ? t.accent : (t.dark ? "rgba(255,255,255,0.07)" : "#eef1f5") }}
                    >
                      <Text
                        className="text-sm font-medium"
                        style={{ color: active ? "#fff" : t.sub }}
                      >
                        {s.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </SectionCard>

            {/* cancel reason */}
            {status === "cancelled" ? (
              <SectionCard title="Причина отмены">
                <View className="flex-row flex-wrap gap-2 p-3">
                  {CANCEL_REASONS.map((r) => {
                    const active = cancelReason === r;
                    return (
                      <Pressable
                        key={r}
                        onPress={() => setCancelReason(active ? "" : r)}
                        className="rounded-full px-3 py-1.5"
                        style={{ backgroundColor: active ? t.danger : (t.dark ? "rgba(255,255,255,0.07)" : "#eef1f5") }}
                      >
                        <Text
                          className="text-sm font-medium"
                          style={{ color: active ? "#fff" : t.sub }}
                        >
                          {r}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                <TextInput
                  value={cancelReason}
                  onChangeText={setCancelReason}
                  placeholder="Своя причина…"
                  placeholderTextColor={t.placeholder}
                  selectionColor={t.accent}
                  keyboardAppearance={t.dark ? "dark" : "light"}
                  className="px-4 pb-3 text-base"
                  style={{ color: t.ink }}
                />
              </SectionCard>
            ) : null}

            {/* comment / event title */}
            <SectionCard title={kind === "event" ? "Название" : "Комментарий"}>
              <TextInput
                value={comment}
                onChangeText={setComment}
                multiline
                placeholder={kind === "event" ? "Обед, встреча, перерыв…" : "Заметка для бригады…"}
                placeholderTextColor={t.placeholder}
                selectionColor={t.accent}
                keyboardAppearance={t.dark ? "dark" : "light"}
                className="min-h-[64px] px-4 py-3 text-base"
                style={{ color: t.ink }}
                textAlignVertical="top"
              />
            </SectionCard>

            {isEdit ? (
              <Pressable onPress={remove} className="items-center py-5 active:opacity-70">
                <Text className="text-base font-medium" style={{ color: t.danger }}>
                  Удалить запись
                </Text>
              </Pressable>
            ) : (
              <View className="h-6" />
            )}
          </ScrollView>

          {/* sticky footer */}
          <View className="border-t px-4 pb-7 pt-3" style={{ borderColor: t.separator, backgroundColor: t.surface }}>
            <Button
              label={
                kind === "event"
                  ? isEdit
                    ? "Сохранить"
                    : "Создать событие"
                  : isEdit
                    ? `Сохранить · ${formatEUR(effectiveTotal)}`
                    : `Создать · ${formatEUR(effectiveTotal)}`
              }
              onPress={save}
              disabled={!canSave}
              loading={createMut.isPending || updateMut.isPending}
            />
          </View>
        </View>
      </View>

      {/* client picker */}
      <ClientPickerModal
        visible={clientPicker}
        onClose={() => setClientPicker(false)}
        clients={clients}
        selectedId={clientId}
        onPick={(id) => {
          setClientId(id);
          setClientPicker(false);
        }}
        onCreate={async (name, phone) => {
          const created = await createClient.mutateAsync({
            full_name: name,
            phone,
          });
          return created.id;
        }}
      />

      {/* service picker (multi) */}
      <PickerModal
        visible={servicePicker}
        onClose={() => setServicePicker(false)}
        title="Услуги"
        multi
        items={services.map((s) => ({
          id: s.id,
          title: s.name,
          subtitle: `${formatEUR(Number(s.price))} · ${s.duration_minutes} мин`,
        }))}
        selectedIds={serviceIds}
        onToggle={(id) =>
          setServiceIds((prev) =>
            prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
          )
        }
      />
    </Modal>
  );
}

function ChipRow({
  items,
  selected,
  onSelect,
}: {
  items: { id: string; label: string }[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const t = useThemeColors();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 10, gap: 8 }}
    >
      {items.map((it) => {
        const active = selected === it.id;
        return (
          <Pressable
            key={it.id}
            onPress={() => onSelect(it.id)}
            className="rounded-full px-3.5 py-1.5"
            style={{ backgroundColor: active ? t.accent : (t.dark ? "rgba(255,255,255,0.07)" : "#eef1f5") }}
          >
            <Text
              className="text-sm font-medium"
              style={{ color: active ? "#fff" : t.sub }}
            >
              {it.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

type PickerItem = { id: string; title: string; subtitle?: string };

function PickerModal({
  visible,
  onClose,
  title,
  items,
  selectedIds,
  multi,
  onPick,
  onToggle,
  createLabel,
  onCreateNew,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  items: PickerItem[];
  selectedIds: string[];
  multi?: boolean;
  onPick?: (id: string) => void;
  onToggle?: (id: string) => void;
  createLabel?: string;
  onCreateNew?: (query: string) => void;
}) {
  const th = useThemeColors();
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return items;
    return items.filter(
      (i) =>
        i.title.toLowerCase().includes(t) ||
        (i.subtitle ?? "").toLowerCase().includes(t),
    );
  }, [q, items]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end" style={{ backgroundColor: th.scrim }}>
        <Pressable className="flex-1" onPress={onClose} />
        <View className="h-[80%] overflow-hidden rounded-t-3xl" style={{ backgroundColor: th.surface }}>
          <View className="flex-row items-center border-b px-2 py-2" style={{ borderColor: th.separator }}>
            <Text className="flex-1 px-2 text-base font-semibold" style={{ color: th.ink }}>
              {title}
            </Text>
            <Pressable
              onPress={onClose}
              hitSlop={8}
              className={`h-10 items-center justify-center rounded-full active:opacity-60 ${multi ? "px-3" : "w-10"}`}
            >
              {multi ? (
                <Text className="text-sm font-semibold" style={{ color: th.accent }}>Готово</Text>
              ) : (
                <X color={th.body} size={ICON.md} />
              )}
            </Pressable>
          </View>
          <View className="flex-row items-center gap-2 px-4 py-2">
            <Search color={th.faint} size={ICON.sm} />
            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder="Поиск…"
              placeholderTextColor={th.placeholder}
              selectionColor={th.accent}
              keyboardAppearance={th.dark ? "dark" : "light"}
              className="flex-1 py-1 text-base"
              style={{ color: th.ink }}
            />
          </View>
          <FlatList
            style={{ flex: 1 }}
            data={filtered}
            keyExtractor={(i) => i.id}
            keyboardShouldPersistTaps="handled"
            ListHeaderComponent={
              onCreateNew ? (
                <Pressable
                  onPress={() => onCreateNew(q.trim())}
                  className="flex-row items-center gap-2 border-b px-4 py-3 active:opacity-60"
                  style={{ borderColor: th.separator }}
                >
                  <Plus color={th.accent} size={ICON.md} />
                  <Text className="text-base font-semibold" style={{ color: th.accent }}>
                    {createLabel ?? "Создать"}
                    {q.trim() ? ` «${q.trim()}»` : ""}
                  </Text>
                </Pressable>
              ) : null
            }
            renderItem={({ item }) => {
              const sel = selectedIds.includes(item.id);
              return (
                <Pressable
                  onPress={() => (multi ? onToggle?.(item.id) : onPick?.(item.id))}
                  className="flex-row items-center px-4 py-3 active:opacity-60"
                >
                  <View className="flex-1 pr-2">
                    <Text className="text-base" style={{ color: th.ink }} numberOfLines={1}>
                      {item.title}
                    </Text>
                    {item.subtitle ? (
                      <Text className="text-sm" style={{ color: th.sub }} numberOfLines={1}>
                        {item.subtitle}
                      </Text>
                    ) : null}
                  </View>
                  {sel ? <Check color={th.accent} size={ICON.md} /> : null}
                </Pressable>
              );
            }}
            ItemSeparatorComponent={() => (
              <View className="ml-4 h-px" style={{ backgroundColor: th.separator }} />
            )}
          />
        </View>
      </View>
    </Modal>
  );
}

// Calendar client picker with inline «Новый клиент» create — one Modal that
// switches between the list and the create form (web parity; avoids the iOS
// «can't present a modal while another dismisses» race of stacked modals).
function ClientPickerModal({
  visible,
  onClose,
  clients,
  selectedId,
  onPick,
  onCreate,
}: {
  visible: boolean;
  onClose: () => void;
  clients: { id: string; full_name: string | null; phone: string | null }[];
  selectedId: string | null;
  onPick: (id: string) => void;
  onCreate: (name: string, phone: string) => Promise<string>;
}) {
  const t = useThemeColors();
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<"list" | "create">("list");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible) {
      setMode("list");
      setQ("");
      setName("");
      setPhone("");
    }
  }, [visible]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return clients;
    return clients.filter(
      (c) =>
        (c.full_name ?? "").toLowerCase().includes(s) ||
        (c.phone ?? "").toLowerCase().includes(s),
    );
  }, [q, clients]);

  const startCreate = () => {
    const query = q.trim();
    const isPhone = /^[+\d][\d\s()-]*$/.test(query);
    setName(isPhone ? "" : query);
    setPhone(isPhone ? query : "");
    setMode("create");
  };

  const submit = async () => {
    if (!name.trim() && !phone.trim()) return;
    setBusy(true);
    try {
      const id = await onCreate(name.trim(), phone.trim());
      onPick(id);
    } catch (e) {
      Alert.alert("Не удалось создать клиента", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end" style={{ backgroundColor: t.scrim }}>
        <Pressable className="flex-1" onPress={onClose} />
        <View className="h-[80%] overflow-hidden rounded-t-3xl" style={{ backgroundColor: t.surface }}>
          <View className="flex-row items-center border-b px-2 py-2" style={{ borderColor: t.separator }}>
            {mode === "create" ? (
              <Pressable
                onPress={() => setMode("list")}
                hitSlop={8}
                className="h-10 w-10 items-center justify-center rounded-full active:opacity-60"
              >
                <ChevronLeft color={t.body} size={ICON.md} />
              </Pressable>
            ) : null}
            <Text className="flex-1 px-2 text-base font-semibold" style={{ color: t.ink }}>
              {mode === "create" ? "Новый клиент" : "Клиент"}
            </Text>
            <Pressable
              onPress={onClose}
              hitSlop={8}
              className="h-10 w-10 items-center justify-center rounded-full active:opacity-60"
            >
              <X color={t.body} size={ICON.md} />
            </Pressable>
          </View>

          {mode === "list" ? (
            <>
              <View className="flex-row items-center gap-2 px-4 py-2">
                <Search color={t.faint} size={ICON.sm} />
                <TextInput
                  value={q}
                  onChangeText={setQ}
                  placeholder="Поиск…"
                  placeholderTextColor={t.placeholder}
                  selectionColor={t.accent}
                  keyboardAppearance={t.dark ? "dark" : "light"}
                  className="flex-1 py-1 text-base"
                  style={{ color: t.ink }}
                />
              </View>
              <FlatList
                style={{ flex: 1 }}
                data={filtered}
                keyExtractor={(i) => i.id}
                keyboardShouldPersistTaps="handled"
                ListHeaderComponent={
                  <Pressable
                    onPress={startCreate}
                    className="flex-row items-center gap-2 border-b px-4 py-3 active:opacity-60"
                    style={{ borderColor: t.separator }}
                  >
                    <Plus color={t.accent} size={ICON.md} />
                    <Text className="text-base font-semibold" style={{ color: t.accent }}>
                      Новый клиент{q.trim() ? ` «${q.trim()}»` : ""}
                    </Text>
                  </Pressable>
                }
                renderItem={({ item }) => {
                  const sel = item.id === selectedId;
                  return (
                    <Pressable
                      onPress={() => onPick(item.id)}
                      className="flex-row items-center px-4 py-3 active:opacity-60"
                    >
                      <View className="flex-1 pr-2">
                        <Text className="text-base" style={{ color: t.ink }} numberOfLines={1}>
                          {item.full_name || "Без имени"}
                        </Text>
                        {item.phone ? (
                          <Text className="text-sm" style={{ color: t.sub }} numberOfLines={1}>
                            {item.phone}
                          </Text>
                        ) : null}
                      </View>
                      {sel ? <Check color={t.accent} size={ICON.md} /> : null}
                    </Pressable>
                  );
                }}
                ItemSeparatorComponent={() => (
                  <View className="ml-4 h-px" style={{ backgroundColor: t.separator }} />
                )}
              />
            </>
          ) : (
            <View className="px-5 pt-4">
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Имя клиента"
                placeholderTextColor={t.placeholder}
                selectionColor={t.accent}
                keyboardAppearance={t.dark ? "dark" : "light"}
                autoFocus
                className="mb-2 rounded-[14px] border px-4 py-3 text-base"
                style={{ borderColor: t.separator, color: t.ink }}
              />
              <TextInput
                value={phone}
                onChangeText={setPhone}
                placeholder="+357 99 ..."
                placeholderTextColor={t.placeholder}
                selectionColor={t.accent}
                keyboardType="phone-pad"
                keyboardAppearance={t.dark ? "dark" : "light"}
                className="mb-4 rounded-[14px] border px-4 py-3 text-base"
                style={{ borderColor: t.separator, color: t.ink }}
              />
              <Button
                label="Добавить"
                onPress={submit}
                disabled={(!name.trim() && !phone.trim()) || busy}
                loading={busy}
              />
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

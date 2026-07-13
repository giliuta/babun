// ObjectsBlock — equipment-first objects for the client card (LOCKED
// client-app.html mockup, .obj cards; data semantics from the web
// ObjectsBlock + LocationEditor).
//
// An object is «адрес + кондиционеры»: every location renders its address
// (tap → Maps), the at-the-door note and the list of A/C units with their
// service dates («посл. ТО 14 апр · ТО раз в 12 мес»). Units are editable
// right here — tap a unit to open the inline editor (комната / бренд /
// модель / тип / даты ТО / интервал), «+ Кондиционер» adds one. The object
// footer carries «N визитов · посл. дата» and a pre-aimed «Записать сюда»
// (client + object + last team). Inline add/remove of whole objects stays
// from the previous version (promotes a new primary when needed).
//
// Presentational: receives props, persists via `update(patch)` — it does
// NOT fetch.

import { useMemo, useState } from "react";
import { Linking, Pressable, Text, TextInput, View } from "react-native";
import {
  ArrowUpRight,
  ChevronRight,
  KeyRound,
  MapPin,
  Plus,
  Trash2,
} from "lucide-react-native";
import type { ACType, ACUnit, Client, Location } from "@babun/shared/local/clients";
import { AC_TYPE_LABELS } from "@babun/shared/local/clients";
import type { Appointment } from "@babun/shared/local/appointments";
import type { ClientStats } from "@babun/shared/local/selectors/client-stats";
import { buildMapUrl } from "@babun/shared/common/utils/map-links";
import { useBookingNav } from "@/features/clients/card-booking";
import {
  normalizeYMD,
  OptionalDateField,
} from "@/features/clients/OptionalDateField";
import { formatShortDateRu, visitsWord } from "@/features/clients/format";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { useThemeColors } from "@/theme/colors";

interface ObjectsBlockProps {
  client: Client;
  appointments: Appointment[];
  /** lastTeamId feeds the pre-aimed «Записать сюда» booking link. */
  stats?: ClientStats;
  update: (patch: Partial<Client>) => void;
}

const AC_TYPE_ORDER: ACType[] = ["split", "ducted", "cassette"];

function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export default function ObjectsBlock({
  client,
  appointments,
  stats,
  update,
}: ObjectsBlockProps) {
  const t = useThemeColors();
  const all = client.locations ?? [];
  const book = useBookingNav();

  // Pre-compute per-location visit counts so each object footer can show
  // «N визитов · last date» without re-scanning.
  const historyByLocation = useMemo(() => {
    const map = new Map<string, { count: number; lastDate: string }>();
    for (const a of appointments) {
      if (!a.location_id) continue;
      const cur = map.get(a.location_id) ?? { count: 0, lastDate: "" };
      cur.count += 1;
      if (a.date > cur.lastDate) cur.lastDate = a.date;
      map.set(a.location_id, cur);
    }
    return map;
  }, [appointments]);

  // Inline add form draft. null = not adding.
  const [draft, setDraft] = useState<{
    label: string;
    address: string;
    note: string;
  } | null>(null);

  const saveDraft = () => {
    if (!draft || !draft.address.trim()) return;
    const newLoc: Location = {
      id: genId("loc"),
      label: draft.label.trim() || "Объект",
      address: draft.address.trim(),
      isPrimary: all.length === 0,
      note: draft.note.trim() || undefined,
      equipment: [],
    };
    update({ locations: [...all, newLoc] });
    setDraft(null);
  };

  const removeLoc = (id: string) => {
    const next = all.filter((l) => l.id !== id);
    // Promote a new primary if we removed the previous one.
    const stillHasPrimary = next.some((l) => l.isPrimary);
    const reseated =
      !stillHasPrimary && next.length > 0
        ? next.map((l, i) => ({ ...l, isPrimary: i === 0 }))
        : next;
    update({ locations: reseated });
  };

  const patchLocation = (id: string, patch: Partial<Location>) =>
    update({
      locations: all.map((l) => (l.id === id ? { ...l, ...patch } : l)),
    });

  return (
    <Card style={{ marginHorizontal: 12, marginTop: 8, padding: 12 }}>
      <Text className="px-1 pb-1 pt-1 text-xs font-semibold uppercase tracking-wider" style={{ color: t.sub }}>
        Объекты{all.length ? ` · ${all.length}` : ""}
      </Text>

      {all.length === 0 && !draft ? (
        <Text className="px-1 py-2 text-[13px]" style={{ color: t.faint }}>
          Объектов пока нет — добавь дом или офис, чтобы привязать
          кондиционеры и адрес.
        </Text>
      ) : null}

      <View className="gap-2">
        {all.map((loc) => (
          <ObjectCard
            key={loc.id}
            loc={loc}
            history={historyByLocation.get(loc.id)}
            onRemove={() => removeLoc(loc.id)}
            onPatch={(patch) => patchLocation(loc.id, patch)}
            onBookHere={() =>
              book({
                clientId: client.id,
                locationId: loc.id,
                teamId: stats?.lastTeamId ?? null,
              })
            }
          />
        ))}
      </View>

      {draft ? (
        <View className="mt-2 gap-2 rounded-xl p-3" style={{ backgroundColor: t.fill }}>
          <TextInput
            value={draft.label}
            onChangeText={(v) => setDraft({ ...draft, label: v })}
            placeholder="Метка (Дом / Офис)"
            placeholderTextColor={t.placeholder}
            selectionColor={t.accent}
            keyboardAppearance={t.dark ? "dark" : "light"}
            className="rounded-lg px-3 py-2 text-sm"
            style={{ backgroundColor: t.surface, color: t.ink }}
          />
          <TextInput
            value={draft.address}
            onChangeText={(v) => setDraft({ ...draft, address: v })}
            placeholder="Адрес или ссылка на карту"
            placeholderTextColor={t.placeholder}
            selectionColor={t.accent}
            keyboardAppearance={t.dark ? "dark" : "light"}
            className="rounded-lg px-3 py-2 text-sm"
            style={{ backgroundColor: t.surface, color: t.ink }}
          />
          <TextInput
            value={draft.note}
            onChangeText={(v) => setDraft({ ...draft, note: v })}
            placeholder="Заметка (зелёная дверь, домофон 25)"
            placeholderTextColor={t.placeholder}
            selectionColor={t.accent}
            keyboardAppearance={t.dark ? "dark" : "light"}
            className="rounded-lg px-3 py-2 text-sm"
            style={{ backgroundColor: t.surface, color: t.ink }}
          />
          <View className="flex-row gap-2">
            <Pressable
              onPress={saveDraft}
              disabled={!draft.address.trim()}
              className="flex-1 items-center rounded-lg py-2"
              style={{ backgroundColor: draft.address.trim() ? t.accent : t.fill }}
            >
              {/* Conditional label color (as in NotesBlock) — plain white
                  is invisible on the light disabled fill. */}
              <Text
                className="text-sm font-semibold"
                style={{ color: draft.address.trim() ? "#fff" : t.faint }}
              >
                Сохранить
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setDraft(null)}
              className="items-center rounded-lg px-4 py-2 active:opacity-70"
              style={{ backgroundColor: t.fill }}
            >
              <Text className="text-sm font-semibold" style={{ color: t.sub }}>
                Отмена
              </Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable
          onPress={() => setDraft({ label: "", address: "", note: "" })}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel="Добавить объект"
          className="mt-2 flex-row items-center gap-1.5 self-start px-1 py-1 active:opacity-60"
        >
          <Plus color={t.accent} size={14} />
          <Text className="text-[13px] font-semibold" style={{ color: t.accent }}>
            {all.length > 0 ? "Добавить объект" : "Добавить первый объект"}
          </Text>
        </Pressable>
      )}
    </Card>
  );
}

// ─── One object: адрес + заметка + кондиционеры + футер ───────────────

function ObjectCard({
  loc,
  history,
  onRemove,
  onPatch,
  onBookHere,
}: {
  loc: Location;
  history?: { count: number; lastDate: string };
  onRemove: () => void;
  onPatch: (patch: Partial<Location>) => void;
  onBookHere: () => void;
}) {
  const t = useThemeColors();
  const units = loc.equipment ?? [];
  // Unit currently being edited: existing unit id, "new" for the add
  // draft, or null (nothing open).
  const [editing, setEditing] = useState<string | null>(null);

  const openMaps = () => {
    // Apple Maps on iOS; the shared builder returns a universal URL
    // that Linking can hand off to the installed maps app.
    const url = buildMapUrl("apple", loc.mapUrl || loc.address);
    if (url) Linking.openURL(url);
  };

  const saveUnit = (unit: ACUnit) => {
    const exists = units.some((u) => u.id === unit.id);
    onPatch({
      equipment: exists
        ? units.map((u) => (u.id === unit.id ? unit : u))
        : [...units, unit],
    });
    setEditing(null);
  };

  const removeUnit = (id: string) => {
    onPatch({ equipment: units.filter((u) => u.id !== id) });
    setEditing(null);
  };

  return (
    <View className="rounded-xl p-3" style={{ backgroundColor: t.fill }}>
      {/* Header: label + основной + удалить */}
      <View className="flex-row items-center gap-1.5">
        <Text
          className="flex-1 text-[15px] font-semibold"
          style={{ color: t.ink }}
          numberOfLines={1}
        >
          {loc.label || "Объект"}
          {loc.isPrimary ? (
            <Text className="text-[10px] font-bold uppercase tracking-wider" style={{ color: t.accent }}>
              {"  основной"}
            </Text>
          ) : null}
        </Text>
        <Pressable
          onPress={onRemove}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Удалить объект"
          className="h-8 w-8 items-center justify-center rounded-lg active:opacity-60"
        >
          <Trash2 color={t.danger} size={14} />
        </Pressable>
      </View>

      {/* Address (tap → Maps) */}
      <Pressable
        onPress={loc.address || loc.mapUrl ? openMaps : undefined}
        accessibilityRole="button"
        accessibilityLabel="Открыть адрес в Картах"
        className="mt-0.5 flex-row items-center gap-1 active:opacity-60"
      >
        <MapPin color={t.faint} size={11} />
        <Text className="flex-1 text-[13px]" style={{ color: t.sub }} numberOfLines={1}>
          {loc.address || "адрес не указан"}
        </Text>
        {loc.address || loc.mapUrl ? (
          <ArrowUpRight color={t.accent} size={14} />
        ) : null}
      </Pressable>

      {/* At-the-door note («зелёная дверь, домофон 25») */}
      {loc.note ? (
        <View className="mt-1 flex-row items-center gap-1.5">
          <KeyRound color={t.warning} size={11} />
          <Text className="flex-1 text-[12px]" style={{ color: t.warning }} numberOfLines={1}>
            {loc.note}
          </Text>
        </View>
      ) : null}

      {/* Кондиционеры (equipment-first) */}
      <View className="mt-2 gap-0.5">
        {units.length === 0 && editing !== "new" ? (
          <Text className="text-[12px] italic" style={{ color: t.faint }}>
            Кондиционеров пока нет.
          </Text>
        ) : null}
        {units.map((u) =>
          editing === u.id ? (
            <UnitEditor
              key={u.id}
              unit={u}
              onSave={saveUnit}
              onRemove={() => removeUnit(u.id)}
              onCancel={() => setEditing(null)}
            />
          ) : (
            <UnitRow key={u.id} unit={u} onPress={() => setEditing(u.id)} />
          ),
        )}
        {editing === "new" ? (
          <UnitEditor
            unit={null}
            onSave={saveUnit}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <Pressable
            onPress={() => setEditing("new")}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel="Добавить кондиционер"
            className="mt-1 flex-row items-center gap-1.5 self-start py-1 active:opacity-60"
          >
            <Plus color={t.accent} size={13} />
            <Text className="text-[12px] font-semibold" style={{ color: t.accent }}>
              Кондиционер
            </Text>
          </Pressable>
        )}
      </View>

      {/* Footer: история + «Записать сюда» */}
      <View
        className="mt-2 flex-row items-center justify-between border-t pt-2"
        style={{ borderColor: t.separator }}
      >
        <Text className="text-[12px]" style={{ color: t.sub }}>
          {history && history.count > 0
            ? `${history.count} ${visitsWord(history.count)}${history.lastDate ? ` · посл. ${formatShortDateRu(history.lastDate)}` : ""}`
            : "визитов не было"}
        </Text>
        <Pressable
          onPress={onBookHere}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={`Записать на объект ${loc.label || ""}`}
          className="flex-row items-center gap-0.5 active:opacity-60"
        >
          <Text className="text-[13px] font-semibold" style={{ color: t.accent }}>
            Записать сюда
          </Text>
          <ChevronRight color={t.accent} size={14} strokeWidth={2.2} />
        </Pressable>
      </View>
    </View>
  );
}

// ─── Unit row (view) ───────────────────────────────────────────────────

function UnitRow({ unit, onPress }: { unit: ACUnit; onPress: () => void }) {
  const t = useThemeColors();

  const title = [unit.room || "Комната", [unit.brand, unit.model].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(" · ");
  const sub = [
    AC_TYPE_LABELS[unit.ac_type] ?? null,
    unit.last_service_at
      ? `посл. ТО ${formatShortDateRu(unit.last_service_at) || unit.last_service_at}`
      : unit.installed_at
        ? `установлен ${unit.installed_at.slice(0, 4)}`
        : null,
    unit.service_interval_months
      ? `ТО раз в ${unit.service_interval_months} мес`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Кондиционер: ${title}. Нажмите, чтобы изменить`}
      className="min-h-[44px] justify-center py-1 active:opacity-60"
    >
      <Text className="text-[13px]" style={{ color: t.ink }} numberOfLines={1}>
        {title}
      </Text>
      {sub ? (
        <Text className="mt-0.5 text-[11px]" style={{ color: t.sub }} numberOfLines={1}>
          {sub}
        </Text>
      ) : null}
    </Pressable>
  );
}

// ─── Unit editor (inline add / edit) ───────────────────────────────────

function UnitEditor({
  unit,
  onSave,
  onRemove,
  onCancel,
}: {
  /** null → creating a new unit. */
  unit: ACUnit | null;
  onSave: (unit: ACUnit) => void;
  onRemove?: () => void;
  onCancel: () => void;
}) {
  const t = useThemeColors();
  const [room, setRoom] = useState(unit?.room ?? "");
  const [brand, setBrand] = useState(unit?.brand ?? "");
  const [model, setModel] = useState(unit?.model ?? "");
  const [acType, setAcType] = useState<ACType>(unit?.ac_type ?? "split");
  // Даты — через DateTimePicker (паттерн NewReminderSheet в recurring):
  // свободный текст кормил serviceDueState мусором. Легаси-значения не в
  // формате YYYY-MM-DD нормализуются в «не указано».
  const [installedAt, setInstalledAt] = useState(normalizeYMD(unit?.installed_at));
  const [lastServiceAt, setLastServiceAt] = useState(
    normalizeYMD(unit?.last_service_at),
  );
  const [intervalMonths, setIntervalMonths] = useState(
    unit?.service_interval_months ? String(unit.service_interval_months) : "",
  );

  const canSave = room.trim().length > 0;

  const save = () => {
    if (!canSave) return;
    const interval = parseInt(intervalMonths, 10);
    onSave({
      id: unit?.id ?? genId("ac"),
      room: room.trim(),
      brand: brand.trim() || undefined,
      model: model.trim() || undefined,
      ac_type: acType,
      has_indoor: unit?.has_indoor ?? true,
      has_outdoor: unit?.has_outdoor ?? true,
      installed_at: installedAt || undefined,
      last_service_at: lastServiceAt || undefined,
      service_interval_months:
        Number.isFinite(interval) && interval > 0 ? interval : undefined,
    });
  };

  const inputStyle = { backgroundColor: t.surface, color: t.ink } as const;

  return (
    <View className="my-1 gap-2 rounded-lg p-2.5" style={{ backgroundColor: t.dark ? "rgba(255,255,255,0.05)" : "#ffffff" }}>
      <TextInput
        value={room}
        onChangeText={setRoom}
        placeholder="Комната (Спальня / Гостиная)"
        placeholderTextColor={t.placeholder}
        selectionColor={t.accent}
        keyboardAppearance={t.dark ? "dark" : "light"}
        className="rounded-lg px-2.5 py-2 text-[13px]"
        style={[inputStyle, { backgroundColor: t.fill }]}
        maxLength={40}
      />
      <View className="flex-row gap-2">
        <TextInput
          value={brand}
          onChangeText={setBrand}
          placeholder="Бренд"
          placeholderTextColor={t.placeholder}
          selectionColor={t.accent}
          keyboardAppearance={t.dark ? "dark" : "light"}
          className="flex-1 rounded-lg px-2.5 py-2 text-[13px]"
          style={[inputStyle, { backgroundColor: t.fill }]}
          maxLength={40}
        />
        <TextInput
          value={model}
          onChangeText={setModel}
          placeholder="Модель"
          placeholderTextColor={t.placeholder}
          selectionColor={t.accent}
          keyboardAppearance={t.dark ? "dark" : "light"}
          className="flex-1 rounded-lg px-2.5 py-2 text-[13px]"
          style={[inputStyle, { backgroundColor: t.fill }]}
          maxLength={40}
        />
      </View>
      <View className="flex-row flex-wrap gap-1.5">
        {AC_TYPE_ORDER.map((k) => (
          <Chip
            key={k}
            label={AC_TYPE_LABELS[k]}
            radio
            selected={acType === k}
            onPress={() => setAcType(k)}
          />
        ))}
      </View>
      {/* Service schedule — feeds serviceDueState → «Обслуживание» spine. */}
      <View className="flex-row gap-2">
        <OptionalDateField
          label="Последнее ТО"
          value={lastServiceAt}
          onChange={setLastServiceAt}
        />
        <OptionalDateField
          label="Установлен"
          value={installedAt}
          onChange={setInstalledAt}
        />
        <View className="w-24">
          <Text className="mb-1 text-[11px]" style={{ color: t.sub }}>
            ТО, мес
          </Text>
          <TextInput
            value={intervalMonths}
            onChangeText={setIntervalMonths}
            placeholder="12"
            placeholderTextColor={t.placeholder}
            selectionColor={t.accent}
            keyboardAppearance={t.dark ? "dark" : "light"}
            keyboardType="number-pad"
            className="rounded-lg px-2.5 py-2 text-[13px]"
            style={[inputStyle, { backgroundColor: t.fill }]}
            maxLength={3}
          />
        </View>
      </View>
      <View className="flex-row items-center gap-2">
        <Pressable
          onPress={save}
          disabled={!canSave}
          accessibilityRole="button"
          accessibilityLabel="Сохранить кондиционер"
          className="flex-1 items-center rounded-lg py-2"
          style={{ backgroundColor: canSave ? t.accent : t.fill }}
        >
          <Text className="text-sm font-semibold" style={{ color: canSave ? "#fff" : t.faint }}>
            Сохранить
          </Text>
        </Pressable>
        <Pressable
          onPress={onCancel}
          accessibilityRole="button"
          accessibilityLabel="Отмена"
          className="items-center rounded-lg px-4 py-2 active:opacity-70"
          style={{ backgroundColor: t.fill }}
        >
          <Text className="text-sm font-semibold" style={{ color: t.sub }}>
            Отмена
          </Text>
        </Pressable>
        {onRemove ? (
          <Pressable
            onPress={onRemove}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Удалить кондиционер"
            className="h-9 w-9 items-center justify-center rounded-lg active:opacity-60"
          >
            <Trash2 color={t.danger} size={15} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

import { useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Tag } from "lucide-react-native";
import type { Client, Location } from "@babun/shared/local/clients";
import { AC_TYPE_LABELS } from "@babun/shared/local/clients";
import { serviceDueState } from "@babun/shared/local/equipment-sla";
import { buildStats } from "@babun/shared/local/selectors/client-stats";
import { extractAddressFromMapUrl } from "@babun/shared/common/utils/map-links";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import {
  ActionRow,
  AddRow,
  FieldRow,
  NavRow,
  RowActionButton,
  RowCaption,
  RowGroup,
} from "@/features/clients/card-rows";
import ObjectRouteButton from "@/features/clients/ObjectRouteButton";
import { useGuardedBookingNav } from "@/features/clients/card-booking";
import { useLocationWriter } from "@/features/clients/use-location-writer";
import { formatShortDateRu, visitsWord } from "@/features/clients/format";
import { useClient, useUpdateClient } from "@/features/clients/queries";
import { useClientAppointments } from "@/features/clients/appointments";
import { useLocationLabels } from "@/features/settings/local-settings";
import { chooseValue } from "@/lib/choose";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

// СТРАНИЦА ОБЪЕКТА — «чётко красиво обыгранное открытие самого объекта»
// (владелец 2026-07-26). Отдельный экран, а не лист снизу: полей много, и
// лист под них владелец отверг.
//
// Порядок отвечает на вопросы в том порядке, в котором они возникают у
// диспетчера: как называется → куда ехать → по какой ссылке → как войти →
// что за помещение → что там за техника → записать → служебное (основной,
// удалить).
//
// Создание: страница держит ЧЕРНОВИК и пишет один патч по «Готово». Объект
// существует, когда есть адрес или ссылка: метка одна ничего не значит, а по
// адресу или ссылке бригада доедет. Ушли, не дойдя до гейта — не создалось
// ничего, но набранное не выбрасываем молча: спрашиваем.

/** Стабильная пустая ссылка (см. ClientHeader). */
const EMPTY_LOCATIONS: Location[] = [];

type Draft = Omit<Location, "id" | "isPrimary">;

const EMPTY_DRAFT: Draft = {
  label: "",
  address: "",
  mapUrl: "",
  note: "",
  equipment: [],
};

/** Вставленная ссылка часто несёт в себе адрес — подставляем его, если поле
 *  адреса пустое. Короткая maps.app.goo.gl ничего не отдаёт, и это честно:
 *  адрес остаётся пустым, маршрут ведёт по ссылке. */
function withAddressFromLink<T extends { address: string; mapUrl?: string }>(
  next: T,
): T {
  if (next.address.trim() || !next.mapUrl?.trim()) return next;
  const found = extractAddressFromMapUrl(next.mapUrl);
  return found ? { ...next, address: found } : next;
}

export default function ClientObjectScreen() {
  const t = useThemeColors();
  const router = useRouter();
  const { clientId, locId } = useLocalSearchParams<{
    clientId: string;
    locId: string;
  }>();
  const isNew = locId === "new";

  const { data: client, isLoading } = useClient(clientId ?? "");
  const updateClient = useUpdateClient(clientId ?? "");
  const { data: appointments = [] } = useClientAppointments(clientId ?? "");
  const stats = useMemo(
    () => (client ? buildStats(client, appointments) : undefined),
    [client, appointments],
  );
  const { data: labelPresets = [] } = useLocationLabels();
  const guardedBook = useGuardedBookingNav();

  const update = async (patch: Partial<Client>) => {
    try {
      await updateClient.mutateAsync(patch);
      return true;
    } catch {
      // Алерт про неудачу принадлежит useUpdateClient; здесь важно лишь не
      // считать правку сохранённой.
      return false;
    }
  };
  const writer = useLocationWriter(client?.locations ?? EMPTY_LOCATIONS, update);

  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const loc = client?.locations?.find((l) => l.id === locId) ?? null;
  const objectCount = client?.locations?.length ?? 0;

  // Что показываем и правим: черновик в создании, объект — в обычном режиме.
  const shown: Draft = isNew ? draft : (loc ?? EMPTY_DRAFT);
  const draftDirty =
    isNew &&
    (!!draft.label.trim() ||
      !!draft.address.trim() ||
      !!draft.mapUrl?.trim() ||
      !!draft.note?.trim());
  const canSave =
    !!draft.address.trim() || !!draft.mapUrl?.trim();

  // Визит = СОСТОЯВШИЙСЯ визит, ровно как в client-stats. Без фильтра по
  // статусу подпись считала визитами запланированные и отменённые заявки и
  // показывала «посл.» датой день, который ещё не наступил.
  const history = useMemo(() => {
    if (!loc) return null;
    const mine = appointments.filter(
      (a) => a.location_id === loc.id && a.status === "completed",
    );
    if (mine.length === 0) return null;
    const lastDate = mine.reduce((m, a) => (a.date > m ? a.date : m), "");
    return { count: mine.length, lastDate };
  }, [appointments, loc]);

  const saveDraft = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      const ready = withAddressFromLink(draft);
      const ok = await writer.addLocation({
        ...ready,
        label: ready.label.trim() || "Объект",
        address: ready.address.trim(),
        mapUrl: ready.mapUrl?.trim() || undefined,
        note: ready.note?.trim() || undefined,
        equipment: [],
      });
      if (ok) router.back();
    } finally {
      setSaving(false);
    }
  };

  const patch = (p: Partial<Location>) => {
    if (isNew) {
      setDraft((d) => ({ ...d, ...p } as Draft));
      return;
    }
    if (!loc) return;
    void writer.patchLocation(loc.id, p);
  };

  /** Стандартный набор, если в кабинете «Типы объектов» пусто: владелец
   *  назвал его прямо — «дом, офис, вилла — это стандарт». */
  const typeOptions =
    labelPresets.length > 0
      ? labelPresets.map((preset) => preset.name)
      : ["Дом", "Офис", "Вилла"];

  const pickLabel = async () => {
    const picked = await chooseValue(
      "Тип объекта",
      typeOptions.map((name) => ({ value: name, label: name })),
    );
    if (picked?.value) patch({ label: picked.value });
  };

  const confirmDelete = () => {
    if (!loc) return;
    Alert.alert(
      `Удалить объект «${loc.label || "Объект"}»?`,
      "Адрес, ссылка, заметка и техника объекта будут удалены. Заявки и история останутся.",
      [
        { text: "Отмена", style: "cancel" },
        {
          text: "Удалить",
          style: "destructive",
          onPress: async () => {
            const ok = await writer.removeLocation(loc.id);
            if (ok) router.back();
          },
        },
      ],
    );
  };

  const onBack = () => {
    if (!draftDirty) {
      router.back();
      return;
    }
    Alert.alert(
      "Удалить черновик объекта?",
      "Адрес или ссылка не заполнены, поэтому объект ещё не создан.",
      [
        { text: "Продолжить заполнение", style: "cancel" },
        { text: "Удалить", style: "destructive", onPress: () => router.back() },
      ],
    );
  };

  // Объект мог быть удалён с другого устройства, пока страница открыта —
  // форма над несуществующим объектом писала бы патчи в пустоту.
  if (!isNew && !loc) {
    return (
      <Screen>
        <ScreenHeader title="Объект" />
        <View className="flex-1 items-center justify-center px-8">
          <Text
            className="text-center text-[15px]"
            style={{ color: t.sub }}
            accessibilityRole="header"
          >
            {isLoading ? "Загрузка…" : "Объект удалён"}
          </Text>
        </View>
      </Screen>
    );
  }

  const dueRows = (loc?.equipment ?? []).map((u) => {
    const due = serviceDueState(u);
    const value = due
      ? due.overdue
        ? `ТО просрочено ${Math.abs(due.daysUntil)} дн`
        : `ТО через ${due.daysUntil} дн`
      : [u.brand, u.model].filter(Boolean).join(" ") ||
        AC_TYPE_LABELS[u.ac_type];
    return {
      unit: u,
      value,
      color: due?.overdue ? t.danger : due?.soon ? t.warning : undefined,
    };
  });

  return (
    <>
      {/* Свайп от левого края — тот же уход, что кнопка «‹». Без этого он
          молча сносил набранный черновик, хотя кнопка о нём спрашивает. */}
      <Stack.Screen options={{ gestureEnabled: !draftDirty }} />
    <Screen>
      <ScreenHeader
        title={isNew ? "Новый объект" : shown.label || "Объект"}
        subtitle={client?.full_name || undefined}
        onBack={onBack}
        right={
          isNew ? (
            <Pressable
              onPress={() => void saveDraft()}
              disabled={!canSave || saving}
              accessibilityRole="button"
              accessibilityLabel="Готово"
              accessibilityState={{ disabled: !canSave || saving, busy: saving }}
              hitSlop={8}
              style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 8 }}
            >
              <Text
                maxFontSizeMultiplier={1.2}
                style={{
                  fontSize: 17,
                  fontWeight: "600",
                  color: canSave && !saving ? t.accent : t.faint,
                }}
              >
                {saving ? "Сохраняю…" : "Готово"}
              </Text>
            </Pressable>
          ) : undefined
        }
      />

      <ScrollView
        contentContainerStyle={{ paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
      >
        <RowGroup>
          {/* ТИП ОБЪЕКТА — он же метка (владелец 2026-07-26: «первая идёт как
              метка, и это должен быть тип объекта; дом, офис, вилла — это
              стандарт, и можно просто листать либо добавлять своё»).
              Отдельной строки «Тип объекта» с зашитым перечислением больше
              нет: два поля про одно и то же путали, а для SaaS словарь
              принадлежит бизнесу — пресеты живут в кабинете. */}
          <FieldRow
            label="Тип объекта"
            value={shown.label}
            placeholder="Дом / Офис / Вилла"
            stacked
            live={isNew}
            onSave={(v) => patch({ label: v })}
            trailing={
              <RowActionButton
                icon={Tag}
                color={t.accent}
                label="Выбрать тип объекта"
                onPress={() => void pickLabel()}
              />
            }
          />
          {/* АДРЕС И ССЫЛКА — ОДНО поле (владелец: «адрес — это и есть ссылка
              на объект, ссылка на карту; адрес и ссылка по сути одно и то
              же»). Поле принимает и текст, и присланный пин: маршрут ведёт по
              тому, что введено, а ссылку открывает то приложение, которое её
              понимает. */}
          <FieldRow
            label="Адрес или ссылка"
            value={shown.address}
            placeholder="Улица, дом, город — или ссылка на карту"
            stacked
            separated
            multiline
            live={isNew}
            autoFocus={isNew}
            // Последнее «куда ехать» стереть нельзя: без него объект
            // перестаёт быть объектом.
            onSave={(v) =>
              isNew || v.trim() || shown.mapUrl?.trim()
                ? patch({ address: v })
                : undefined
            }
            trailing={
              <ObjectRouteButton
                mapUrl={shown.mapUrl}
                address={shown.address}
                label={shown.label}
              />
            }
          />
          {/* «КАК ВОЙТИ» — это и есть заметка (владелец: «как войти — это и
              есть заметка, просто заметка; в заметку можно вписать и сам
              адрес»). */}
          <FieldRow
            label="Заметка"
            value={shown.note ?? ""}
            placeholder="Домофон 25, зелёная дверь, собака во дворе"
            stacked
            separated
            multiline
            live={isNew}
            onSave={(v) => patch({ note: v || undefined })}
          />
        </RowGroup>

        {/* Техника — только у существующего объекта: юниту нужен объект, в
            который его положить. */}
        {loc ? (
          <>
            <RowGroup title="Техника">
              {dueRows.map(({ unit, value, color }, i) => (
                <NavRow
                  key={unit.id}
                  label={unit.room || "Кондиционер"}
                  value={value}
                  valueColor={color}
                  separated={i > 0}
                  onPress={() =>
                    router.push({
                      pathname: "/clients/unit",
                      params: { clientId, locId: loc.id, unitId: unit.id },
                    })
                  }
                />
              ))}
              <AddRow
                label="+ Добавить кондиционер"
                separated={dueRows.length > 0}
                onPress={() =>
                  router.push({
                    pathname: "/clients/unit",
                    params: { clientId, locId: loc.id, unitId: "new" },
                  })
                }
              />
            </RowGroup>

            <RowGroup>
              <NavRow
                label="Записать сюда"
                loud
                onPress={() =>
                  client
                    ? guardedBook(client, {
                        locationId: loc.id,
                        // Одна формула бригады на все точки записи: последняя
                        // бригада КЛИЕНТА. Без неё /book подставлял последнюю
                        // бригаду ТЕНАНТА, и две кнопки записи одного клиента
                        // давали разные бригады.
                        teamId: stats?.lastTeamId ?? null,
                      })
                    : undefined
                }
              />
            </RowGroup>
            {history ? (
              <RowCaption
                text={`${history.count} ${visitsWord(history.count)}${
                  history.lastDate
                    ? ` · посл. ${formatShortDateRu(history.lastDate)}`
                    : ""
                }`}
              />
            ) : null}

            {/* «Основной» — не бейдж и не строка-дверь: у неосновного это
                действие, у основного — тихая подпись под группой. */}
            <RowGroup>
              {objectCount > 1 && !loc.isPrimary ? (
                <ActionRow
                  label="Сделать основным"
                  onPress={() => {
                    haptics.tap();
                    void writer.makePrimary(loc.id);
                  }}
                />
              ) : null}
              <ActionRow
                label="Удалить объект"
                tone="danger"
                separated={objectCount > 1 && !loc.isPrimary}
                onPress={confirmDelete}
              />
            </RowGroup>
            {objectCount > 1 && loc.isPrimary ? (
              <RowCaption text="Основной объект — его подставляем при записи." />
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </Screen>
    </>
  );
}

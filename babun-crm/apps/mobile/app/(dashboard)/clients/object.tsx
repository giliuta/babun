import { useMemo } from "react";
import { Alert, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { Client, Location } from "@babun/shared/local/clients";
import { AC_TYPE_LABELS } from "@babun/shared/local/clients";
import { serviceDueState } from "@babun/shared/local/equipment-sla";
import { buildStats } from "@babun/shared/local/selectors/client-stats";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { Spinner } from "@/components/ui/Spinner";
import {
  ActionRow,
  AddRow,
  ChoiceRow,
  FieldRow,
  NavRow,
  RowCaption,
  RowGroup,
} from "@/features/clients/card-rows";
import ObjectRouteButton from "@/features/clients/ObjectRouteButton";
import { useGuardedBookingNav } from "@/features/clients/card-booking";
import { useLocationWriter } from "@/features/clients/use-location-writer";
import { formatShortDateRu, visitsWord } from "@/features/clients/format";
import { useClient, useClients, useUpdateClient } from "@/features/clients/queries";
import {
  addressOrLinkPatch,
  objectTarget,
} from "@/features/clients/object-address";
import {
  objectTypeVocabulary,
  snapObjectType,
} from "@/features/clients/object-types";
import { useClientAppointments } from "@/features/clients/appointments";
import { useLocationLabels } from "@/features/settings/local-settings";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

// СТРАНИЦА ОБЪЕКТА — ИНФОРМАЦИЯ ОБЪЕКТА (владелец 2026-07-27: «если
// [информация] закрепляется, тогда лучше сделать информацию объекта»
// страницей). Отдельный экран, потому что к объекту крепится многое: техника
// с датами ТО, «Записать сюда», история визитов, основной/удалить.
//
// Порядок отвечает на вопросы в том порядке, в котором они возникают у
// диспетчера: как называется → куда ехать → как войти → что там за техника →
// записать → служебное (основной, удалить).
//
// СОЗДАНИЯ ЗДЕСЬ НЕТ: объект добавляется листом снизу (ObjectSheet) — три поля
// не стоят экрана поверх экрана, и объектов подряд заводят несколько. Поэтому
// страница всегда работает над СУЩЕСТВУЮЩИМ объектом и пишет каждую правку
// сразу, как остальные строки карточки.

/** Стабильная пустая ссылка (см. ClientHeader). */
const EMPTY_LOCATIONS: Location[] = [];

export default function ClientObjectScreen() {
  const t = useThemeColors();
  const router = useRouter();
  const { clientId, locId } = useLocalSearchParams<{
    clientId: string;
    locId: string;
  }>();

  const { data: client, isLoading } = useClient(clientId ?? "");
  const updateClient = useUpdateClient(clientId ?? "");
  const { data: appointments = [] } = useClientAppointments(clientId ?? "");
  const stats = useMemo(
    () => (client ? buildStats(client, appointments) : undefined),
    [client, appointments],
  );
  const { data: labelPresets = [] } = useLocationLabels();
  // Словарь типов строится по всем объектам бизнеса — список уже в кэше.
  const { data: allClients = [] } = useClients();
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

  const loc = client?.locations?.find((l) => l.id === locId) ?? null;
  const objectCount = client?.locations?.length ?? 0;

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

  const patch = (p: Partial<Location>) => {
    if (!loc) return;
    void writer.patchLocation(loc.id, p);
  };

  // Словарь типов: сначала то, чем бизнес РЕАЛЬНО пользуется (по частоте),
  // затем пресеты кабинета и стандартный набор. Тип этого объекта показываем
  // всегда, даже если он больше нигде не встречается.
  const typeOptions = useMemo(
    () =>
      objectTypeVocabulary(
        allClients,
        labelPresets.map((preset) => preset.name),
        loc?.label,
      ),
    [allClients, labelPresets, loc?.label],
  );

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

  // Объект мог быть удалён с другого устройства, пока страница открыта —
  // форма над несуществующим объектом писала бы патчи в пустоту.
  if (!loc) {
    return (
      <Screen>
        <ScreenHeader title="Объект" />
        <View className="flex-1 items-center justify-center px-8">
          {/* Ожидание ДВИЖЕТСЯ: статичная надпись «Загрузка…» читалась как
              зависший экран (владелец 2026-07-27). */}
          {isLoading ? (
            <Spinner size={28} label="Загрузка объекта" />
          ) : (
            <Text
              className="text-center text-[15px]"
              style={{ color: t.sub }}
              accessibilityRole="header"
            >
              Объект удалён
            </Text>
          )}
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
    <Screen>
      <ScreenHeader
        title={loc.label || "Объект"}
        subtitle={client?.full_name || undefined}
      />

      <ScrollView
        contentContainerStyle={{ paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
      >
        <RowGroup>
          {/* ТИП ОБЪЕКТА — ГОТОВЫЕ КНОПКИ + «+» (владелец 2026-07-27: «тип
              объекта я выбираю кнопками, чтоб там уже были готовые кнопки и
              кнопка плюс — типа добавить своё, сразу можно будет создавать»).
              Ни поля со свободным вводом, ни листа снизу: значений несколько,
              они короткие, и выбор должен быть ОДНИМ тапом.
              Словарь собирается из ФАКТИЧЕСКИХ объектов бизнеса (по частоте) +
              стандартный набор: таблицы пресетов в базе нет, а типы у каждого
              бизнеса свои. */}
          <ChoiceRow
            label="Тип объекта"
            options={typeOptions}
            value={loc.label}
            addPlaceholder="Свой тип"
            onSelect={(v) => patch({ label: snapObjectType(v, typeOptions) })}
          />
          {/* АДРЕС И ССЫЛКА — ОДНО поле (владелец: «адрес — это и есть ссылка
              на объект, ссылка на карту; по сути одно и то же»). Принимает и
              текст, и присланный пин; куда что положить, решает
              addressOrLinkPatch. Показываем адрес, а если его нет — ссылку:
              иначе объект с одним присланным пином открывался с ПУСТЫМ полем,
              будто «куда ехать» не заполнено. */}
          <FieldRow
            label="Адрес или ссылка"
            value={objectTarget(loc)}
            placeholder=""
            addLabel="Добавить"
            stacked
            separated
            multiline
            // Последнее «куда ехать» стереть нельзя: без него объект
            // перестаёт быть объектом.
            onSave={(v) =>
              v.trim() ? patch(addressOrLinkPatch(v, loc)) : undefined
            }
            trailing={
              <ObjectRouteButton
                mapUrl={loc.mapUrl}
                address={loc.address}
                label={loc.label}
              />
            }
          />
          {/* «КАК ВОЙТИ» — это и есть заметка (владелец: «как войти — это и
              есть заметка, просто заметка»). */}
          <FieldRow
            label="Заметка"
            value={loc.note ?? ""}
            placeholder=""
            addLabel="Добавить"
            stacked
            separated
            multiline
            onSave={(v) => patch({ note: v || undefined })}
          />
        </RowGroup>

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
      </ScrollView>
    </Screen>
  );
}

// ЛИЧНОЕ — «День рождения | Источник» плитками (· «Кто привёл»), как «Метка |
// Тег» наверху карточки.
//
// «Обращение» (`sms_name`) со страницы убрано: поле осталось в данных, и
// SMS-шаблоны
// по-прежнему подставляют его, если оно уже заполнено, — просто строки для
// правки на карточке больше нет.
//
// Метка и теги живут наверху карточки двумя плитками, как «Команда |
// Метка» в записи (`ClientLabelTags`). Здесь остались справочные
// свойства человека — строками одного вида: значение справа, тап — выбор.

import { useMemo, useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import type { Client } from "@babun/shared/local/clients";
import { Cake, Circle, Users } from "lucide-react-native";
import { GUTTER } from "@/components/ui/tokens";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { IdentityCard } from "@/components/blocks/TeamLabelRow";
import { PickerSheet } from "@/components/ui/PickerSheet";
import { DateWheelSheet } from "@/components/ui/DateWheelSheet";
import { formatShortDateRu } from "@/features/clients/format";
import { ClientPickerSheet } from "@/features/clients/ClientPickerSheet";
import { normalizeYMD } from "@/features/clients/OptionalDateField";
import { useClients } from "@/features/clients/queries";
import { useAppointments } from "@/features/calendar/queries";
import { withoutArchivedTeams } from "@/features/clients/team-scope";
import { useClientSources } from "@/features/clients/acquisition-sources";
import {
  isReferral,
  normalizeSource,
  resolveSource,
  sourceDisplayName,
  sourcePickerOptions,
  type ClientSource,
} from "@/features/clients/acquisition-source";
import { CUSTOM_SOURCE_ICON, SOURCE_ICONS } from "@/features/clients/source-icons";
import { useTeams } from "@/features/reference/queries";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";
import { useClientSettingsDoor } from "@/features/clients/use-settings-door";
import { useArchivedTeamIds } from "@/features/clients/use-archived-teams";

/** Значок источника: у засеянного готового — его, у своего — общий. */
function sourceIconOf(row: ClientSource) {
  return (row.key ? SOURCE_ICONS[row.key] : undefined) ?? CUSTOM_SOURCE_ICON;
}

interface PersonalBlockProps {
  client: Client;
  update: (patch: Partial<Client>) => Promise<boolean> | void;
  /** Сотрудник без «Клиенты: Меняет»: строки показывают, но не открывают
   *  выбор — сервер правку карточки отказал бы (STORY-088, волна 4). */
  readOnly?: boolean;
  /** Черновик нового клиента: отказ от SMS ставится уже сохранённому. */
  draft?: boolean;
}

export function PersonalBlock({ client, update, readOnly = false, draft = false }: PersonalBlockProps) {
  const t = useThemeColors();
  const [birthdayOpen, setBirthdayOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [referrerOpen, setReferrerOpen] = useState(false);
  const birthday = normalizeYMD(client.birthday);
  const router = useRouter();
  // ИСТОЧНИК — СПРАВОЧНИК КОМАНДЫ КЛИЕНТА (готовые правятся и удаляются, как
  // свои). Клиент без команды — у компании без команд —
  // берёт первую.
  const { data: sources = [] } = useClientSources();
  const { data: ownTeams = [] } = useTeams();
  const sourceTeamId = client.team_id ?? ownTeams[0]?.id ?? null;
  const sourceRow = resolveSource(client.acquisition_source, sources, sourceTeamId);
  // Готовый источник («Рекомендация») — на языке интерфейса, свой — как назван.
  const source = sourceRow ? sourceDisplayName(sourceRow) : null;
  // Календарь в архиве никого не обслуживает — его источники не предлагаются
  // (`serving-teams.ts`); уже выбранный остаётся подписью.
  const archivedTeamIds = useArchivedTeamIds();
  const sourceOptions =
    sourceTeamId && archivedTeamIds.has(sourceTeamId)
      ? []
      : sourcePickerOptions(sources, sourceTeamId);
  const sourcesDoor = useClientSettingsDoor("sources", sourceTeamId);
  // «Кто привёл»: список — сами клиенты компании, тот же кеш, что у списка.
  const { data: allClients = [] } = useClients();
  // ВЫБОР «КТО ПРИВЁЛ» — РОВНО ВИДИМОЕ В «КЛИЕНТАХ»: те же строки по тем же
  // правам (`useClients`), и без клиентов команд в архиве — как список под
  // «Все» (`withoutArchivedTeams`). Привести может клиент любой живой команды.
  const { data: companyAppointments = [] } = useAppointments();
  const referrerPool = useMemo(
    () => withoutArchivedTeams(allClients, archivedTeamIds, companyAppointments),
    [allClients, archivedTeamIds, companyAppointments],
  );
  const referrerName =
    allClients.find((x: Client) => x.id === client.referred_by_client_id)?.full_name ?? null;
  // Значок плитки — значок самого источника (тот же, что в шторке выбора).
  const sourceIcon = sourceRow ? sourceIconOf(sourceRow) : Circle;
  const showBirthday = !readOnly || !!birthday;
  const showSource = !readOnly || !!source;

  return (
    <>
      {/* ДВЕ ПЛИТКИ, КАК «МЕТКА | ТЕГ»: день рождения и источник. Ряд пополам, тот же
          `IdentityCard`; пустая плитка подписана словом и стоит со значком в
          кружке, как пустая «Метка». Пустая и «Только видит» — плитки нет:
          приглашать заполнить того, кто не может, незачем. */}
      {showBirthday || showSource ? (
        <View style={{ flexDirection: "row", gap: 8, marginHorizontal: GUTTER, marginTop: 8 }}>
          {showBirthday ? (
            <IdentityCard
              icon={Cake}
              color={birthday ? SETTINGS_TILE.red : t.accent}
              title={birthday ? formatShortDateRu(birthday) : "День рождения"}
              muted={!birthday}
              onPress={
                readOnly
                  ? undefined
                  : () => {
                      haptics.tap();
                      setBirthdayOpen(true);
                    }
              }
              accessibilityLabel={birthday ? `День рождения: ${formatShortDateRu(birthday)}` : "День рождения не указан"}
              accessibilityHint="Открывает выбор даты"
            />
          ) : null}
          {showSource ? (
            <IdentityCard
              icon={sourceIcon}
              color={source ? SETTINGS_TILE.orange : t.accent}
              title={source ?? "Источник"}
              muted={!source}
              onPress={
                readOnly
                  ? undefined
                  : () => {
                      haptics.tap();
                      setSourceOpen(true);
                    }
              }
              accessibilityLabel={source ? `Источник: ${source}` : "Источник не указан"}
              accessibilityHint="Открывает выбор источника"
            />
          ) : null}
        </View>
      ) : null}
      {/* КТО ПРИВЁЛ — только при источнике «Рекомендация», плиткой ниже. */}
      {isReferral(client.acquisition_source, sources, sourceTeamId) && (!readOnly || referrerName) ? (
        <View style={{ flexDirection: "row", marginHorizontal: GUTTER, marginTop: 8 }}>
          <IdentityCard
            icon={Users}
            color={referrerName ? SETTINGS_TILE.indigo : t.accent}
            title={referrerName ?? "Кто привёл"}
            sub={referrerName ? "привёл клиента" : undefined}
            muted={!referrerName}
            onPress={
              readOnly
                ? undefined
                : () => {
                    haptics.tap();
                    setReferrerOpen(true);
                  }
            }
            accessibilityLabel={referrerName ? `Кто привёл: ${referrerName}` : "Кто привёл: не указан"}
            accessibilityHint="Открывает выбор клиента"
          />
        </View>
      ) : null}
      {/* «Присылать SMS» и «Имя для SMS» живут в едином блоке «SMS». */}

      <PickerSheet
        visible={sourceOpen}
        title="Источник обращения"
        items={sourceOptions.map((o) => ({
          id: o.value,
          label: o.label,
          icon: sourceIconOf(o.source),
          color: t.accent,
          onPress: () => update({ acquisition_source: o.value }),
        }))}
        selectedId={normalizeSource(client.acquisition_source, sources, sourceTeamId)}
        emptyText="Источников нет"
        // ШЕСТЕРЁНКА — В ИСТОЧНИКИ ТОЙ КОМАНДЫ, чьи предложены: там их
        // добавляют («могут самостоятельно добавить источник»). Дверь общая с
        // «Связью»: у клиента чужого аккаунта и без права её нет (иначе вела
        // бы в свои источники).
        onSettings={sourcesDoor ? () => router.push(sourcesDoor) : undefined}
        settingsLabel="Источники команды"
        onClose={() => setSourceOpen(false)}
      />
      <DateWheelSheet
        visible={birthdayOpen}
        title="День рождения"
        value={birthday || null}
        seed="1990-01-01"
        clearLabel={birthday ? "Убрать дату" : undefined}
        onApply={(ymd) => {
          update({ birthday: ymd });
          setBirthdayOpen(false);
        }}
        onClear={() => {
          update({ birthday: "" });
          setBirthdayOpen(false);
        }}
        onClose={() => setBirthdayOpen(false)}
      />
      <ClientPickerSheet
        visible={referrerOpen}
        title="Кто привёл"
        clients={referrerPool}
        selectedId={client.referred_by_client_id}
        excludeId={client.id}
        clearLabel="Убрать"
        onSelect={(c) => update({ referred_by_client_id: c.id })}
        onClear={() => update({ referred_by_client_id: null })}
        onClose={() => setReferrerOpen(false)}
      />
    </>
  );
}

export default PersonalBlock;

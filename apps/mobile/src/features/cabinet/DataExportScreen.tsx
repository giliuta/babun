import { Fragment, useState } from "react";
import { ScrollView, View } from "react-native";
import { CalendarCheck, UserRound, Wallet, type LucideIcon } from "lucide-react-native";
import { formatCountRu } from "@babun/shared/common/utils/plural-ru";
import { Divider } from "@/components/ui/Divider";
import { EmptyState } from "@/components/ui/EmptyState";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { ScopeChips } from "@/components/ui/ScopeChips";
import { SectionCard } from "@/components/ui/SectionCard";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { useTeams } from "@/features/reference/queries";
import { useDataRole } from "@/features/settings/tenant";
import { haptics } from "@/lib/haptics";
import { notify } from "@/lib/notify";
import { writeErrorWords } from "@/lib/connection-words";
import { isHumanText } from "@babun/shared/i18n/runtime";
import type { ExportKind } from "./data-export";
import { useDataExport } from "./use-data-export";

// «ВЫГРУЗКА ДАННЫХ» (Кабинет, владелец 03.10: «выгрузить все данные можно, но
// только из своих личных команд, нельзя выгрузить, допустим, с какой-то другой
// командой»).
//
// У КАЖДОЙ СТРОКИ ОДИН ТАП — ФАЙЛ CSV УХОДИТ В «ПОДЕЛИТЬСЯ»: клиенты, записи,
// финансы. Лента команд сверху сужает выгрузку (как в клиентах и истории SMS:
// ничего не выбрано — все свои команды, тап выбирает, повторный снимает).
//
// Не владелец аккаунта выгружать не может вовсе: команда, которой с ним
// поделились, ему не принадлежит. Лента показывает только свои команды, а сам
// запрос ещё раз сверяет выбор с ними (`use-data-export.ts`).

interface DoorSpec {
  kind: ExportKind;
  tile: string;
  icon: LucideIcon;
  title: string;
  forms: readonly [string, string, string];
}

const DOORS: readonly DoorSpec[] = [
  {
    kind: "clients",
    tile: SETTINGS_TILE.indigo,
    icon: UserRound,
    title: "Клиенты",
    forms: ["клиент", "клиента", "клиентов"],
  },
  {
    kind: "appointments",
    tile: SETTINGS_TILE.blue,
    icon: CalendarCheck,
    title: "Записи",
    forms: ["запись", "записи", "записей"],
  },
  {
    kind: "finances",
    tile: SETTINGS_TILE.green,
    icon: Wallet,
    title: "Финансы",
    forms: ["операция", "операции", "операций"],
  },
];

// Отступ разделителя: поле строки 16 + плитка 28 + зазор 12.
const ROW_INSET = 56;

export function DataExportScreen() {
  const role = useDataRole();
  const { data: teams = [] } = useTeams();
  const [selected, setSelected] = useState<string | null>(null);
  // Выбранная команда пропала из списка своих (удалена, доступ снят) — снова
  // «все»: выгружать по чужому или мёртвому id нельзя.
  const teamId = selected && teams.some((team) => team.id === selected) ? selected : null;

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Выгрузка данных" />
      {role.isLoading ? (
        <EmptyState state="loading" fill />
      ) : role.isError && !role.data ? (
        <EmptyState
          state="error"
          fill
          subtitle={role.error instanceof Error ? role.error.message : undefined}
          action={{ label: "Повторить", onPress: () => void role.refetch() }}
        />
      ) : role.data !== "owner" ? (
        <EmptyState fill title="Выгрузка — у владельца аккаунта" />
      ) : (
        <ScrollView contentContainerStyle={{ paddingTop: 12, paddingBottom: 32 }}>
          {teams.length > 0 ? (
            <View style={{ marginBottom: 4 }}>
              <ScopeChips
                onCanvas
                seam={false}
                items={teams.map((team) => ({ id: team.id, name: team.name, color: team.color }))}
                activeId={teamId}
                onSelect={(id) => {
                  haptics.tap();
                  setSelected(teamId === id ? null : id);
                }}
              />
            </View>
          ) : null}
          <ExportDoors teamId={teamId} />
        </ScrollView>
      )}
    </Screen>
  );
}

function ExportDoors({ teamId }: { teamId: string | null }) {
  const { counts, busy, run } = useDataExport(teamId);

  const onExport = (kind: ExportKind) => {
    if (busy) return;
    haptics.tap();
    run(kind).catch((error: unknown) => {
      // Обрыв — «Нет связи с сервером», а не «Клиенты: TypeError: Network
      // request failed» (аудит Кабинета 03.10).
      const words = writeErrorWords(error, { failed: "Не удалось выгрузить", notDone: "Файл не собран" });
      notify(words.title, isHumanText(words.subtitle) ? words.subtitle : "Повторите попытку.");
    });
  };

  return (
    <>
      <SectionCard>
        {DOORS.map((door, index) => {
          const count = counts?.[door.kind];
          return (
            <Fragment key={door.kind}>
              {index > 0 ? <Divider inset={ROW_INSET} /> : null}
              <SettingsRow
                tile={door.tile}
                icon={door.icon}
                title={door.title}
                sub={
                  busy === door.kind
                    ? "Готовим файл…"
                    : count === undefined
                      ? undefined
                      : formatCountRu(count, door.forms)
                }
                // Нечего выгружать — строка-заглушка: пустой файл никому не нужен.
                onPress={count === 0 ? undefined : () => onExport(door.kind)}
              />
            </Fragment>
          );
        })}
      </SectionCard>
    </>
  );
}

export default DataExportScreen;

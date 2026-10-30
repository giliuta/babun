import { Pressable, Text } from "react-native";
import { LogOut, Trash2 } from "lucide-react-native";
import { SwitchRow } from "@/components/ui/SwitchRow";
import { SettingsGroup } from "@/components/ui/SettingsGroup";
import { ARCHIVE_CALENDAR_MESSAGE } from "@/features/calendar/calendar-delete";
import { useThemeColors } from "@/theme/colors";
import { confirmThen } from "@/lib/confirm";
import { notify } from "@/lib/notify";
import type { CalendarSettingsState } from "./use-calendar-settings-screen";

/** Last rows of the screen: hide the calendar, delete it, leave the team. */
export function CalendarExitRows({ screen }: { screen: CalendarSettingsState }) {
  const t = useThemeColors();
  const {
    router,
    team,
    teams,
    tenantId,
    rows,
    calendarVisibility,
    toast,
    setCreateOpen,
    archiveTeam,
    canLeave,
    leaveCalendar,
  } = screen;
  return (
    <>
      {/* ТУМБЛЕРОВ ВИДА ЗДЕСЬ НЕТ: «Показывать доход
          и расход», «Метки дня» и «События» включены всегда
          (`ALWAYS_ON_FEATURES`), «Скрывать отменённые» — у команды на
          странице «Записи», вкладка «Клиент». */}
      {/* УПРАВЛЕНИЕ КАЛЕНДАРЁМ — ОДНОЙ ГРУППОЙ, как все группы шестерёнки:
          каждая строка своей карточкой со своим отступом сверху ломала шаг
          страницы. Плиток у строк нет — шов от поля строки.
          ПОД ПРОВЕРКОЙ `team` НЕ ДЛЯ КРАСОТЫ: строки печатают `team.name`,
          а при нуле календарей его нет — экран падал бы на первом же кадре. */}
      <SettingsGroup
        title="Управление"
        inset={16}
        rows={[
          /* СКРЫТЬ КАЛЕНДАРЬ — ВЫБОР ЧЕЛОВЕКА, НЕ КОМАНДЫ.
             Скрытый пропадает из календаря, финансов и клиентов только у
             него; здесь остаётся, и тумблер его возвращает. Серый, пока
             другого видимого календаря нет: смотреть было бы некуда. */
          team && tenantId ? (
            <SwitchRow
              key="hide"
              label="Скрыть календарь"
              hint={
                !calendarVisibility.isHidden(tenantId, team.id) && !calendarVisibility.canHide(tenantId, team.id)
                  ? "Нужен другой календарь"
                  : undefined
              }
              value={calendarVisibility.isHidden(tenantId, team.id)}
              disabled={
                !calendarVisibility.isHidden(tenantId, team.id) && !calendarVisibility.canHide(tenantId, team.id)
              }
              onChange={(hide) =>
                calendarVisibility.toggle.mutate(
                  { tenantId, teamId: team.id, hide },
                  { onError: (e) => notify("Ошибка", e.message) },
                )
              }
            />
          ) : null,
          /* УДАЛЕНИЕ КАЛЕНДАРЯ. МЯГКОЕ (`is_active=false`), и это не
             полумера: записи ссылаются на `team_id`, жёсткое удаление
             порвало бы им ссылку и унесло историю выручки. Календарь
             пропадает из ленты, его записи остаются в базе.
             ПОСЛЕДНИЙ УДАЛИТЬ НЕЛЬЗЯ: без единого календаря продукту некуда
             писать запись, а в ленте не остаётся даже чипа. */
          team && rows.remove ? (
            <Pressable
              key="remove"
              onPress={() => {
                if (teams.length < 2) {
                  toast(
                    "Последний календарь удалить нельзя",
                    "warn",
                    { label: "Создать", onPress: () => setCreateOpen(true) },
                  );
                  return;
                }
                confirmThen(
                  `Удалить календарь «${team.name}»?`,
                  {
                    message: ARCHIVE_CALENDAR_MESSAGE,
                    confirmLabel: "Удалить",
                    destructive: true,
                  },
                  () =>
                    archiveTeam.mutate(team.id, {
                      onSuccess: () => {
                        const next = teams.find((x) => x.id !== team.id);
                        router.setParams({ team: next?.id });
                      },
                      onError: (e) => notify("Ошибка", e.message),
                    }),
                );
              }}
              disabled={archiveTeam.isPending}
              accessibilityRole="button"
              accessibilityLabel={`Удалить календарь ${team.name}`}
              className="min-h-[52px] flex-row items-center justify-center gap-2 px-4 py-3.5"
              style={({ pressed }: { pressed: boolean }) => ({
                backgroundColor: pressed ? t.pressed : "transparent",
              })}
            >
              <Trash2 color={t.danger} size={16} strokeWidth={2.2} />
              <Text style={{ fontSize: 15, fontWeight: "600", color: t.danger }}>
                Удалить календарь
              </Text>
            </Pressable>
          ) : null,
          team && tenantId && canLeave ? (
            <Pressable
              key="leave"
              onPress={() =>
                confirmThen(
                  `Выйти из команды «${team.name}»?`,
                  {
                    message:
                      "Команда пропадёт из вашего календаря, её записи и клиенты станут вам не видны. Вернуть доступ может владелец, пригласив вас снова.",
                    confirmLabel: "Выйти из команды",
                    destructive: true,
                  },
                  () =>
                    leaveCalendar.mutate(
                      { tenantId, teamId: team.id },
                      {
                        onSuccess: ({ leftAccount }) => {
                          toast(`Вы вышли из команды «${team.name}»`, "success");
                          if (leftAccount) return;
                          const next = teams.find((x) => x.id !== team.id);
                          router.setParams({ team: next?.id });
                        },
                        onError: (e) => notify("Не удалось выйти", e.message),
                      },
                    ),
                )
              }
              disabled={leaveCalendar.isPending}
              accessibilityRole="button"
              accessibilityLabel={`Выйти из команды ${team.name}`}
              className="min-h-[52px] flex-row items-center justify-center gap-2 px-4 py-3.5"
              style={({ pressed }: { pressed: boolean }) => ({
                backgroundColor: pressed ? t.pressed : "transparent",
                opacity: leaveCalendar.isPending ? 0.5 : 1,
              })}
            >
              <LogOut color={t.danger} size={16} strokeWidth={2.2} />
              <Text style={{ fontSize: 15, fontWeight: "600", color: t.danger }}>
                Выйти из команды
              </Text>
            </Pressable>
          ) : null,
        ]}
      />
    </>
  );
}

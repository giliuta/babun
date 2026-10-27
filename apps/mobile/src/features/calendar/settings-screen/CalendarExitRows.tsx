import { Pressable, Text } from "react-native";
import { LogOut, Trash2 } from "lucide-react-native";
import { SwitchRow } from "@/components/ui/SwitchRow";
import { SectionCard } from "@/components/ui/SectionCard";
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
      {/* ПОД ПРОВЕРКОЙ `team` НЕ ДЛЯ КРАСОТЫ: карточка печатает `team.name`,
          а при нуле календарей его нет — экран падал бы на первом же кадре.
          */}
      {/* СКРЫТЬ КАЛЕНДАРЬ — ВЫБОР ЧЕЛОВЕКА, НЕ КОМАНДЫ.
          Скрытый пропадает из календаря, финансов и клиентов только у
          него; здесь остаётся, и тумблер его возвращает. Серый, пока
          другого видимого календаря нет: смотреть было бы некуда. */}
      {team && tenantId ? (
        <SectionCard className="mt-4">
          <SwitchRow
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
        </SectionCard>
      ) : null}
      {team && rows.remove ? (
        <>
          {/* УДАЛЕНИЕ КАЛЕНДАРЯ — ПОСЛЕДНЕЙ СТРОКОЙ ЭКРАНА: завести календарь можно,
              значит и убрать должно быть чем (механизм мягкого удаления —
              `useRefDelete`).

              МЯГКОЕ (`is_active=false`), и это не полумера: записи
              ссылаются на `team_id`, жёсткое удаление порвало бы им ссылку
              и унесло историю выручки. Календарь пропадает из ленты, его
              записи остаются в базе.

              ПОСЛЕДНИЙ УДАЛИТЬ НЕЛЬЗЯ. Без единого календаря продукту
              некуда писать запись, а в ленте не остаётся даже чипа —
              человек оказался бы в тупике, из которого только создание. */}
          <SectionCard className="mt-4">
            <Pressable
              onPress={() => {
                // ПОСЛЕДНИЙ УДАЛИТЬ НЕЛЬЗЯ — и говорится это ПЛАШКОЙ СВЕРХУ,
                // как все прочие запреты продукта (не постоянной подсказкой, а в ответ на нажатие).
                //
                // Кнопка НЕ гасится намеренно. Погашенная кнопка молчит:
                // человек видит серое «Удалить календарь» и не знает,
                // сломано это или так задумано. Нажимаемая кнопка отвечает
                // на его вопрос ровно тогда, когда он его задал, — а
                // постоянная строка-объяснение под кнопкой висела на экране
                // всё время у всех, включая тех, у кого календарей много.
                if (teams.length < 2) {
                  toast(
                    // Одна строка и не длиннее: плашка не переносит текст, лишнее
                    // обрезается многоточием. «Что делать» говорит кнопка.
                    "Последний календарь удалить нельзя",
                    "warn",
                    // Плашка говорит «создайте другой» — здесь же и даёт
                    // это сделать. Без кнопки человек читает указание,
                    // закрывает плашку и ищет, чем его выполнить.
                    { label: "Создать", onPress: () => setCreateOpen(true) },
                  );
                  return;
                }
                // «УДАЛИТЬ» УВОДИТ В АРХИВ. Шаг обратим, поэтому вопрос короткий и без цифр; стереть
                // навсегда можно только из Кабинета → «Архив».
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
                        // Экран смотрел на ушедший календарь: уводим на
                        // соседний, иначе он показывает настройки того,
                        // чего в ленте уже нет.
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
          </SectionCard>
        </>
      ) : null}
      {team && tenantId && canLeave ? (
        <SectionCard className="mt-4">
          <Pressable
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
                        // Последней командой аккаунта человек уходит
                        // из него целиком — увести в свой календарь
                        // успела чистка (`evictCompanyFromDevice`).
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
        </SectionCard>
      ) : null}
    </>
  );
}

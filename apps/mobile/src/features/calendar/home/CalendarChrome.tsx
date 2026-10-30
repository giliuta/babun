import { View } from "react-native";
import { ScopeChips } from "@/components/ui/ScopeChips";
import { LoadingBar } from "@/components/ui/LoadingBar";
import { CalendarHeader } from "@/features/calendar/CalendarHeader";
import { ModePlaque } from "@/features/calendar/ModePlaque";
import type { CalendarController } from "./use-calendar-controller";
import { recordComment } from "@/features/calendar/record-title";
import { TourTarget } from "@/components/tour/TourTarget";

/** Header, the mode plaque, the calendars ribbon and the
 *  background refresh bar. */
export function CalendarChrome({ c }: { c: CalendarController }) {
  const {
    headerTitle, mode, now, isOnToday, changeMode, pushBookOnce, activeTeamId,
    setMiniCalOpen, goToday, pickClientId, pickClientName,
    activeTeam, setPick, editingApt, clientName, setEditingApt, moving, movingKind,
    teams, isCrew, moveWindowMin, moveLimit, setMoving, chipItems, pendingChipId, chipTeamId,
    pickCalendar, isRefetching, pull, silentRevalidating,
  } = c;
  return (
    <>
      <View>
      <CalendarHeader
        monthTitle={headerTitle}
        mode={mode}
        todayNumber={now.getDate()}
        isOnToday={isOnToday}
        onModeChange={changeMode}
        // Шестерёнка настраивает ТО, НА ЧТО СМОТРИШЬ: календарь открытой
        // команды. Не ведёт в хаб команды (экран про мастеров, услуги и
        // удаление). activeTeamId здесь всегда есть: без команд экран занят first-run
        // гейтом выше.
        // ШЕСТЕРЁНКА ЕСТЬ ВСЕГДА: если выдавать её только владельцу, в чужой
        // команде шапка календаря стоит без неё — визуал страницы меняется
        // вместе с ролью. Страница настроек открыта всем, а
        // какие строки на ней есть, решает `calendar/settings-rows.ts`.
        // Та же защита от двойного тапа, что у формы: две страницы настроек
        // и «назад» дважды.
        onGear={() => pushBookOnce(`/calendar?team=${activeTeamId}`)}
        onTitlePress={() => setMiniCalOpen(true)}
        onToday={goToday}
      />
      </View>

      {/* ПЛАШКА РЕЖИМА — «кого записываем» или «что переносим». Пока она
          висит, свободное время подсвечено зелёным, а тап по кубику ведёт в
          форму записи либо переставляет запись. */}
      {pickClientId ? (
        <ModePlaque
          title={`Записать: ${pickClientName || "клиент"}`}
          subtitle={`Выберите зелёное время · ${activeTeam?.default_slot_minutes ?? 30} мин`}
          exitLabel="Отменить выбор времени"
          onExit={() => setPick(null)}
        />
      ) : editingApt ? (
        <ModePlaque
          title={`Перемещение: ${clientName(editingApt) || recordComment(editingApt) || "Запись"}`}
          // В другую команду — «Перенести» в меню записи (кубики по сетке
          // выбранной команды); здесь только палец и «готово» тапом.
          subtitle="Тяните запись · тап по пустому месту — готово"
          exitLabel="Закончить перемещение"
          onExit={() => setEditingApt(null)}
        />
      ) : moving ? (
        <ModePlaque
          title={`${movingKind === "copy" ? "Копировать" : "Перенести"}: ${clientName(moving) || recordComment(moving) || "Запись"}`}
          subtitle={
            moveLimit ??
            (teams.length > 1 && !isCrew
              ? `Зелёное время · ${moveWindowMin} мин · команда — ниже`
              : `Выберите зелёное время · ${moveWindowMin} мин`)
          }
          exitLabel={movingKind === "copy" ? "Отменить копирование" : "Отменить перенос"}
          onExit={() => setMoving(null)}
        />
      ) : null}

      {/* Лента без чипов не рисуется — и обучению подсвечивать нечего:
          обёртка только вокруг живой ленты. */}
      {chipItems.length > 0 ? (
        <TourTarget id="calendar.chips" shape="strip">
          <ScopeChips
            items={chipItems}
            // Пока идёт переход, подсвечен ТОТ чип, в который тапнули: экран
            // отвечает на касание сразу, а данные догоняют под скелетом. Для
            // своего календаря то же даёт оптимистичный `chipTeamId` (onPickOwn).
            activeId={pendingChipId ?? chipTeamId}
            onSelect={pickCalendar}
          />
        </TourTarget>
      ) : null}

      {/* Фоновое дообновление календаря: полоса под шапкой вместо контрола,
          который сам выезжал и сдвигал ленту. */}
      <LoadingBar
        visible={isRefetching && !pull.refreshing && !silentRevalidating}
      />
    </>
  );
}

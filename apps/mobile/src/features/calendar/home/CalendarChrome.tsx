import { View } from "react-native";
import { ScopeChips } from "@/components/ui/ScopeChips";
import { LoadingBar } from "@/components/ui/LoadingBar";
import { CalendarHeader } from "@/features/calendar/CalendarHeader";
import { CalendarNotice } from "@/features/calendar/CalendarNotice";
import { ModePlaque } from "@/features/calendar/ModePlaque";
import { NOTICE_LIFETIME_MS } from "./use-slot-notice";
import type { CalendarController } from "./use-calendar-controller";

/** Header with the notice, the mode plaque, the calendars ribbon and the
 *  background refresh bar. */
export function CalendarChrome({ c }: { c: CalendarController }) {
  const {
    headerTitle, mode, now, isOnToday, changeMode, pushBookOnce, activeTeamId,
    setMiniCalOpen, goToday, notice, setNotice, pickClientId, pickClientName,
    activeTeam, setPick, editingApt, clientName, setEditingApt, moving, movingKind,
    teams, isCrew, moveWindowMin, setMoving, chipItems, pendingChipId, chipTeamId,
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
        // команды. Раньше вела в хаб команды — экран про мастеров, услуги и
        // удаление, где настройки календаря лежали под аккордеоном.
        // activeTeamId здесь всегда есть: без команд экран занят first-run
        // гейтом выше.
        // ШЕСТЕРЁНКА ЕСТЬ ВСЕГДА (владелец 20.09: «сверху слева должна быть
        // шестерёнка, что там, что там… я могу зайти туда, но блоков уже
        // внутри шестерёнки не будет»). Раньше её выдавали только владельцу, и
        // в чужой команде шапка календаря стояла без неё — визуал страницы
        // менялся вместе с ролью. Теперь страница настроек открыта всем, а
        // какие строки на ней есть, решает `calendar/settings-rows.ts`.
        // Та же защита от двойного тапа, что у формы: две страницы настроек
        // и «назад» дважды (аудит 03.10).
        onGear={() => pushBookOnce(`/calendar?team=${activeTeamId}`)}
        onTitlePress={() => setMiniCalOpen(true)}
        onToday={goToday}
      />
      {notice ? (
        <CalendarNotice
          stamp={notice.id}
          when={notice.when}
          message={notice.message}
          actionLabel="Записать"
          onAction={notice.onAction}
          onDismiss={() => setNotice(null)}
          lifetimeMs={NOTICE_LIFETIME_MS}
        />
      ) : null}
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
          title={`Перемещение: ${clientName(editingApt) || editingApt.comment || "Запись"}`}
          // В другую команду — «Перенести» в меню записи (кубики по сетке
          // выбранной команды); здесь только палец и «готово» тапом.
          subtitle="Тяните запись · тап по пустому месту — готово"
          exitLabel="Закончить перемещение"
          onExit={() => setEditingApt(null)}
        />
      ) : moving ? (
        <ModePlaque
          title={`${movingKind === "copy" ? "Копировать" : "Перенести"}: ${clientName(moving) || moving.comment || "Запись"}`}
          subtitle={
            teams.length > 1 && !isCrew
              ? `Зелёное время · ${moveWindowMin} мин · команда — ниже`
              : `Выберите зелёное время · ${moveWindowMin} мин`
          }
          exitLabel={movingKind === "copy" ? "Отменить копирование" : "Отменить перенос"}
          onExit={() => setMoving(null)}
        />
      ) : null}

      <ScopeChips
        items={chipItems}
        // Пока идёт переход, подсвечен ТОТ чип, в который тапнули: экран
        // отвечает на касание сразу, а данные догоняют под скелетом. Для
        // своего календаря то же даёт оптимистичный `chipTeamId` (onPickOwn).
        activeId={pendingChipId ?? chipTeamId}
        onSelect={pickCalendar}
      />

      {/* Фоновое дообновление календаря: полоса под шапкой вместо контрола,
          который сам выезжал и сдвигал ленту. */}
      <LoadingBar
        visible={isRefetching && !pull.refreshing && !silentRevalidating}
      />
    </>
  );
}

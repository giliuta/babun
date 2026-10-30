import { CalendarClock, CalendarRange, Globe, ZoomIn } from "lucide-react-native";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SettingsGroup } from "@/components/ui/SettingsGroup";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { formatHm } from "@/features/calendar/window";
import { utcLabel, zoneClock } from "@/features/calendar/device-timezone";
import { zoneCities } from "@/features/calendar/zone-label";
import { CalendarIdentityCard } from "./CalendarIdentityCard";
import { TourTarget } from "@/components/tour/TourTarget";
import type { CalendarSettingsState } from "./use-calendar-settings-screen";
import { useTeamName } from "@/session/team-name";

const WHOLE_DAY = "Весь день на экране";

type Team = NonNullable<CalendarSettingsState["team"]>;

/** Rows of the open calendar itself: name and colour, timezone, hours and
 *  zoom, team schedule. */
export function CalendarTeamRows({ screen, team }: { screen: CalendarSettingsState; team: Team }) {
  const { rows, patchTeam, timezone, setPicker, window, zoomPct, schedText, setScheduleOpen } = screen;
  // Имя календаря — правилом показа, как чип ленты (`useTeamName`).
  const teamName = useTeamName();
  return (
    <>
      {/* ИМЯ И ЦВЕТ — ГРУППА «КАЛЕНДАРЬ», как все группы шестерёнки. */}
      <SettingsGroup
        title="Календарь"
        rows={[
          rows.renameEdit ? (
            <CalendarIdentityCard
              key={team.id}
              team={team}
              onPatch={patchTeam}
            />
          ) : rows.rename ? (
            // «Название и цвет: Только видит» — имя с цветом, без правки.
            <TourTarget key="name" id="settings.name">
              <SettingsRow appearance={{ color: team.color }} title={teamName(team.name)} sub="Название и цвет" />
            </TourTarget>
          ) : null,
        ]}
      />
      {/* ЧАСОВОЙ ПОЯС — СРАЗУ ПОД ИМЕНЕМ КАЛЕНДАРЯ. Он задаёт, что для этого
          бизнеса значит «сегодня»: от него считаются границы дня в календаре,
          в финансах и в отчётах. Остальные настройки экрана живут ВНУТРИ
          суток, которые он определяет, — значит он им предшествует.
          Настройка У КАЖДОГО КАЛЕНДАРЯ СВОЯ: второй календарь может стоять в
          другой стране (колонка `teams.timezone`). */}
      {/* ВРЕМЯ КАЛЕНДАРЯ — ОДНОЙ КАРТОЧКОЙ СО ШВАМИ (пачка 5, Д4): пояс,
          часы сетки и график команды — один вопрос «когда», и каждая строка
          своей плашкой разрывала его на три. */}
      <SettingsGroup
        title="Время"
        rows={[
      rows.timezone ? (
          <TourTarget key="timezone" id="settings.timezone">
          <SettingsRow
            // ЦВЕТНАЯ ПЛИТКА, КАК У ВСЕХ ДВЕРЕЙ ЭТОЙ СТРАНИЦЫ:
            // «neutral» — материал денежных экранов (канон SettingsRow),
            // здесь он делал три верхние строки чужими. Оранжевый —
            // «время и допуски» по словарю плиток.
            tile={SETTINGS_TILE.orange}
            icon={Globe}
            title="Часовой пояс"
            // Строка печатает РАСПИСКУ, а не имя зоны: город и часы.
            // Проверить, что продукт считает день правильно, можно за
            // секунду — сверив это время с часами в статус-баре.
            // Строка называет пояс ТЕМИ ЖЕ словами, что и барабан, из
            // которого его выбрали: «Kyiv, Nicosia, Helsinki · UTC+3».
            // Печатать один город было неправдой — выглядело так, будто
            // выбран он один, хотя это целая группа.
            // ВСЁ В ОДНОЙ МЕЛКОЙ СТРОКЕ, через точку: города, смещение,
            // время. Часы здесь не значение строки, а последняя
            // подробность: строка отвечает на вопрос «какой пояс», а не
            // «который час». Крупным справа они спорили с названием
            // настройки и читались как её главный смысл.
            sub={`${zoneCities(timezone)} · ${utcLabel(timezone)} · ${zoneClock(timezone)}`}
            onPress={rows.timezoneEdit ? () => setPicker("tz") : undefined}
          />
          </TourTarget>
      ) : null,
      /* ВАЛЮТЫ ЗДЕСЬ НЕТ: она одна на
          компанию и живёт в «Настройки финансов → Вся компания». */
      /* ПАРТНЁРОВ ЗДЕСЬ НЕТ: они своей карточкой вместе с тарифом
          (`CalendarAccountRows`) — у каждого календаря свои люди. */
      /* «Длительности записи» здесь нет:
          длительность даёт УСЛУГА, а не настройка календаря. Дефолт
          тапа по слоту остался кодовым фолбэком 30 мин. */
      /* ДВА ВОПРОСА ПРО ЧАСЫ СТОЯТ РЯДОМ: на разных концах экрана человек
          сравнивал бы их по памяти.
          «Часы календаря» — какой отрезок суток ВИДЕН на сетке; настройка
          общая на все календари, и это сказано в самой строке, а не
          сноской под карточкой. «График команды» — КОГДА РАБОТАЕТ ЭТА
          КОМАНДА (дни и часы, правится шторкой снизу).

          ПОРЯДОК: сперва часы календаря, потом график команды. Так и читается: сначала настраивают саму сетку — то,
          на что смотришь каждый день, — а уже потом заполняют её работой
          конкретной команды. */
      /* «МАСШТАБ» — В ШТОРКЕ «ЧАСЫ КАЛЕНДАРЯ» (ползунок в процентах). Часы
          говорят, КАКОЙ отрезок суток есть на сетке, масштаб — СКОЛЬКО
          его видно сразу. Масштаб личный и телефонный (`grid-memory.ts`),
          поэтому шторка открыта каждому: без права менять часы — только
          с ползунком. Тот, кому часы не видны вовсе, получает свою
          строку «Масштаб» с той же шторкой. */
      rows.hours ? (
          <TourTarget key="hours" id="settings.hours">
            <SettingsRow
              tile={SETTINGS_TILE.teal}
              icon={CalendarRange}
              title="Часы календаря"
              // Наименьший масштаб — «весь день на экране», а не «0 %»: ноль
              // читался как «масштаба нет».
              sub={
                zoomPct === 0
                  ? `${formatHm(window.start)}–${formatHm(window.end)} · ${WHOLE_DAY}`
                  : `${formatHm(window.start)}–${formatHm(window.end)} · масштаб ${zoomPct}%`
              }
              onPress={() => setPicker("view")}
            />
          </TourTarget>
        ) : (
          <TourTarget key="zoom" id="settings.zoom">
            <SettingsRow
              tile={SETTINGS_TILE.indigo}
              icon={ZoomIn}
              title="Масштаб"
              sub={zoomPct === 0 ? WHOLE_DAY : `${zoomPct}%`}
              onPress={() => setPicker("zoom")}
            />
          </TourTarget>
        ),
      rows.schedule ? (
          <TourTarget key="schedule" id="settings.schedule">
            <SettingsRow
              tile={SETTINGS_TILE.blue}
              icon={CalendarClock}
              title="График команды"
              sub={schedText}
              // «Только видит» — строка без двери: график показан,
              // правки нет.
              onPress={rows.scheduleEdit ? () => setScheduleOpen(true) : undefined}
            />
          </TourTarget>
      ) : null,
        ]}
      />
    </>
  );
}

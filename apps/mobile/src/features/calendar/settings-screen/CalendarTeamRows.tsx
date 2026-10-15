import { CalendarClock, CalendarRange, Globe, ZoomIn } from "lucide-react-native";
import { SectionCard } from "@/components/ui/SectionCard";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { formatHm } from "@/features/calendar/window";
import { utcLabel, zoneClock } from "@/features/calendar/device-timezone";
import { zoneCities } from "@/features/calendar/zone-label";
import { CalendarIdentityCard } from "./CalendarIdentityCard";
import type { CalendarSettingsState } from "./use-calendar-settings-screen";

type Team = NonNullable<CalendarSettingsState["team"]>;

/** Rows of the open calendar itself: name and colour, timezone, hours and
 *  zoom, team schedule. */
export function CalendarTeamRows({ screen, team }: { screen: CalendarSettingsState; team: Team }) {
  const { rows, patchTeam, timezone, setPicker, window, zoomPct, schedText, setScheduleOpen } = screen;
  return (
    <>
      {rows.renameEdit ? (
        <CalendarIdentityCard
          key={team.id}
          team={team}
          onPatch={patchTeam}
        />
      ) : rows.rename ? (
        // «Название и цвет: Только видит» — имя с цветом, без правки.
        <SectionCard>
          <SettingsRow appearance={{ color: team.color }} title={team.name} sub="Название и цвет" />
        </SectionCard>
      ) : null}
      {/* ЧАСОВОЙ ПОЯС — СРАЗУ ПОД ИМЕНЕМ КАЛЕНДАРЯ. Он задаёт, что для этого
          бизнеса значит «сегодня»: от него считаются границы дня в календаре,
          в финансах и в отчётах. Остальные настройки экрана живут ВНУТРИ
          суток, которые он определяет, — значит он им предшествует.
          Настройка У КАЖДОГО КАЛЕНДАРЯ СВОЯ: второй календарь может стоять в
          другой стране (колонка `teams.timezone`). */}
      {rows.timezone ? (
        <SectionCard>
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
        </SectionCard>
      ) : null}
      {/* ВАЛЮТЫ ЗДЕСЬ НЕТ: она одна на
          компанию и живёт в «Настройки финансов → Вся компания». */}
      {/* «МАСТЕРОВ» ЗДЕСЬ НЕТ: сотрудник один на
          компанию и живёт в «Кабинет → Сотрудники», права — по командам
          на его странице. */}
      {/* «Длительности записи» здесь нет:
          длительность даёт УСЛУГА, а не настройка календаря. Дефолт
          тапа по слоту остался кодовым фолбэком 30 мин. */}
      {/* ДВА ВОПРОСА ПРО ЧАСЫ СТОЯТ РЯДОМ: на разных концах экрана человек
          сравнивал бы их по памяти.
          «Часы календаря» — какой отрезок суток ВИДЕН на сетке; настройка
          общая на все календари, и это сказано в самой строке, а не
          сноской под карточкой. «График команды» — КОГДА РАБОТАЕТ ЭТА
          КОМАНДА (дни и часы, правится шторкой снизу).

          ПОРЯДОК: сперва часы календаря, потом график команды. Так и читается: сначала настраивают саму сетку — то,
          на что смотришь каждый день, — а уже потом заполняют её работой
          конкретной команды. */}
      {/* «МАСШТАБ» — В ШТОРКЕ «ЧАСЫ КАЛЕНДАРЯ» (ползунок в процентах). Часы
          говорят, КАКОЙ отрезок суток есть на сетке, масштаб — СКОЛЬКО
          его видно сразу. Масштаб личный и телефонный (`grid-memory.ts`),
          поэтому шторка открыта каждому: без права менять часы — только
          с ползунком. Тот, кому часы не видны вовсе, получает свою
          строку «Масштаб» с той же шторкой. */}
      <SectionCard className="mt-4">
        {rows.hours ? (
          <SettingsRow
            tile={SETTINGS_TILE.teal}
            icon={CalendarRange}
            title="Часы календаря"
            sub={`${formatHm(window.start)}–${formatHm(window.end)} · масштаб ${zoomPct}%`}
            onPress={() => setPicker("view")}
          />
        ) : (
          <SettingsRow
            tile={SETTINGS_TILE.indigo}
            icon={ZoomIn}
            title="Масштаб"
            sub={`${zoomPct}%`}
            onPress={() => setPicker("zoom")}
          />
        )}
      </SectionCard>
      {rows.schedule ? (
        <SectionCard>
          <SettingsRow
            tile={SETTINGS_TILE.blue}
            icon={CalendarClock}
            title="График команды"
            sub={schedText}
            // «Только видит» — строка без двери: график показан,
            // правки нет.
            onPress={rows.scheduleEdit ? () => setScheduleOpen(true) : undefined}
          />
        </SectionCard>
      ) : null}
    </>
  );
}

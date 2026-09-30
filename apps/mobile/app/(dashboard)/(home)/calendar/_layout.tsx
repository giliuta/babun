import { Stack, useGlobalSearchParams, usePathname } from "expo-router";
import { useThemeColors } from "@/theme/colors";
import { RoleCapabilityBoundary } from "@/features/settings/RoleCapabilityBoundary";
import { useTeamSettingLevel } from "@/features/calendar/team-setting-level";

// Настройки календаря. Живут ВНУТРИ вкладки «Календарь» (app/(dashboard)/
// (home)), поэтому таб-бар остаётся на месте, а вкладка помнит, на какой
// странице настроек её оставили.
//
// Две ступени, канон iOS Settings → Почта:
//   /calendar          — общее для всех календарей + список календарей
//   /calendar/labels   — метки дня
//   /calendar/services — прайс команды
//
// Ступень навигации = ОБЛАСТЬ ДЕЙСТВИЯ: на экране команды нет ни одного
// контрола, пишущего в общие настройки, поэтому «правлю Ремонт, а меняется
// у Отделки» невозможно физически, а не по договорённости.
//
// Сессию и тенанта гейтит DashboardGate из ../../_layout.tsx — здесь остаётся
// только право на сами настройки.
//
// ПЕРВАЯ СТУПЕНЬ ОТКРЫТА ВСЕМ (владелец 20.09: «сверху слева должна быть
// шестерёнка, что там, что там; я могу зайти туда, но блоков уже внутри
// шестерёнки не будет… визуал целой страницы мы полностью сохраняем»).
// Раньше стена стояла на всей группе: у мастера и диспетчера не было ни
// шестерёнки в шапке календаря, ни страницы за ней. Теперь страница одна и та
// же для всех, а какие строки на ней есть — отвечает `settings-rows.ts`.
//
// Вторые ступени остаются за правом: это уже сами настройки, а не страница с
// ними. Человек, которому строк не показали, туда и не ходит — строк-дверей у
// него нет; прямая ссылка упирается в объяснение, как и раньше.
// СТРАНИЦЫ «НАСТРОЕК КОМАНДЫ» — ПО ПРАВУ СТРОКИ (владелец 30.09: «Записи»,
// «Услуги», «Метки» — «Скрыт · Только видит · Видит и меняет»). Сотрудник
// проходит, если его ступень в команде адреса не «Скрыт»; правку страница
// гасит сама, а пускает сервер. Типы событий — часть «Записей».
const TEAM_PAGE_BLOCK: Record<string, string> = {
  "/calendar/design": "calendar.booking_form",
  "/calendar/event-types": "calendar.booking_form",
  "/calendar/services": "calendar.services",
  "/calendar/labels": "calendar.labels",
};

export default function CalendarSettingsLayout() {
  const t = useThemeColors();
  const pathname = usePathname();
  const params = useGlobalSearchParams<{ team?: string | string[] }>();
  const teamParam = Array.isArray(params.team) ? params.team[0] : params.team;
  const pageBlock = TEAM_PAGE_BLOCK[pathname.replace(/\/$/, "")] ?? null;
  const pageLevel = useTeamSettingLevel(pageBlock ?? "", teamParam ?? null);
  const stack = (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: t.canvas },
      }}
    />
  );
  const isIndex = pathname === "/calendar" || pathname === "/calendar/";
  if (isIndex) return stack;
  // Без команды в адресе ступень не спросить — такую ссылку ведёт общее
  // правило (владельцу открыто всё).
  if (pageBlock && teamParam && pageLevel !== "hidden") return stack;
  return (
    <RoleCapabilityBoundary capability="manage-calendar-settings" title="Календарь">
      {stack}
    </RoleCapabilityBoundary>
  );
}

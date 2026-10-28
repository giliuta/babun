import { useRouter, type Href } from "expo-router";
import { CalendarCheck } from "lucide-react-native";
import { formatCountRu } from "@babun/shared/common/utils/plural-ru";
import { SectionCard } from "@/components/ui/SectionCard";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { useBookingSettings } from "./online-booking-settings";

// СТРОКА «ОНЛАЙН-ЗАПИСЬ» В НАСТРОЙКАХ КАЛЕНДАРЯ. Ведёт на онлайн-запись той
// команды, чьи настройки открыты (`?team=`, как «Услуги» и «SMS»). Подпись —
// живое состояние: выключена или сколько услуг открыто заказчику.
//
// СТРОКА ЕСТЬ, ТОЛЬКО КОГДА СЕРВЕР ОТВЕТИЛ. Пока функций онлайн-записи в базе
// нет (или ответ ещё в пути), двери нет вовсе: дверь в страницу с ошибкой
// хуже отсутствия двери.
export function OnlineBookingSettingsRow({ teamId }: { teamId: string | null }) {
  const router = useRouter();
  const data = useBookingSettings(teamId).data;
  if (!data) return null;
  const open = data.services.filter((s) => s.online).length;
  const sub = data.enabled
    ? open > 0
      ? `Включена · ${formatCountRu(open, ["услуга", "услуги", "услуг"])}`
      : "Включена · нет услуг"
    : "Выключена";

  return (
    <SectionCard>
      <SettingsRow
        tile={SETTINGS_TILE.indigo}
        icon={CalendarCheck}
        title="Онлайн-запись"
        sub={sub}
        onPress={() =>
          router.push(
            (teamId
              ? { pathname: "/calendar/online-booking", params: { team: teamId } }
              : "/calendar/online-booking") as Href,
          )
        }
      />
    </SectionCard>
  );
}

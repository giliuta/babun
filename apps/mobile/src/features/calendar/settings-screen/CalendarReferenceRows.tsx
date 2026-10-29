import type { Href } from "expo-router";
import { Briefcase, ClipboardList, Tags } from "lucide-react-native";
import { SettingsGroup } from "@/components/ui/SettingsGroup";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { SmsSettingsRow } from "@/features/sms/SmsSettingsRow";
import { useOnlineBookingSettingsRow } from "@/features/online-booking/OnlineBookingSettingsRow";
import { useDeletedAppointmentsRow } from "@/features/calendar/DeletedAppointmentsDoor";
import { TariffLocked } from "@/features/tariffs/TariffLocked";
import type { CalendarSettingsState } from "./use-calendar-settings-screen";
import { TourTarget } from "@/components/tour/TourTarget";

/** Doors of the calendar: «Записи», «Услуги», «Метки» and the team's SMS. */
export function CalendarReferenceRows({ screen }: { screen: CalendarSettingsState }) {
  const { router, team, rows, bookingSub, labelsSub, isOwner } = screen;
  const onlineRow = useOnlineBookingSettingsRow(isOwner ? (team?.id ?? null) : null);
  const deletedRow = useDeletedAppointmentsRow(team?.id ?? null);
  // ОДНА КАРТОЧКА СО ШВАМИ, как в шестерёнках клиентов, финансов и Кабинета:
  // каждая дверь своей карточкой делала страницу лесенкой одиночных плашек
  // (пачка 5, Д4). Шов — только между строками, что остались.
  return (
    <SettingsGroup
      title="Работа"
      rows={[
      /* КАК ВЫГЛЯДИТ И ЧТО СПРАШИВАЕТ ЗАПИСЬ. Шестерёнка настраивает ТО, НА ЧТО СМОТРИШЬ, а цвет блока
          и набор блоков формы — это ровно оно; держать их только в Кабинете
          значило отправлять человека в другую вкладку за настройкой того,
          что у него сейчас перед глазами.
          Стоит ПЕРЕД справочниками: сперва решают, как запись выглядит и о
          чём спрашивает, и только потом наполняют её услугами и метками.
          Настройка одна на фирму, а не на команду, — поэтому команду сюда,
          в отличие от «Услуг» и «Меток», не передаём. */
      rows.booking ? (
          <TourTarget key="records" id="settings.records">
          <SettingsRow
            tile={SETTINGS_TILE.blue}
            icon={ClipboardList}
            // «ЗАПИСИ», А НЕ «ДИЗАЙН»: одна страница вида,
            // цвета, блоков записи и события, типов событий и «Скрывать
            // отменённые». Не «Записи клиентов» — там и события.
            title="Записи"
            sub={bookingSub}
            // КАЛЕНДАРЬ ЕДЕТ АДРЕСОМ, как у «Услуг» и «Меток»: «Записи» у
            // каждой команды свои.
            onPress={() =>
              router.push({
                pathname: "/calendar/design",
                params: { team: team.id },
              } as Href)
            }
          />
          </TourTarget>
      ) : null,

      /* СПРАВОЧНИКИ КАЛЕНДАРЯ. Метки живут здесь, а не в настройках клиентов:
          метка — это про ДЕНЬ и
          маршрут команды, а карточка клиента её только показывает. */
      rows.services ? (
        /* Услуги — здесь, потому что именно они дают ДЛИТЕЛЬНОСТЬ записи
            (настройки «Длительность» на календаре больше нет). Тот же
            экран, что в Кабинете, второй дверью внутри стека /calendar:
            наружу этот стек не ведёт (закон навигации). */
        <TourTarget key="services" id="settings.services">
        <TariffLocked locked={rows.servicesLocked}>
        <SettingsRow
          tile={SETTINGS_TILE.blue}
          icon={Briefcase}
          title="Услуги"
          sub="Каталог работ и цены"
          // Отдаём ТУ команду, чьи настройки открыты: иначе прайс
          // открывался на чужой, и новая услуга уезжала не туда.
          onPress={() =>
            router.push(
              team?.id
                ? ({
                    pathname: "/calendar/services",
                    params: { team: team.id },
                  } as Href)
                : ("/calendar/services" as Href),
            )
          }
        />
        </TariffLocked>
        </TourTarget>
      ) : null,
      rows.labels ? (
          <TourTarget key="labels" id="settings.labels">
          <SettingsRow
            tile={SETTINGS_TILE.purple}
            icon={Tags}
            title="Метки"
            // Подпись показывает СВОИ метки, а не жанр: «Города и районы» врали
            // про содержимое (туда можно писать что угодно, это всё метки).
            sub={labelsSub}
            // ОТДАЁМ ТУ КОМАНДУ, ЧЬИ НАСТРОЙКИ ОТКРЫТЫ — как «Услуги» строкой
            // выше. Без параметра экран меток брал команду из MMKV, то есть
            // ту, что открыта в САМОМ КАЛЕНДАРЕ, а чип наверху меняет только
            // `params.team`. Настройки на Команде 3 → «Метки» открывали
            // Команду 2 и новая метка
            // уезжала в чужой календарь. Подпись строки при этом показывала
            // ПРАВИЛЬНЫЕ метки — расхождение видно было только внутри.
            onPress={() =>
              router.push(
                team?.id
                  ? ({
                      pathname: "/calendar/labels",
                      params: { team: team.id },
                    } as Href)
                  : ("/calendar/labels" as Href),
              )
            }
          />
          </TourTarget>
      ) : null,
      /* SMS КОМАНДЫ (STORY-089). Шаблоны, отправка и история
          той команды, чьи настройки открыты; баланс компании — Кабинет →
          SMS. Шаблоны правит владелец — строка только ему. */
      isOwner ? (
          <TourTarget key="sms" id="settings.sms">
            <SmsSettingsRow teamId={team?.id ?? null} />
          </TourTarget>
      ) : null,
      /* ОНЛАЙН-ЗАПИСЬ КОМАНДЫ — страница babun.app/b для заказчиков:
          выключатель, ссылка, какие услуги видны. Её публикует владелец —
          строка только ему, и сервер пускает только его. */
      onlineRow,
      /* «УДАЛЁННЫЕ ЗАПИСИ» — ящик удалённого в этом календаре: 30 дней,
          «Вернуть». Строку видит тот, кто может удалять. */
      deletedRow,
      ]}
    />
  );
}

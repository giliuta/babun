import { useRef } from "react";
import {
  useLocalSearchParams,
  useRouter,
  type Href,
} from "expo-router";
import { SHEET_EXIT_MS } from "@/components/ui/BottomSheet";
import { useTenantId } from "@/lib/tenant";

/** Router wiring of the calendar tab: guarded pushes to the record form,
 *  the way back to the screen that sent us here, and the route params. */
export function useCalendarRoute() {
  const router = useRouter();
  // ДВОЙНОЙ ТАП НЕ ОТКРЫВАЕТ ФОРМУ ДВАЖДЫ: две страницы одной
  // записи (нижняя — со старыми данными), а из «Записать» — вторая
  // заполненная форма и дубль записи. Та же защита, что у «Финансов».
  const lastBookPushRef = useRef(0);
  const pushBookOnce = (href: Parameters<typeof router.push>[0]) => {
    const at = Date.now();
    if (at - lastBookPushRef.current < 700) return;
    lastBookPushRef.current = at;
    router.push(href);
  };
  /** Экран, с которого пришли открывать запись. Ref, а не state: он не влияет
   *  на отрисовку и не должен вызывать лишний рендер календаря. Гасится сразу
   *  после ухода — второе закрытие уже никуда не уводит. */
  const returnToRef = useRef<string | null>(null);
  const returnHome = () => {
    const href = returnToRef.current;
    if (!href) return;
    returnToRef.current = null;
    // Лист уезжает первым: переключить вкладку под открытым модалом значит
    // показать человеку пустой лист поверх нового экрана.
    //
    // Вкладка — push (переход на таб), страница-донор (инвойс, счёт) —
    // replace: push наслаивал бы вторую копию её экрана поверх календаря, и
    // жест «назад» водил бы по кругу.
    setTimeout(() => {
      if (href === "/finances") router.push(href as Href);
      else router.replace(href as Href);
    }, SHEET_EXIT_MS);
  };
  const params = useLocalSearchParams<{
    appointmentId?: string;
    new?: string;
    clientId?: string;
    locationId?: string;
    teamId?: string;
    date?: string;
    kind?: string; // AppointmentKind черновика
    /** Куда вернуться, когда запись закроют. Ставит её тот, кто сюда привёл:
     *  деньги по заявке открывают запись с «Финансов», и закрытие обязано
     *  вернуть человека в ту же ленту, а не оставить в календаре («назад» возвращает в оплату). Вкладки не
     *  складываются в стек, поэтому «назад» здесь — это переход на вкладку. */
    from?: string;
    // РЕЖИМ ПОДБОРА ВРЕМЕНИ: «Записать» с карточки/списка открывает ЭТОТ
    // календарь, подсвечивает свободное зелёным и ждёт выбора (открывается
    // уже существующий календарь, и там просто выбирают).
    pickClient?: string;
    pickLocation?: string;
    /** Команда того же задания — везём её до формы, а не теряем на
     *  пересадке в календаре. */
    pickTeam?: string;
  }>();
  const tenantId = useTenantId();

  return {
    router, pushBookOnce, returnToRef, returnHome, params, tenantId,
  };
}

export type CalendarRoute = ReturnType<typeof useCalendarRoute>;

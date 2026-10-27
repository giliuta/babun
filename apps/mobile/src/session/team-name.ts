import { useCallback } from "react";
import { useSession } from "@/providers/SessionProvider";
import { calendarChipName, type ChipViewer } from "@/session/calendar-chips";

/** Кто смотрит: почта и имя из профиля — по ним календарь, названный своим
 *  адресом, подписывается именем человека (`calendarChipName`). */
export function useChipViewer(): ChipViewer {
  const { session } = useSession();
  const fullName: unknown = session?.user.user_metadata?.full_name;
  return {
    email: session?.user.email,
    name: typeof fullName === "string" ? fullName : null,
  };
}

/** ИМЯ КОМАНДЫ ДЛЯ ПОКАЗА — ОДНО НА ВЕСЬ ПРОДУКТ. Команда, названная адресом
 *  почты (так её назвала регистрация), в чипе календаря подписана именем
 *  человека или «Личный», а клиенты, финансы и шторки печатали сырой адрес —
 *  «babun.app+r…». Показ имени команды идёт только через это правило; само
 *  имя в базе не меняется и правится в настройках календаря как есть. */
export function useTeamName(): (name: string | null | undefined) => string {
  const { email, name } = useChipViewer();
  return useCallback(
    (raw: string | null | undefined) => calendarChipName(raw ?? "", { email, name }),
    [email, name],
  );
}

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { setWriteGuard } from "@babun/shared/sync/write-guard";
import { queryClient } from "@/lib/query-client";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";
import { isMirrorClientKey } from "./mirror-cache";
import type { MemberAccessMap } from "../access-map";
import type { UserRole } from "@/features/settings/role-policy";

// РЕЖИМ «ЕГО ГЛАЗАМИ» — ОДНО СОСТОЯНИЕ НА ВСЁ ПРИЛОЖЕНИЕ.
//
// Владелец 20.09: «зеркало… посмотреть его глазами — вот это классная идея,
// прям очень хорошо, протыкать». Поэтому зеркало — не отдельный макет, а
// сам продукт: пока режим включён, `useMyAccess` и `useCurrentRole` отвечают
// правами и ролью ЭТОГО человека, и все экраны — календарь, клиенты, финансы,
// запись — показывают то, что увидит он.
//
// ЧЕСТНАЯ ГРАНИЦА, которую называет плашка: данные в зеркале ВАШИ. Сервер
// отдаёт строки по вашему токену, и подменить это на клиенте нельзя — иначе
// зеркало показывало бы неправду в другую сторону. Зеркало отвечает на вопрос
// «что ему видно и что он может», а не «какие у него цифры».
//
// Состояние живёт в контексте над всеми вкладками (`(dashboard)/_layout`),
// поэтому выход из режима гарантирован: уход из приложения, перезапуск или
// кнопка «Выйти» в плашке — и права снова свои.
//
// И ПОКА РЕЖИМ ВКЛЮЧЁН, ПРИЛОЖЕНИЕ НЕ ПИШЕТ ВОВСЕ. Права в зеркале его, а
// токен — ваш: кнопка, которую видно «его глазами», создала бы настоящую
// запись в боевой базе. Засов стоит на отправке запроса и на входе в
// офлайн-очередь (`@babun/shared/sync/write-guard`).

export interface MirrorState {
  /** Кого показываем. Имя — для плашки. */
  name: string;
  /** Роль этого человека в компании: в зеркале владельцем он не бывает. */
  role: UserRole;
  /** Его карта прав — та же форма, что у `my_access_map`. */
  map: MemberAccessMap;
  /** Календарь, с которого открыли зеркало: плашка называет его. */
  calendarName: string | null;
}

interface MirrorApi {
  mirror: MirrorState | null;
  enter: (state: MirrorState) => void;
  exit: () => void;
}

const MirrorContext = createContext<MirrorApi>({
  mirror: null,
  enter: () => {},
  exit: () => {},
});

/** Кэш, набранный ключами сотрудника — стирается на выходе
 *  (`mirror-cache.ts`, правило с тестом). */
function sweepMirrorCache(): void {
  queryClient.removeQueries({ predicate: (query) => isMirrorClientKey(query.queryKey) });
}

export function MirrorProvider({ children }: { children: ReactNode }) {
  const [mirror, setMirror] = useState<MirrorState | null>(null);
  const tenantId = useTenantId();

  // ЗАСОВ ЧИТАЕТ ССЫЛКУ, А НЕ МОДУЛЬНУЮ ПЕРЕМЕННУЮ. Его спрашивают оттуда,
  // где React-контекста нет (обёртка `fetch`, очередь синхронизации).
  // Модульная переменная это умела, но обнулялась при Fast Refresh: модуль
  // перечитывался, режим в состоянии React оставался, и в разработке
  // получалось «плашка висит, а писать можно» — открыто ровно в опасную
  // сторону. `useRef` переживает перезагрузку модуля вместе с состоянием.
  //
  // Значение кладётся В САМОМ ДЕЙСТВИИ, а не в эффекте: между рендером и
  // эффектом есть щель, и открыта она была бы опять в ту же сторону.
  const mirrorRef = useRef<MirrorState | null>(null);
  useEffect(() => {
    setWriteGuard(() => mirrorRef.current !== null);
    return () => setWriteGuard(() => false);
  }, []);

  const leave = () => {
    mirrorRef.current = null;
    setMirror(null);
    sweepMirrorCache();
  };
  const leaveRef = useRef(leave);
  leaveRef.current = leave;

  // ВЫШЕЛ ИЗ АККАУНТА — ВЫШЕЛ И ИЗ РЕЖИМА. Провайдер стоит над всем деревом и
  // не размонтируется никогда, поэтому без этого следующий вход на устройстве
  // встречал бы плашку с именем чужого сотрудника, чужую карту прав и запрет
  // на запись.
  //
  // СМЕНА ЧЕЛОВЕКА — ТОЖЕ ВЫХОД, И НЕ ТОЛЬКО ЧЕРЕЗ `SIGNED_OUT`. В аккаунт
  // можно войти другим человеком без выхода — эту дорогу приложение знает и
  // подметает за ней данные (`auth-clear.ts`), а режим не трогало.
  // Обновление токена и правка своего профиля режим НЕ гасят: человек тот же.
  const userIdRef = useRef<string | null>(null);
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      const next = session?.user?.id ?? null;
      const previous = userIdRef.current;
      userIdRef.current = next;
      if (!mirrorRef.current) return;
      if (event === "SIGNED_OUT") leaveRef.current();
      else if (next !== null && previous !== null && next !== previous) leaveRef.current();
    });
    return () => data.subscription.unsubscribe();
  }, []);

  // СМЕНИЛ КОМПАНИЮ — РЕЖИМ КОНЧИЛСЯ. Права сотрудника за ним не едут, и
  // показывать в компании B плашку про календарь компании A — обман.
  // Пустая компания — это «ещё не знаем», а не «другая»: выходить нельзя.
  useEffect(() => {
    if (!tenantId || !mirror || mirror.map.tenantId === tenantId) return;
    leaveRef.current();
  }, [mirror, tenantId]);

  const value = useMemo<MirrorApi>(
    () => ({
      mirror,
      enter: (state) => {
        mirrorRef.current = state;
        setMirror(state);
      },
      exit: () => leaveRef.current(),
    }),
    [mirror],
  );
  return <MirrorContext.Provider value={value}>{children}</MirrorContext.Provider>;
}

/** Состояние зеркала и способ его включить. Отвечает СЫРЫМ состоянием —
 *  им пользуются только плашка (ей нужно показаться до выхода) и сам
 *  провайдер. Вне провайдера — выключено. */
export function useMirrorMode(): MirrorApi {
  return useContext(MirrorContext);
}

/** Зеркало ДЛЯ ЭТОЙ компании — для всех, кто читает права.
 *
 *  Проверка компании живёт здесь, а не у каждого спрашивающего: она была
 *  написана дважды и пропущена трижды, и пропустившие один кадр после
 *  перехода судили компанию B картой прав компании A. */
export function useMirror(): MirrorState | null {
  const { mirror } = useContext(MirrorContext);
  const tenantId = useTenantId();
  if (!mirror || !tenantId || mirror.map.tenantId !== tenantId) return null;
  return mirror;
}

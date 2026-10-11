// ДОРЕГИСТРАЦИЯ ПОСЛЕ ЕДИНОГО ВХОДА (владелец 09.10: «единая страница для
// регистрации и входа… через Apple, через Google… потом должны придумывать
// пароль»). Чистый слой без React и сети: кто после входа идёт на экран
// «Почти готово» и что там спросить.
//
// • Вход через Apple или Google создаёт аккаунт без пароля. Пароль нужен,
//   чтобы потом войти почтой (на сайте, на другом телефоне), поэтому такой
//   человек придумывает его сразу. Признак — у аккаунта нет входа почтой
//   (identity `email`) и нет отметки `password_set`.
// • Регистрация почтой с экрана входа не спрашивает имя: его спрашивает тот
//   же экран после кода из письма (`finish_pending` в метаданных при signUp).

type Identity = { provider?: string | null };

export type UserLike =
  | {
      user_metadata?: Record<string, unknown> | null;
      identities?: readonly Identity[] | null;
    }
  | null
  | undefined;

export interface SignupFinish {
  /** Экран «Почти готово» нужен. */
  needed: boolean;
  /** Спросить пароль: входа почтой у аккаунта ещё нет. */
  needsPassword: boolean;
  /** Имя, которым поле заполнено заранее (Google и Apple его отдают). */
  suggestedName: string;
}

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export function signupFinish(user: UserLike): SignupFinish {
  if (!user) return { needed: false, needsPassword: false, suggestedName: "" };
  const meta = user.user_metadata ?? {};
  // СПИСОК ВХОДОВ НЕИЗВЕСТЕН — ПАРОЛЬ НЕ СПРАШИВАЕМ. Сохранённая на телефоне
  // старая сессия может нести пользователя без `identities`; принять её за
  // «вход без пароля» значило бы запереть на «Почти готово» всех вошедших.
  const identities = Array.isArray(user.identities) ? user.identities : [];
  const hasEmailLogin = identities.some((i) => i?.provider === "email");
  const needsPassword = identities.length > 0 && !hasEmailLogin && meta.password_set !== true;
  const needed = needsPassword || meta.finish_pending === true;
  return {
    needed,
    needsPassword,
    suggestedName: text(meta.full_name) || text(meta.name),
  };
}

/** НА iPhone НОВЫЙ АККАУНТ НЕ ЗАВОДИТСЯ (App Review 3.1.1, владелец 09.10:
 *  «на iPhone пока только вход»). Вход через Apple/Google всё равно создаёт
 *  пользователя на сервере; пускаем его дальше, только если он пришёл по
 *  приглашению или уже работает в чужой команде. Иначе экран говорит «аккаунта
 *  нет» и выводит — без удаления: если человек потом заведёт аккаунт на сайте
 *  тем же Google, он просто войдёт. */
export function mayFinishHere({
  canSignUpHere,
  hasPendingInvitation,
  roles,
}: {
  canSignUpHere: boolean;
  hasPendingInvitation: boolean;
  roles: readonly string[];
}): boolean {
  return canSignUpHere || hasPendingInvitation || roles.some((role) => role !== "owner");
}

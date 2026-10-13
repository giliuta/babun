// Which reference data the booking form waits for, and which failure hides it.

/** The part of a react-query result the gate reads. */
export interface GateQuery {
  isPending: boolean;
  isLoadingError: boolean;
  isFetching: boolean;
  error: unknown;
  refetch: () => Promise<unknown>;
}

export interface GateRef {
  readonly label: string;
  readonly query: GateQuery;
}

export interface ReferenceGateInput {
  kind: "work" | "event";
  isEdit: boolean;
  teamId: string | null;
  teamsQuery: GateQuery;
  mastersQuery: GateQuery;
  servicesQuery: GateQuery;
  clientsQuery: GateQuery;
  appointmentsQuery: GateQuery;
  calendarSettingsQuery: GateQuery;
  eventTypesQuery: GateQuery;
  teamScheduleQuery: GateQuery;
}

export interface ReferenceGate {
  referenceQueries: readonly GateRef[];
  essentialQueries: readonly GateRef[];
  failedReference: GateRef | undefined;
  referencesPending: boolean;
}

export function referenceGate({
  kind,
  isEdit,
  teamId,
  teamsQuery,
  mastersQuery,
  servicesQuery,
  clientsQuery,
  appointmentsQuery,
  calendarSettingsQuery,
  eventTypesQuery,
  teamScheduleQuery,
}: ReferenceGateInput): ReferenceGate {
  const referenceQueries =
    kind === "event"
      ? ([
          // Винительный падеж: «Не удалось загрузить команды/календарь…».
          { label: "команды", query: teamsQuery },
          { label: "календарь", query: appointmentsQuery },
          { label: "настройки календаря", query: calendarSettingsQuery },
          { label: "типы событий", query: eventTypesQuery },
        ] as const)
      : ([
          { label: "команды", query: teamsQuery },
          { label: "партнёров", query: mastersQuery },
          { label: "услуги", query: servicesQuery },
          { label: "клиентов", query: clientsQuery },
          { label: "календарь", query: appointmentsQuery },
          { label: "настройки календаря", query: calendarSettingsQuery },
          ...(teamId
            ? [{ label: "график команды", query: teamScheduleQuery }]
            : []),
        ] as const);
  // Только БАЗОВЫЕ справочники гейтят экран: без них нельзя собрать валидную
  // запись (команды; для работы ещё клиенты). Всё остальное (услуги/график/
  // настройки/типы/календарь) — необязательное: его сбой не блокирует
  // создание простой записи, а лишь даёт деградацию (пустой список/без
  // предупреждения о наложении).
  const essentialQueries =
    kind === "event"
      ? ([
          { label: "команды", query: teamsQuery },
          // Правка ждёт сам список записей: без него страница показала бы
          // пустой черновик вместо той записи, которую открыли.
          ...(isEdit
            ? ([{ label: "запись", query: appointmentsQuery }] as const)
            : ([] as const)),
        ] as const)
      : ([
          { label: "команды", query: teamsQuery },
          { label: "клиентов", query: clientsQuery },
          ...(isEdit
            ? ([{ label: "запись", query: appointmentsQuery }] as const)
            : ([] as const)),
        ] as const);
  // ФОРМУ ПРЯЧЕТ ТОЛЬКО ОШИБКА ПЕРВОЙ ЗАГРУЗКИ (03.10, на лежащем сервере).
  // Команды и клиенты уже приехали, черновик собран — «Создать запись»
  // будит их перечитывание, и упавшее перечитывание (`isError` при живых
  // данных) меняло всю заполненную форму на экран ошибки. Данные на руках —
  // форма остаётся; сохранение само скажет, если сервер молчит.
  const failedReference = essentialQueries.find(({ query }) => query.isLoadingError);
  const referencesPending = essentialQueries.some(
    ({ query }) => query.isPending,
  );
  return { referenceQueries, essentialQueries, failedReference, referencesPending };
}

// Per-client roll-up shape and its empty value.

export interface ClientStats {
  /** Number of completed visits. */
  visits: number;
  /** Lifetime money paid by the client. */
  totalSpent: number;
  /** YYYY-MM-DD of the most recent completed visit, or "" if none. */
  lastVisitDate: string;
  /** Number of days since lastVisitDate, or null if never visited. */
  lastVisitDays: number | null;
  /** Next future appointment, scheduled OR in_progress. */
  nextApt: { date: string; time: string } | null;
  /** Days until nextApt (0 = today, 1 = tomorrow), or null. */
  nextAptDays: number | null;
  /** ЛИЧНЫЙ РИТМ КЛИЕНТА — медиана промежутков между его завершёнными
   *  визитами, в днях. null, когда визитов меньше двух: ритма ещё нет.
   *
   *  Нужен вместо общего порога «давно не был». Один порог на всех врёт в
   *  обе стороны: клининг ездит раз в неделю, кондиционеры — раз в полгода,
   *  и 60 дней для первого катастрофа, а для второго норма. Медиана, а не
   *  среднее: один сезонный пропуск не должен сдвигать норму. */
  medianGapDays: number | null;
  /** ПРОШЕДШИЕ НЕЗАКРЫТЫЕ ВИЗИТЫ: запись стоит «запланирована», а дата уже
   *  прошла. Работу почти наверняка сделали, но её никто не закрыл — значит
   *  визит не считается визитом, деньги не попали ни в долг, ни в выручку,
   *  а клиент выглядит тем, кто «так и не приехал».
   *
   *  Календарь это состояние знает и красит янтарём; список клиентов
   *  должен знать его тоже — тем же правилом: только записи С ДОЛГОМ
   *  (€0 и оплаченная вперёд закрыть нечем). */
  unclosedVisits: number;
  /** YYYY-MM-DD самого позднего ПРОШЕДШЕГО НЕЗАКРЫТОГО визита, или "".
   *  Строка списка красит дату последнего визита жёлтым, если последним был
   *  именно такой (последний визит не закрыт — жёлтым). */
  lastUnclosedDate: string;
  /** Все прошедшие незакрытые записи, и без долга, — для вопроса «есть ли
   *  у клиента история» (удаление): запись на €0 — тоже запись. */
  pastOpenRecords: number;
  /** YYYY-MM-DD самой поздней прошедшей незакрытой записи, и без долга, или
   *  "". Строка списка ставит её дату серой: запись на €0 закрыть нечем, но
   *  и пропускать её нельзя — она была последней. */
  lastPastOpenDate: string;
  /** Неотменённые записи с сегодняшнего дня вперёд. Удаление клиента их не
   *  трогает — вопрос «Удалить клиента?» говорит, что они останутся. */
  upcomingRecords: number;
  /** Неполученные деньги: завершённые визиты с недоплатой ПЛЮС прошедшие
   *  записи, по которым команда не отчиталась, — для владельца это одно и
   *  то же «нам не заплатили». */
  debt: number;
  /** Expected revenue — Σ total_amount of FUTURE scheduled/in-progress
   *  appointments (today or later). Powers the card's grey «ожидаемая
   *  прибыль» figure. 0 when the client has no upcoming bookings. */
  expectedRevenue: number;
  /** team_id of the client's most-recent COMPLETED visit that carried one
   *  — drives the «команда» segment on the list card. null if the client
   *  has no completed visits with a team (future-only bookings don't count). */
  lastTeamId: string | null;
  /** Days since the client record was created. */
  ageDays: number;
  /** Days until the next birthday (0–365), or null when no birthday. */
  birthdayInDays: number | null;
}

export const EMPTY_STATS: ClientStats = {
  visits: 0,
  totalSpent: 0,
  lastVisitDate: "",
  lastVisitDays: null,
  nextApt: null,
  nextAptDays: null,
  medianGapDays: null,
  unclosedVisits: 0,
  lastUnclosedDate: "",
  pastOpenRecords: 0,
  lastPastOpenDate: "",
  upcomingRecords: 0,
  debt: 0,
  expectedRevenue: 0,
  lastTeamId: null,
  ageDays: 0,
  birthdayInDays: null,
};

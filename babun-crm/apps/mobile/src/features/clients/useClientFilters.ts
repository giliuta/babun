import { useMemo } from "react";
import type { Client, ClientTag } from "@babun/shared/local/clients";
import type { Appointment } from "@babun/shared/local/appointments";
import type { ClientStats } from "@babun/shared/local/selectors/client-stats";
import { matchesClient } from "@babun/shared/local/selectors/client-search";
import { getAvatarColor } from "@babun/shared/common/utils/avatar-color";
import {
  matchesSegment,
  periodLabel,
  SEGMENT_OPTIONS,
  type ActiveToken,
  type ClientsFilter,
  type FacetOption,
  type SortKey,
} from "./filter";

// Волна 2 — порт web useClientFilters (v812): один хук владеет
// отфильтрованным списком, опциями фасетов и токенами бара.
// Отличие от веба — структура мемо: сортировка живёт в СВОЁМ
// useMemo (deps: clients/sort/statsMap), а предикаты применяются к уже
// отсортированному списку. Фильтр сохраняет порядок → результат
// идентичен вебу, но клавиатурный ввод в поиске НЕ перегоняет
// O(n log n) localeCompare-компаратор (фикс Волны 1 — не откатывать).

export interface ClientFilterResult {
  /** Итоговый отсортированный+отфильтрованный список. */
  filtered: Client[];
  /** Удаляемые токены summary-бара (сегмент/команды/метки/теги/период). */
  activeTokens: ActiveToken[];
  /** Число активных значений ФИЛЬТРА (не сортировки) — бейдж бара. */
  activeCount: number;
  teamOptions: FacetOption[];
  cityOptions: FacetOption[];
  tagOptions: FacetOption[];
}

/** Свободная нормализация имени — зеркалит seed-fallback buildStatsMap. */
function normName(s: string): string {
  return (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export interface ClientAppointmentIndex {
  /** clientId → множество team_id по записям клиента. */
  clientTeams: Map<string, Set<string>>;
  /** clientId → список дат записей (YYYY-MM-DD). */
  clientApptDates: Map<string, string[]>;
}

/** Один проход по записям — два индекса по клиенту. Включая fallback по
 *  имени в comment для seed-записей с client_id:null (как buildStatsMap). */
export function buildClientAppointmentIndex(
  clients: Client[],
  appointments: Appointment[],
): ClientAppointmentIndex {
  const byId = new Map<string, Appointment[]>();
  const orphanByName = new Map<string, Appointment[]>();
  for (const a of appointments) {
    // A cancelled visit is not part of the relationship history. Counting
    // it here made clients appear under a team/period even when their only
    // record in that facet had been cancelled.
    if (a.status === "cancelled") continue;
    if (a.client_id) {
      const arr = byId.get(a.client_id);
      if (arr) arr.push(a);
      else byId.set(a.client_id, [a]);
    } else {
      const key = normName(a.comment);
      if (key) {
        const arr = orphanByName.get(key);
        if (arr) arr.push(a);
        else orphanByName.set(key, [a]);
      }
    }
  }

  const clientTeams = new Map<string, Set<string>>();
  const clientApptDates = new Map<string, string[]>();
  for (const c of clients) {
    const own = byId.get(c.id) ?? [];
    let combined: Appointment[];
    if (orphanByName.size > 0) {
      const cname = normName(c.full_name);
      const orphans: Appointment[] = [];
      for (const [name, arr] of orphanByName) {
        if (cname && name.includes(cname)) orphans.push(...arr);
      }
      combined = orphans.length === 0 ? own : own.concat(orphans);
    } else {
      combined = own;
    }
    const teamSet = new Set<string>();
    const dates: string[] = [];
    for (const a of combined) {
      if (a.team_id) teamSet.add(a.team_id);
      if (a.date) dates.push(a.date);
    }
    clientTeams.set(c.id, teamSet);
    clientApptDates.set(c.id, dates);
  }
  return { clientTeams, clientApptDates };
}

/** Минимальная структурная форма команды — хук читает только id/name/
 *  color, так что подходят и shared Team, и Supabase-row из useTeams(). */
interface TeamLike {
  id: string;
  name: string;
  color: string | null;
}

/** Минимальная форма метки библиотеки (cities) — имя+цвет, порядок массива
 *  = порядок библиотеки (useCities уже отдаёт по position). */
interface CityLike {
  name: string;
  color: string | null;
}

export function useClientFilters(
  clients: Client[],
  appointments: Appointment[],
  teams: TeamLike[],
  cities: CityLike[],
  tags: ClientTag[],
  statsMap: Map<string, ClientStats>,
  /** Сортировка — настройка списка (sort-pref), не часть фильтра. */
  sort: SortKey,
  filter: ClientsFilter,
  search: string,
): ClientFilterResult {
  const { segments, selectedTeams, selectedCities, activeTags, period } =
    filter;

  const index = useMemo(
    () => buildClientAppointmentIndex(clients, appointments),
    [clients, appointments],
  );

  // ── Опции фасетов ────────────────────────────────────────────────
  // Вся библиотека сразу (решение владельца 2026-07-22): фасеты
  // показывают полный справочник, а не только использованные значения —
  // фильтр по пустому значению честно даёт 0 в футере.
  const teamOptions = useMemo<FacetOption[]>(() => {
    return teams.map((t) => ({
      value: t.id,
      label: t.name,
      // Supabase-row может держать color=null — точка не должна пропасть.
      color: t.color ?? getAvatarColor(t.name),
    }));
  }, [teams]);

  const cityOptions = useMemo<FacetOption[]>(() => {
    // ВСЯ библиотека меток Кабинета (порядок position, цвет метки) +
    // legacy-хвост: свободные значения client.city, не совпавшие с
    // библиотекой trim/case-insensitive, — по алфавиту с avatar-цветом.
    // «Прочее»-корзины нет: каждое значение — отдельный удаляемый токен.
    const used = new Map<string, string>(); // norm → как написано у клиента
    for (const c of clients) {
      const city = (c.city ?? "").trim();
      if (!city) continue;
      const norm = city.toLowerCase();
      if (!used.has(norm)) used.set(norm, city);
    }
    const options: FacetOption[] = [];
    for (const lib of cities) {
      const name = lib.name.trim();
      if (!name) continue;
      used.delete(name.toLowerCase());
      options.push({
        value: name,
        label: name,
        color: lib.color ?? getAvatarColor(name),
      });
    }
    const legacy = [...used.values()].sort((a, b) => a.localeCompare(b, "ru"));
    for (const city of legacy) {
      options.push({ value: city, label: city, color: getAvatarColor(city) });
    }
    return options;
  }, [clients, cities]);

  const tagOptions = useMemo<FacetOption[]>(() => {
    // Весь справочник тегов, не только назначенные.
    return tags.map((t) => ({ value: t.id, label: t.name, color: t.color }));
  }, [tags]);

  // ── Предикаты (замыкания на текущем состоянии) ───────────────────
  const passesSearch = useMemo(() => {
    const q = search.trim();
    return (c: Client) => (q ? matchesClient(c, search) : true);
  }, [search]);

  const passesSegment = useMemo(() => {
    // OR по выбранным статусам («список на обзвон»: любой из выбранных) —
    // единая семантика с Метка/Теги/Команда. AND давал ловушку: второй
    // статус сужал в ноль, а счётчиков, объяснявших это, на контролах
    // больше нет (решение владельца 2026-07-22).
    return (c: Client): boolean => {
      if (segments.length === 0) return true;
      const s = statsMap.get(c.id);
      return segments.some((seg) => matchesSegment(c, seg, s));
    };
  }, [segments, statsMap]);

  const passesPeriod = useMemo(() => {
    return (c: Client): boolean => {
      if (!period) return true;
      const dates = index.clientApptDates.get(c.id) ?? [];
      // ЛЮБАЯ запись внутри [from, to] включительно.
      return dates.some((d) => d >= period.from && d <= period.to);
    };
  }, [period, index]);

  const passesTeam = useMemo(() => {
    const sel = selectedTeams;
    return (c: Client): boolean => {
      if (sel.length === 0) return true;
      const set = index.clientTeams.get(c.id);
      if (!set || set.size === 0) return false;
      return sel.some((id) => set.has(id));
    };
  }, [selectedTeams, index]);

  const passesCity = useMemo(() => {
    // Case-insensitive: опция несёт каноничное написание библиотеки, а
    // web/legacy-значение клиента может отличаться регистром.
    const sel = selectedCities.map((s) => s.trim().toLowerCase());
    return (c: Client): boolean => {
      if (sel.length === 0) return true;
      return sel.includes((c.city ?? "").trim().toLowerCase());
    };
  }, [selectedCities]);

  const passesTag = useMemo(() => {
    const sel = activeTags;
    // OR-внутри фасета — единая семантика с Команда/Метка: показать
    // клиентов с ЛЮБЫМ из выбранных тегов (между секциями остаётся AND).
    return (c: Client): boolean =>
      sel.length === 0 || sel.some((t) => c.tag_ids.includes(t));
  }, [activeTags]);

  // ── Сортировка ОТДЕЛЬНО от предикатов ────────────────────────────
  // Компаратор web'а (pinned-first + 3 ключа), но в мемо без
  // поисковых deps — фильтрация ниже сохраняет порядок.
  const sorted = useMemo(() => {
    return [...clients].sort((a, b) => {
      const aPinned = a.pinned_at ? 1 : 0;
      const bPinned = b.pinned_at ? 1 : 0;
      if (aPinned !== bPinned) return bPinned - aPinned;
      if (aPinned && bPinned) {
        return (b.pinned_at ?? "").localeCompare(a.pinned_at ?? "");
      }
      if (sort === "name") return a.full_name.localeCompare(b.full_name, "ru");
      if (sort === "revenue") {
        return (
          (statsMap.get(b.id)?.totalSpent ?? 0) -
          (statsMap.get(a.id)?.totalSpent ?? 0)
        );
      }
      const aDate = statsMap.get(a.id)?.lastVisitDate || a.created_at;
      const bDate = statsMap.get(b.id)?.lastVisitDate || b.created_at;
      return bDate.localeCompare(aDate);
    });
  }, [clients, sort, statsMap]);

  const filtered = useMemo(() => {
    return sorted.filter(
      (c) =>
        passesSearch(c) &&
        passesTag(c) &&
        passesSegment(c) &&
        passesTeam(c) &&
        passesCity(c) &&
        passesPeriod(c),
    );
  }, [
    sorted,
    passesSearch,
    passesTag,
    passesSegment,
    passesTeam,
    passesCity,
    passesPeriod,
  ]);

  // ── Токены summary-бара ──────────────────────────────────────────
  const activeTokens = useMemo<ActiveToken[]>(() => {
    const tokens: ActiveToken[] = [];
    for (const seg of segments) {
      const o = SEGMENT_OPTIONS.find((x) => x.key === seg);
      if (o)
        tokens.push({ key: "segment", val: seg, label: o.label, color: "" });
    }
    const teamLabel = new Map(teamOptions.map((o) => [o.value, o]));
    for (const id of selectedTeams) {
      const o = teamLabel.get(id);
      if (o)
        tokens.push({ key: "team", val: id, label: o.label, color: o.color });
    }
    const cityColor = new Map(cityOptions.map((o) => [o.value, o.color]));
    for (const city of selectedCities) {
      tokens.push({
        key: "city",
        val: city,
        label: city,
        // Цвет метки из библиотеки (как в календаре); legacy — avatar-цвет.
        color: cityColor.get(city) ?? getAvatarColor(city),
      });
    }
    const tagLabel = new Map(tagOptions.map((o) => [o.value, o]));
    for (const id of activeTags) {
      const o = tagLabel.get(id);
      if (o)
        tokens.push({ key: "tag", val: id, label: o.label, color: o.color });
    }
    if (period) {
      tokens.push({
        key: "period",
        val: period.preset,
        label: periodLabel(period),
        color: "",
      });
    }
    return tokens;
  }, [
    segments,
    selectedTeams,
    selectedCities,
    activeTags,
    period,
    teamOptions,
    cityOptions,
    tagOptions,
  ]);

  const activeCount =
    selectedTeams.length +
    selectedCities.length +
    activeTags.length +
    (period ? 1 : 0) +
    segments.length;

  return {
    filtered,
    activeTokens,
    activeCount,
    teamOptions,
    cityOptions,
    tagOptions,
  };
}

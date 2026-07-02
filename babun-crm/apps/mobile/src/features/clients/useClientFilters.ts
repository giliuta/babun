import { useMemo } from "react";
import type { Client, ClientTag } from "@babun/shared/local/clients";
import type { Appointment } from "@babun/shared/local/appointments";
import {
  type ClientStats,
  isLongSilence,
  isLoyalClient,
  isNewClient,
} from "@babun/shared/local/selectors/client-stats";
import { matchesClient } from "@babun/shared/local/selectors/client-search";
import { getAvatarColor } from "@babun/shared/common/utils/avatar-color";
import {
  acCount,
  periodLabel,
  SEGMENT_OPTIONS,
  type ActiveToken,
  type ClientsFilter,
  type FacetOption,
} from "./filter";

// Волна 2 — порт web useClientFilters (v812): один хук владеет
// отфильтрованным списком, контекстными счётчиками фасетов и токенами
// бара. Отличие от веба — структура мемо: сортировка живёт в СВОЁМ
// useMemo (deps: clients/sort/statsMap), а предикаты применяются к уже
// отсортированному списку. Фильтр сохраняет порядок → результат
// идентичен вебу, но клавиатурный ввод в поиске НЕ перегоняет
// O(n log n) localeCompare-компаратор (фикс Волны 1 — не откатывать).

export interface ClientFilterResult {
  /** Итоговый отсортированный+отфильтрованный список. */
  filtered: Client[];
  /** Контекстные счётчики значений фасетов (только при открытой панели). */
  facetCounts: {
    team: Record<string, number>;
    city: Record<string, number>;
    tag: Record<string, number>;
  };
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

const EMPTY_FACET_COUNTS: ClientFilterResult["facetCounts"] = {
  team: {},
  city: {},
  tag: {},
};

interface ApptIndex {
  /** clientId → множество team_id по записям клиента. */
  clientTeams: Map<string, Set<string>>;
  /** clientId → список дат записей (YYYY-MM-DD). */
  clientApptDates: Map<string, string[]>;
}

/** Один проход по записям — два индекса по клиенту. Включая fallback по
 *  имени в comment для seed-записей с client_id:null (как buildStatsMap). */
function buildApptIndex(
  clients: Client[],
  appointments: Appointment[],
): ApptIndex {
  const byId = new Map<string, Appointment[]>();
  const orphanByName = new Map<string, Appointment[]>();
  for (const a of appointments) {
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

export function useClientFilters(
  clients: Client[],
  appointments: Appointment[],
  teams: TeamLike[],
  tags: ClientTag[],
  statsMap: Map<string, ClientStats>,
  filter: ClientsFilter,
  search: string,
  /** Счётчики фасетов нужны только открытой панели — иначе пропускаем. */
  panelOpen: boolean,
): ClientFilterResult {
  const { sort, segment, selectedTeams, selectedCities, activeTags, period } =
    filter;

  const index = useMemo(
    () => buildApptIndex(clients, appointments),
    [clients, appointments],
  );

  // ── Опции фасетов ────────────────────────────────────────────────
  const teamOptions = useMemo<FacetOption[]>(() => {
    // Только команды, которыми реально пользовался хоть один клиент.
    const used = new Set<string>();
    for (const set of index.clientTeams.values()) {
      for (const t of set) used.add(t);
    }
    return teams
      .filter((t) => used.has(t.id))
      .map((t) => ({
        value: t.id,
        label: t.name,
        // Supabase-row может держать color=null — точка не должна пропасть.
        color: t.color ?? getAvatarColor(t.name),
      }));
  }, [teams, index]);

  const cityOptions = useMemo<FacetOption[]>(() => {
    const set = new Set<string>();
    for (const c of clients) {
      const city = (c.city ?? "").trim();
      if (city) set.add(city);
    }
    return [...set]
      .sort((a, b) => a.localeCompare(b, "ru"))
      .map((city) => ({ value: city, label: city, color: getAvatarColor(city) }));
  }, [clients]);

  const tagOptions = useMemo<FacetOption[]>(() => {
    const used = new Set<string>();
    for (const c of clients) {
      for (const tid of c.tag_ids) used.add(tid);
    }
    return tags
      .filter((t) => used.has(t.id))
      .map((t) => ({ value: t.id, label: t.name, color: t.color }));
  }, [tags, clients]);

  // ── Предикаты (замыкания на текущем состоянии) ───────────────────
  const passesSearch = useMemo(() => {
    const q = search.trim();
    return (c: Client) => (q ? matchesClient(c, search) : true);
  }, [search]);

  const passesSegment = useMemo(() => {
    return (c: Client): boolean => {
      if (segment === "all") return true;
      const s = statsMap.get(c.id);
      if (segment === "debt") return (s?.debt ?? 0) > 0 || c.balance < 0;
      if (segment === "birthday") {
        const dd = s?.birthdayInDays ?? null;
        return dd !== null && dd <= 14;
      }
      if (segment === "blacklist") return c.blacklisted;
      if (segment === "silent") return s ? isLongSilence(s) : false;
      if (segment === "new") return s ? isNewClient(s) : false;
      if (segment === "loyal") return s ? isLoyalClient(s) : false;
      return true;
    };
  }, [segment, statsMap]);

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
    const sel = selectedCities;
    return (c: Client): boolean => {
      if (sel.length === 0) return true;
      return sel.includes((c.city ?? "").trim());
    };
  }, [selectedCities]);

  const passesTag = useMemo(() => {
    const sel = activeTags;
    // AND-семантика — каждый выбранный тег обязателен (web parity).
    return (c: Client): boolean =>
      sel.length === 0 || sel.every((t) => c.tag_ids.includes(t));
  }, [activeTags]);

  // ── Сортировка ОТДЕЛЬНО от предикатов ────────────────────────────
  // Компаратор web'а дословно (pinned-first + 4 ключа), но в мемо без
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
      if (sort === "equipment") return acCount(b) - acCount(a);
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

  // ── Контекстные счётчики фасетов ─────────────────────────────────
  // Счётчик значения = клиенты, проходящие поиск + сегмент + период +
  // ВСЕ ДРУГИЕ активные фасеты, ИСКЛЮЧАЯ считаемый фасет.
  const facetCounts = useMemo(() => {
    if (!panelOpen) return EMPTY_FACET_COUNTS;
    const base = clients.filter(
      (c) => passesSearch(c) && passesSegment(c) && passesPeriod(c),
    );

    const countTeam: Record<string, number> = {};
    {
      const pool = base.filter((c) => passesCity(c) && passesTag(c));
      for (const opt of teamOptions) {
        let n = 0;
        for (const c of pool) {
          const set = index.clientTeams.get(c.id);
          if (set && set.has(opt.value)) n += 1;
        }
        countTeam[opt.value] = n;
      }
    }

    const countCity: Record<string, number> = {};
    {
      const pool = base.filter((c) => passesTeam(c) && passesTag(c));
      for (const opt of cityOptions) {
        let n = 0;
        for (const c of pool) {
          if ((c.city ?? "").trim() === opt.value) n += 1;
        }
        countCity[opt.value] = n;
      }
    }

    const countTag: Record<string, number> = {};
    {
      const pool = base.filter((c) => passesTeam(c) && passesCity(c));
      for (const opt of tagOptions) {
        let n = 0;
        for (const c of pool) {
          if (c.tag_ids.includes(opt.value)) n += 1;
        }
        countTag[opt.value] = n;
      }
    }

    return { team: countTeam, city: countCity, tag: countTag };
  }, [
    panelOpen,
    clients,
    passesSearch,
    passesSegment,
    passesPeriod,
    passesTeam,
    passesCity,
    passesTag,
    teamOptions,
    cityOptions,
    tagOptions,
    index,
  ]);

  // ── Токены summary-бара ──────────────────────────────────────────
  const activeTokens = useMemo<ActiveToken[]>(() => {
    const tokens: ActiveToken[] = [];
    if (segment !== "all") {
      const seg = SEGMENT_OPTIONS.find((o) => o.key === segment);
      if (seg) {
        tokens.push({ key: "segment", val: segment, label: seg.label, color: "" });
      }
    }
    const teamLabel = new Map(teamOptions.map((o) => [o.value, o]));
    for (const id of selectedTeams) {
      const o = teamLabel.get(id);
      if (o) tokens.push({ key: "team", val: id, label: o.label, color: o.color });
    }
    for (const city of selectedCities) {
      tokens.push({
        key: "city",
        val: city,
        label: city,
        color: getAvatarColor(city),
      });
    }
    const tagLabel = new Map(tagOptions.map((o) => [o.value, o]));
    for (const id of activeTags) {
      const o = tagLabel.get(id);
      if (o) tokens.push({ key: "tag", val: id, label: o.label, color: o.color });
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
  }, [segment, selectedTeams, selectedCities, activeTags, period, teamOptions, tagOptions]);

  const activeCount =
    selectedTeams.length +
    selectedCities.length +
    activeTags.length +
    (period ? 1 : 0) +
    (segment !== "all" ? 1 : 0);

  return {
    filtered,
    facetCounts,
    activeTokens,
    activeCount,
    teamOptions,
    cityOptions,
    tagOptions,
  };
}

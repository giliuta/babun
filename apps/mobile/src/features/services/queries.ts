import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { Database, Json } from "@babun/shared/db/database.types";
import { generateId } from "@babun/shared/local/masters";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";
import { useCurrentRole } from "@/features/settings/tenant";
import {
  dispatcherServiceJsonToService,
  masterServiceJsonToService,
} from "@/features/settings/master-reference";

// Services live in the canonical `services` table (text PK, was localStorage-
// only before the migration). No shared repo yet — query the typed client
// directly. Same pattern will cover teams / masters / cities.
export type Service = Database["public"]["Tables"]["services"]["Row"];

// СПИСКА БРИГАД У УСЛУГИ БОЛЬШЕ НЕТ (владелец 2026-08-17: «услуга принадлежит
// только одной команде, во второй команде это их услуги»). Колонка
// `brigade_ids` осталась в базе историческим грузом, продукт её не читает:
// владелец живёт в `services.team_id`. Из прежней «пустой список = делают все»
// росли два дефекта — услуга распущенной команды показывала пустой ряд чипов
// (владельца не видно и не выбрать), а удаление такой услуги с экрана команды
// уносило её у всех команд разом.

function isMissingProjectionRpc(error: {
  code?: string;
  message?: string;
}): boolean {
  return error.code === "PGRST202" || /could not find the function/i.test(error.message ?? "");
}

async function listMasterServices(tenantId: string): Promise<Service[]> {
  const { data, error } = await supabase.rpc("list_master_services_safe");
  if (!error) return (data ?? []).map(masterServiceJsonToService);
  if (!isMissingProjectionRpc(error)) throw new Error(error.message);

  // Rolling-deploy fallback against the older member-wide RLS policy. The
  // explicit projection prevents service economics from crossing the wire.
  const fallback = await supabase
    .from("services")
    .select("id, tenant_id, name, color")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .order("position");
  if (fallback.error) throw new Error(fallback.error.message);
  return (fallback.data ?? []).map((row) =>
    masterServiceJsonToService(row as unknown as Json),
  );
}

async function listDispatcherServices(tenantId: string): Promise<Service[]> {
  const { data, error } = await supabase.rpc(
    "list_dispatcher_services_safe",
  );
  if (!error) return (data ?? []).map(dispatcherServiceJsonToService);
  if (!isMissingProjectionRpc(error)) throw new Error(error.message);

  const fallback = await supabase
    .from("services")
    .select(
      "id, tenant_id, team_id, name, color, description, price, duration_minutes, cost_per_unit, cost_tiers, price_tiers, duration_tiers, bulk_threshold, bulk_price, is_active, position, created_at, updated_at",
    )
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .order("position");
  if (fallback.error) throw new Error(fallback.error.message);
  return (fallback.data ?? []).map((row) =>
    dispatcherServiceJsonToService(row as unknown as Json),
  );
}

export function useServices() {
  const tenantId = useTenantId();
  const roleQuery = useCurrentRole();
  const role = roleQuery.data;
  return useQuery({
    queryKey: ["services", tenantId, role ?? "role-pending"],
    enabled: !!tenantId && roleQuery.isSuccess && role != null,
    queryFn: async () => {
      if (role === "master") {
        return listMasterServices(tenantId as string);
      }
      if (role === "dispatcher") {
        return listDispatcherServices(tenantId as string);
      }
      const { data, error } = await supabase
        .from("services")
        .select("*")
        .eq("tenant_id", tenantId as string)
        .eq("is_active", true)
        .order("position");
      if (error) throw new Error(error.message);
      return data;
    },
  });
}

/** ПРОШЛОЕ ЧИТАЮТ ПО ПОЛНОМУ СПРАВОЧНИКУ (аудит 2026-08-21; расширено 2026-08-24).
 *
 *  `useServices()` фильтрует `is_active = true` — и правильно делает: каталог
 *  ВЫБОРА не должен предлагать убранное. Но прошлое читают ещё полтора десятка
 *  мест — лист записи, наряд команды, лента клиента, «Топ услуг», генератор
 *  счёта, расход материалов в финансах, — и для них тот же фильтр означал, что
 *  убранная услуга теряет имя ВЕЗДЕ и печатается заглушкой «Услуга», а её
 *  расход молча становится нулём. Алерт удаления при этом обещал обратное.
 *
 *  Здесь список БЕЗ фильтра активности — для ЧТЕНИЯ уже случившегося. Заводить,
 *  править и предлагать к выбору по-прежнему можно лишь живые услуги.
 *
 *  Роль важна: мастеру и диспетчеру отдают проекции, которые прячут экономику,
 *  и обходить их нельзя — поэтому для них возвращается ровно то же, что и в
 *  `useServices` (их проекции и так не фильтруют по активности иначе). */
export function useAllServices() {
  const tenantId = useTenantId();
  const roleQuery = useCurrentRole();
  const role = roleQuery.data;
  return useQuery({
    queryKey: ["services", "with-archived", tenantId, role ?? "role-pending"],
    enabled: !!tenantId && roleQuery.isSuccess && role != null,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      if (role === "master") return listMasterServices(tenantId as string);
      if (role === "dispatcher") return listDispatcherServices(tenantId as string);
      const { data, error } = await supabase
        .from("services")
        .select("*")
        .eq("tenant_id", tenantId as string)
        .order("position");
      if (error) throw new Error(error.message);
      return data;
    },
  });
}

export interface ServiceInput {
  name: string;
  price: number;
  duration_minutes: number;
  /** Команда-владелец. Обязательна: услуга без команды не появится ни в одном
   *  каталоге записи. */
  team_id: string;
  /** Цвет услуги. Возвращён 2026-08-17 ВМЕСТЕ С ЧИТАТЕЛЯМИ: точка в прайсе,
   *  точка в каталоге выбора и подстановка в цвет записи, когда человек не
   *  выбрал свой. Без читателя цвет заводить нельзя — так он и был убран. */
  color?: string;
  /** КАТЕГОРИИ У УСЛУГИ НЕТ (владелец 2026-08-17): `category_id` жива ради
   *  легаси-веба, продукт её не пишет — категория была коробкой ради коробки,
   *  ноль строк у всех тенантов за пять месяцев.
   *
   *  ЦВЕТ — ПИШЕТСЯ, и комментарий выше об этом врал (найдено 2026-08-25).
   *  Он вернулся 17 августа ВМЕСТЕ С ЧИТАТЕЛЯМИ и сейчас их трое: точка в
   *  строке прайса, точка в каталоге выбора при записи и подстановка в цвет
   *  записи, когда человек не выбрал свой. Правило «часть заводим, только
   *  если её кто-то читает» соблюдено — врал именно текст. */
  /** Место в прайсе. Пишется ПРИ СОЗДАНИИ: каталог читается
   *  `.order("position")`, а вставка её не задавала — у всех услуг стоял ноль
   *  из дефолта колонки, и порядок списка выбирал Postgres, меняя его между
   *  обновлениями. Дальше позицию двигает перетаскивание. */
  position?: number;
  /** Расход за одну у первой строки. Писатель вернулся 2026-08-21 уже
   *  колонкой таблицы («короче делай ещё расход колонку»), а не полем
   *  «Материалы, €», которое сносили: тогда это была одинокая цифра без
   *  количества, теперь — та же лестница, что у цены и времени. */
  cost_per_unit?: number;
  /** Расход на количествах: [{min_qty, cost_per_unit}]. Пустой массив, а не
   *  `null` — колонка `not null default '[]'`. */
  cost_tiers?: { min_qty: number; cost_per_unit: number }[];
  /** Описание услуги. Печатается второй строкой под названием позиции в
   *  счёте — без этой дороги колонка не заводилась бы (закон 2026-08-21). */
  description?: string | null;
  price_tiers?: Service["price_tiers"];
  duration_tiers?: Service["duration_tiers"];
  bulk_threshold?: number;
  bulk_price?: number;
  /** ЕДИНИЦА ИЗМЕРЕНИЯ — ПОДПИСЬ К ЧИСЛУ НА БУМАГЕ КЛИЕНТА (возвращена
   *  2026-08-25 вместе с колонкой счёта). `null` — «продаём штуками и слово
   *  лишнее», и тогда всё печатается голым числом, как раньше. В расчётах не
   *  участвует НИГДЕ: 120 × €2 считается одинаково, метры это или штуки. */
  unit?: string | null;
  /** Линза показа: `total` — числа листа «за всё», `unit` — «за одну».
   *  Хранение не меняется ни в одном режиме, меняется только то, что человек
   *  видит и печатает. */
  price_entry?: "total" | "unit";
  /** Дни недели, по которым услугу делают (ISO 1..7). Пустой массив — любой
   *  день. Читатель ровно один: каталог выбора услуги в записи. */
  available_weekdays?: number[];
  /** «Количество» или «Варианты» — тип решает всё остальное устройство листа
   *  и способ расчёта. */
  service_type?: "quantity" | "variant";
  /** ВРЕМЯ ВОКРУГ РАБОТЫ. Слот в календаре = дорога + работа + уборка за
   *  собой; без буферов сетка показывает свободное время, которого нет. */
  buffer_before_min?: number;
  buffer_after_min?: number;
  required_staff?: number;
  /** Правило за последним порогом: «свыше 3 шт — плюс €45 и плюс 20 минут за
   *  каждую». Без него продукт называет числа, которых никто не вводил. */
  overflow_price?: number | null;
  overflow_duration_min?: number | null;
  min_qty?: number;
  max_qty?: number | null;
  /** Услуга скопирована из другой команды — мягкая связь для отчётов. */
  copied_from_service_id?: string | null;
}

export function useCreateService() {
  const tenantId = useTenantId();
  const role = useCurrentRole().data;
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ServiceInput) => {
      if (role !== "owner") {
        throw new Error("Создавать услуги может только владелец.");
      }
      const { data, error } = await supabase
        .from("services")
        .insert({
          id: generateId("svc"),
          tenant_id: tenantId as string,
          name: input.name,
          team_id: input.team_id,
          price: input.price,
          duration_minutes: input.duration_minutes,
          ...(input.color ? { color: input.color } : {}),
          ...(input.description !== undefined
            ? { description: input.description }
            : {}),
          ...(input.cost_per_unit !== undefined
            ? { cost_per_unit: input.cost_per_unit }
            : {}),
          ...(input.cost_tiers !== undefined
            ? { cost_tiers: input.cost_tiers }
            : {}),
          ...(input.position !== undefined ? { position: input.position } : {}),
          ...(input.price_tiers !== undefined
            ? { price_tiers: input.price_tiers }
            : {}),
          ...(input.duration_tiers !== undefined
            ? { duration_tiers: input.duration_tiers }
            : {}),
          ...(input.bulk_threshold !== undefined
            ? { bulk_threshold: input.bulk_threshold }
            : {}),
          ...(input.bulk_price !== undefined
            ? { bulk_price: input.bulk_price }
            : {}),
          // ЭТИ ТРИ УЕЗЖАЮТ ВСЕГДА, А НЕ ПО `!== undefined`. На частичном
          // патче в этом продукте подрывались дважды (`bulk_*`, `description`):
          // снятая единица обязана писаться явным `null`, снятые дни — явным
          // пустым массивом, иначе прошлое значение воскресает.
          unit: input.unit ?? null,
          price_entry: input.price_entry ?? "total",
          available_weekdays: input.available_weekdays ?? [],
          service_type: input.service_type ?? "quantity",
          buffer_before_min: input.buffer_before_min ?? 0,
          buffer_after_min: input.buffer_after_min ?? 0,
          required_staff: input.required_staff ?? 1,
          overflow_price: input.overflow_price ?? null,
          overflow_duration_min: input.overflow_duration_min ?? null,
          min_qty: input.min_qty ?? 1,
          max_qty: input.max_qty ?? null,
          ...(input.copied_from_service_id
            ? { copied_from_service_id: input.copied_from_service_id }
            : {}),
        })
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["services"] }),
    meta: { errorHandled: true }, // RefListScreen call sites alert themselves
  });
}

/**
 * ПОРЯДОК УСЛУГ РЕШАЕТ ЧЕЛОВЕК. Каталог и раньше читался `.order("position")`,
 * но переставлять было нечем — список стоял в порядке заведения. Наверх
 * кладут то, что продают каждый день, и это заменило категории услуг
 * (владелец 2026-08-17: «зачем придумывать категорию для неё»). Позиции
 * пишутся всем строкам разом: половина списка с новым номером и половина со
 * старым — это не порядок, а лотерея.
 */
export function useReorderServices() {
  const tenantId = useTenantId();
  const role = useCurrentRole().data;
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: readonly string[]) => {
      if (!tenantId) throw new Error("Нет активного аккаунта.");
      if (role !== "owner") {
        throw new Error("Менять порядок услуг может только владелец.");
      }
      await Promise.all(
        ids.map(async (id, index) => {
          const { error } = await supabase
            .from("services")
            .update({ position: index })
            .eq("tenant_id", tenantId)
            .eq("id", id);
          if (error) throw new Error(error.message);
        }),
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["services"] }),
    meta: { errorHandled: true },
  });
}

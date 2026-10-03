import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { getStorage } from "@babun/shared/storage";
import { getNotificationsModule } from "@/lib/notifications";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";
import { useTeams } from "@/features/reference/queries";
import { useDataRole } from "@/features/settings/tenant";
import { useSession } from "@/providers/SessionProvider";
import type { ChangeLogRow } from "./change-log";
import { activityNotification, shouldNotify } from "./notification-prefs";
import { readTeamNotifyPrefs } from "./notification-prefs-cache";

// ЧТО ПРОИСХОДИТ В КОМАНДЕ — УВЕДОМЛЕНИЯ ИЗ ИСТОРИИ ИЗМЕНЕНИЙ (владелец 03.10:
// «уведомления настраиваем чётко на эту команду»).
//
// Сервер пушей на iPhone пока не шлёт (нужен ключ Apple), поэтому, пока
// приложение открыто, телефон сам раз в полминуты — и при каждом возвращении
// в приложение — читает новые строки журнала `change_log` и по настройкам
// команды показывает уведомление: «Запись создана · Y&D / Анастасия · 4 окт,
// 14:00 — Иван». Свои действия не присылаются. Больше трёх за раз — одно
// сводное. Старше 12 часов — не присылаются: после долгого перерыва это уже
// история, а не новость. Журнал читает владелец аккаунта.

const POLL_MS = 30_000;
const FRESH_MS = 12 * 60 * 60 * 1000;
const lastSeenKey = (tenantId: string) => `babun:teamActivity.lastSeen.${tenantId}`;

const COLUMNS =
  "id, team_id, actor_id, actor_name, entity, entity_id, action, label, meta, changes, created_at";

async function present(content: { title: string; body: string; data?: Record<string, unknown> }) {
  const Notifications = getNotificationsModule();
  if (!Notifications) return;
  try {
    const permission = await Notifications.getPermissionsAsync();
    if (!permission.granted) return;
    await Notifications.scheduleNotificationAsync({
      content: { title: content.title, body: content.body, sound: "default", data: content.data ?? {} },
      trigger: null,
    });
  } catch {
    // Нет модуля или iOS отказал — история всё равно в Кабинете.
  }
}

export function TeamActivityNotifier() {
  const tenantId = useTenantId();
  const role = useDataRole().data;
  const { session } = useSession();
  const me = session?.user?.id ?? null;
  const { data: teams = [] } = useTeams();
  const teamsRef = useRef(teams);
  teamsRef.current = teams;

  useEffect(() => {
    if (role !== "owner" || !tenantId || !me) return;
    let busy = false;
    let cancelled = false;

    const tick = async () => {
      if (busy || cancelled || AppState.currentState !== "active") return;
      busy = true;
      try {
        const storage = getStorage();
        const last = storage.get<number>(lastSeenKey(tenantId));
        if (last == null) {
          // Первый запуск — точка отсчёта, без старых новостей.
          const { data } = await supabase
            .from("change_log")
            .select("id")
            .eq("tenant_id", tenantId)
            .order("id", { ascending: false })
            .limit(1);
          storage.set(lastSeenKey(tenantId), data?.[0]?.id ?? 0);
          return;
        }
        const { data, error } = await supabase
          .from("change_log")
          .select(COLUMNS)
          .eq("tenant_id", tenantId)
          .gt("id", last)
          .order("id", { ascending: true })
          .limit(100);
        if (error || !data || data.length === 0) return;
        const rows = data as ChangeLogRow[];
        storage.set(lastSeenKey(tenantId), rows[rows.length - 1].id);
        const now = Date.now();
        const fresh = rows.filter(
          (row) =>
            now - Date.parse(row.created_at) < FRESH_MS &&
            shouldNotify(row, readTeamNotifyPrefs(row.team_id), me),
        );
        if (fresh.length === 0) return;
        const teamName = (id: string | null) =>
          id ? (teamsRef.current.find((x) => x.id === id)?.name ?? null) : null;
        if (fresh.length > 3) {
          const names = [...new Set(fresh.map((r) => teamName(r.team_id)).filter(Boolean))];
          await present({
            title: `${fresh.length} изменений в командах`,
            body: names.length > 0 ? names.join(", ") : "Откройте историю изменений",
          });
          return;
        }
        for (const row of fresh) {
          const { title, body } = activityNotification(row, teamName(row.team_id), row.actor_name);
          const date = typeof row.meta?.date === "string" ? row.meta.date : null;
          await present({
            title,
            body,
            data:
              row.entity === "appointments" && row.action !== "delete" && row.entity_id && date
                ? {
                    type: "calendar-appointment",
                    appointmentId: row.entity_id,
                    date,
                    teamId: row.team_id,
                  }
                : undefined,
          });
        }
      } catch {
        // Сеть пропала — следующая попытка через полминуты.
      } finally {
        busy = false;
      }
    };

    void tick();
    const timer = setInterval(() => void tick(), POLL_MS);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void tick();
    });
    return () => {
      cancelled = true;
      clearInterval(timer);
      sub.remove();
    };
  }, [role, tenantId, me]);

  return null;
}

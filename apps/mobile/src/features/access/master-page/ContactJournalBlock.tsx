import { useQuery } from "@tanstack/react-query";
import { useRouter, type Href } from "expo-router";

import { NavRow } from "@/components/ui/card-rows";
import { SectionCard } from "@/components/ui/SectionCard";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";
import { useThemeColors } from "@/theme/colors";

import {
  DAILY_CONTACTS_LIMIT,
  alertWords,
  countedLastDay,
  outcomeWord,
  whenWords,
  type ContactAlert,
  type ContactView,
} from "./contact-journal";

// БЛОК «НОМЕРА КЛИЕНТОВ» НА СТРАНИЦЕ СОТРУДНИКА (защита базы 30.09):
// сколько номеров он открыл за сутки из лимита, тревоги «много за час» и
// последние открытия — кому и когда. Тап по строке — карточка клиента.
// Пусто и номера ему закрыты — блока нет: показывать нечего.

const DAYS = 30;
const SHOWN = 10;

type Untyped = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        eq: (column: string, value: string) => {
          gte: (column: string, value: string) => {
            order: (column: string, options: { ascending: boolean }) => {
              limit: (n: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
            };
          };
        };
      };
    };
  };
};

interface Journal {
  views: ContactView[];
  alerts: ContactAlert[];
  names: Map<string, string>;
}

async function readJournal(tenantId: string, userId: string): Promise<Journal> {
  const db = supabase as unknown as Untyped;
  const since = new Date(Date.now() - DAYS * 86_400_000).toISOString();
  const [views, alerts] = await Promise.all([
    db
      .from("client_contact_views")
      .select("client_id, outcome, counted, opened_at")
      .eq("tenant_id", tenantId)
      .eq("user_id", userId)
      .gte("opened_at", since)
      .order("opened_at", { ascending: false })
      .limit(500),
    db
      .from("client_contact_alerts")
      .select("kind, clients_count, created_at")
      .eq("tenant_id", tenantId)
      .eq("user_id", userId)
      .gte("created_at", new Date(Date.now() - 7 * 86_400_000).toISOString())
      .order("created_at", { ascending: false })
      .limit(3),
  ]);
  if (views.error) throw new Error(`contactJournal: ${views.error.message}`);
  if (alerts.error) throw new Error(`contactJournal: ${alerts.error.message}`);
  const rows = (views.data ?? []) as ContactView[];
  const ids = [...new Set(rows.slice(0, SHOWN).map((row) => row.client_id))];
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const { data } = await supabase.from("clients").select("id, full_name").in("id", ids);
    for (const row of data ?? []) names.set(row.id, row.full_name || "Без имени");
  }
  return { views: rows, alerts: (alerts.data ?? []) as ContactAlert[], names };
}

export function ContactJournalBlock({
  userId,
  contactsOpen,
}: {
  userId: string;
  /** Открыт ли ему «Телефон» хоть в одной команде. */
  contactsOpen: boolean;
}) {
  const t = useThemeColors();
  const router = useRouter();
  const tenantId = useTenantId();
  const query = useQuery({
    queryKey: ["contact-journal", tenantId ?? "", userId],
    enabled: !!tenantId,
    staleTime: 30_000,
    queryFn: () => readJournal(tenantId as string, userId),
  });
  const journal = query.data;
  if (!journal) return null;
  const { views, alerts, names } = journal;
  if (views.length === 0 && alerts.length === 0 && !contactsOpen) return null;
  const now = new Date();
  const today = countedLastDay(views, now);

  return (
    <SectionCard title="Номера клиентов" padded={false}>
      <NavRow
        label="За сутки"
        value={`${today} из ${DAILY_CONTACTS_LIMIT}`}
        valueColor={today >= DAILY_CONTACTS_LIMIT ? t.danger : undefined}
      />
      {alerts.map((alert, i) => (
        <NavRow
          key={`alert-${i}`}
          label={alertWords(alert)}
          value={whenWords(alert.created_at, now)}
          valueColor={t.warning}
          separated
        />
      ))}
      {views.length === 0 ? (
        <NavRow label="Пока не открывал" separated dimmed />
      ) : (
        views.slice(0, SHOWN).map((view, i) => {
          const word = outcomeWord(view.outcome);
          const when = whenWords(view.opened_at, now);
          return (
            <NavRow
              key={`${view.client_id}-${view.opened_at}-${i}`}
              label={names.get(view.client_id) ?? "Клиент удалён"}
              value={word ? `${when} · ${word}` : when}
              valueColor={word ? t.warning : undefined}
              separated
              onPress={
                names.has(view.client_id)
                  ? () => router.push(`/clients/${view.client_id}` as Href)
                  : undefined
              }
            />
          );
        })
      )}
    </SectionCard>
  );
}

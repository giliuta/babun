import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import type { Appointment } from "@babun/shared/local/appointments";
import type { ClientStats } from "@babun/shared/local/selectors/client-stats";
import { DEFAULT_BLOCK_ORDER } from "@babun/shared/local/business-blocks";
import { formatEUR } from "@babun/shared/common/utils/money";
import { CollapsibleCard } from "@/features/clients/card-collapse";
import { formatShortDateRu, formatVisitDate } from "@/features/clients/format";
import { useThemeColors } from "@/theme/colors";

// VisitsBlock (mobile port of apps/web/.../blocks/VisitsBlock.tsx).
//
// Reference block (CollapsibleCard) — open on first visit (shared
// DEFAULT_BLOCK_ORDER), user's toggle persists in MMKV; the closed row
// shows «N · был {дата}». Expanded: appointment history newest-first, with
// status + payment pills and the amount. Tapping a row jumps to the calendar
// focused on that visit's date (web pushed /dashboard?date=…; mobile
// routes to the dashboard tab with the same query param).
//
// Web parity: the summary resolves service NAMES from the `services` catalog
// (passed by the card composer). Still DEGRADED vs web: the «Повторить»
// one-tap repeat button is dropped — it built a /dashboard?new= deep link the
// mobile new-appointment flow doesn't accept yet (see calendar create-flow).
//
// `stats` is accepted for prop-contract parity with the other blocks; this
// block derives everything it shows straight off `appointments`.

interface VisitsBlockProps {
  appointments: Appointment[];
  // Only id+name are read (catalog lookup) — structural type so both the
  // Supabase-row service shape (useServices) and the shared Service fit.
  services?: readonly { id: string; name: string }[];
  stats?: ClientStats;
}

// Loyal clients carry dozens of visits; mounting 50 rows synchronously
// inside the card's shared ScrollView noticeably delays opening it, so
// we start collapsed at 10 and expand to LIMIT on demand.
const INITIAL = 10;
const LIMIT = 50;

// Web parity: visits expand on first visit (DEFAULT_BLOCK_ORDER.visits
// defaultOpen=true); once the user toggles, MMKV persistence wins.
const VISITS_DEFAULT_OPEN =
  DEFAULT_BLOCK_ORDER.find((b) => b.kind === "visits")?.defaultOpen ?? true;

export default function VisitsBlock({
  appointments,
  services = [],
  stats,
}: VisitsBlockProps) {
  const router = useRouter();
  const t = useThemeColors();
  const [showAll, setShowAll] = useState(false);

  // Web parity (apps/web/.../VisitsBlock servicesById): id → name lookup so
  // each visit row shows the service name instead of a bare count.
  const servicesById = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of services) m.set(s.id, s.name);
    return m;
  }, [services]);

  const own = useMemo(
    () =>
      [...appointments].sort((a, b) =>
        `${b.date}${b.time_start}`.localeCompare(`${a.date}${a.time_start}`),
      ),
    [appointments],
  );

  const shown = own.slice(0, showAll ? LIMIT : INITIAL);

  // Collapsed-row summary: «8 · был 10 мая» (count · last completed visit).
  const summary =
    own.length === 0
      ? ""
      : stats?.lastVisitDate
        ? `${own.length} · был ${formatShortDateRu(stats.lastVisitDate)}`
        : `${own.length}`;

  return (
    <CollapsibleCard
      title="Визиты"
      summary={summary}
      kind="visits"
      defaultOpen={VISITS_DEFAULT_OPEN}
    >
      {own.length === 0 ? (
        <Text className="px-1 py-2 text-sm" style={{ color: t.faint }}>
          Записей пока нет.
        </Text>
      ) : (
        <View>
          {shown.map((apt) => (
            <VisitRow
              key={apt.id}
              apt={apt}
              servicesById={servicesById}
              onOpen={() =>
                router.push(
                  `/(dashboard)?date=${encodeURIComponent(apt.date)}`,
                )
              }
            />
          ))}
          {!showAll && own.length > INITIAL ? (
            <Pressable
              onPress={() => setShowAll(true)}
              className="items-center py-2.5 active:opacity-60"
              style={{ borderTopWidth: 1, borderTopColor: t.separator }}
            >
              <Text className="text-[13px] font-semibold" style={{ color: t.accent }}>
                Показать все ({Math.min(own.length, LIMIT)})
              </Text>
            </Pressable>
          ) : null}
          {showAll && own.length > LIMIT ? (
            <Text className="px-1 pt-2 text-center text-xs" style={{ color: t.faint }}>
              + ещё {own.length - LIMIT} визитов
            </Text>
          ) : null}
        </View>
      )}
    </CollapsibleCard>
  );
}

function VisitRow({
  apt,
  servicesById,
  onOpen,
}: {
  apt: Appointment;
  servicesById: Map<string, string>;
  onOpen: () => void;
}) {
  const t = useThemeColors();
  const status = statusPill(apt, t);
  const payment = paymentPill(apt, t);
  const summary = visitSummary(apt, servicesById);

  return (
    <Pressable
      onPress={onOpen}
      className="flex-row items-center gap-2 py-2.5 active:opacity-60"
      style={{ borderTopWidth: 1, borderTopColor: t.separator }}
    >
      <View className="min-w-0 flex-1">
        <Text className="text-sm" style={{ color: t.ink }} numberOfLines={1}>
          {summary}
        </Text>
        <Text className="text-xs" style={{ color: t.sub }}>
          {formatVisitDate(apt.date)} · {apt.time_start}
        </Text>
      </View>

      <View className="shrink-0 items-end gap-1">
        <View className="rounded-full px-2 py-0.5" style={{ backgroundColor: status.bg }}>
          <Text className="text-[10px] font-semibold" style={{ color: status.text }}>
            {status.label}
          </Text>
        </View>
        {payment ? (
          <View className="rounded-full px-2 py-0.5" style={{ backgroundColor: payment.bg }}>
            <Text className="text-[10px] font-semibold" style={{ color: payment.text }}>
              {payment.label}
            </Text>
          </View>
        ) : null}
      </View>

      <Text className="w-16 shrink-0 text-right text-sm font-bold" style={{ color: t.success }}>
        {formatEUR(apt.total_amount)}
      </Text>
    </Pressable>
  );
}

type PillColors = { label: string; bg: string; text: string };
type ThemeColors = ReturnType<typeof useThemeColors>;

function statusPill(apt: Appointment, t: ThemeColors): PillColors {
  switch (apt.status) {
    case "completed":
      return { label: "Выполнено", bg: `${t.success}26`, text: t.success };
    case "cancelled":
      return {
        label: "Отменено",
        bg: t.fill,
        text: t.sub,
      };
    case "in_progress":
      return { label: "В работе", bg: `${t.warning}26`, text: t.warning };
    default:
      return {
        label: "Запланировано",
        bg: `${t.accent}1a`,
        text: t.accent,
      };
  }
}

function paymentPill(
  apt: Appointment,
  t: ThemeColors,
): PillColors | null {
  if (apt.status !== "completed") return null;
  switch (apt.payment_status) {
    case "paid":
      return { label: "Оплачено", bg: `${t.success}26`, text: t.success };
    case "partial":
      return { label: "Частично", bg: `${t.warning}26`, text: t.warning };
    case "refunded":
      return { label: "Возврат", bg: `${t.danger}1a`, text: t.danger };
    case "unpaid":
      return { label: "К оплате", bg: `${t.warning}26`, text: t.warning };
    default:
      // Legacy fallback — rows older than the payment_status wiring.
      if (apt.payment) {
        return { label: "Оплачено", bg: `${t.success}26`, text: t.success };
      }
      return null;
  }
}

// Web parity (apps/web/.../VisitsBlock): distinct service NAMES for the visit
// summary — de-dupe by serviceId (legacy rows can repeat one), «Name» or
// «Name +N», falling back to the appointment comment.
function visitSummary(apt: Appointment, servicesById: Map<string, string>): string {
  const seen = new Set<string>();
  const named: string[] = [];
  for (const s of apt.services ?? []) {
    if (!s.serviceId || seen.has(s.serviceId)) continue;
    seen.add(s.serviceId);
    const name = servicesById.get(s.serviceId);
    if (name) named.push(name);
  }
  if (named.length > 0) {
    return named.length === 1 ? named[0] : `${named[0]} +${named.length - 1}`;
  }
  return apt.comment?.trim() || "—";
}

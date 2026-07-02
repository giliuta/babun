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
// DEGRADED vs web: the web summary string resolves service NAMES from a
// `services` catalog prop. Mobile doesn't wire the services catalog into
// the client card yet, so the summary falls back to a de-duped service
// COUNT («N услуг») or the appointment comment. The «Повторить» one-tap
// repeat button is also dropped (it built a /dashboard?new= deep link that
// the mobile new-appointment flow doesn't accept yet — see composer TODO).
//
// `stats` is accepted for prop-contract parity with the other blocks; this
// block derives everything it shows straight off `appointments`.

interface VisitsBlockProps {
  appointments: Appointment[];
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

export default function VisitsBlock({ appointments, stats }: VisitsBlockProps) {
  const router = useRouter();
  const t = useThemeColors();
  const [showAll, setShowAll] = useState(false);

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
  onOpen,
}: {
  apt: Appointment;
  onOpen: () => void;
}) {
  const t = useThemeColors();
  const status = statusPill(apt, t);
  const payment = paymentPill(apt, t);
  const summary = visitSummary(apt);

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

// Web resolves service names from a catalog; mobile lacks that wiring, so we
// de-dupe service ids and show a count, falling back to the comment.
function visitSummary(apt: Appointment): string {
  const ids = new Set(
    (apt.services ?? []).map((s) => s.serviceId).filter(Boolean),
  );
  if (ids.size > 0) {
    return `${ids.size} ${pluralService(ids.size)}`;
  }
  return apt.comment?.trim() || "—";
}

function pluralService(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "услуга";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "услуги";
  return "услуг";
}

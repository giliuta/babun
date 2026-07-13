import { useMemo } from "react";
import { Text, View } from "react-native";
import { Calendar, Star, TrendingUp, Wallet } from "lucide-react-native";
import type { Appointment } from "@babun/shared/local/appointments";
import { getPaidAmount } from "@babun/shared/local/appointments";
import { tierForVisits } from "@babun/shared/local/loyalty";
import type { ClientStats } from "@babun/shared/local/selectors/client-stats";
import { formatEUR } from "@babun/shared/common/utils/money";
import { CollapsibleCard } from "@/features/clients/card-collapse";
import { formatVisitDate } from "@/features/clients/format";
import { useLoyalty } from "@/features/settings/local-settings";
import { useThemeColors } from "@/theme/colors";

// FinanceBlock (mobile port of apps/web/.../blocks/FinanceBlock.tsx).
//
// Reference block — collapsed by default (CollapsibleCard); the closed row
// shows «долг €N» (red) or the LTV. Expanded: read-only money summary —
// LTV, средний чек, последняя оплата, последний
// визит, долг, loyalty tier pill, плюс история транзакций (paid +
// completed visits). All figures come from the shared `client-stats`
// selector + the appointments array — same data path as web; the tier
// comes from the same useLoyalty() query the settings screen writes.
//
// DEGRADED vs web:
//   * The «Подробнее» → /dashboard/finances?client_id= link is dropped;
//     the mobile finances screen doesn't take a client filter yet. TODO.

interface FinanceBlockProps {
  appointments: Appointment[];
  stats?: ClientStats;
}

interface PaidVisit {
  id: string;
  date: string;
  amount: number;
  method?: string;
}

const HISTORY_LIMIT = 5;

export default function FinanceBlock({ appointments, stats }: FinanceBlockProps) {
  const t = useThemeColors();
  const ltv = Math.round(stats?.totalSpent ?? 0);
  const debt = Math.round(stats?.debt ?? 0);
  const lastVisit = stats?.lastVisitDate ?? "";

  // Beta #53 — уровень лояльности по завершённым визитам (веб-паритет).
  const { data: loyalty } = useLoyalty();
  const tier = loyalty ? tierForVisits(stats?.visits ?? 0, loyalty) : null;

  // Paid + completed visits, newest-first. Explicit payment_status when
  // present; legacy rows fall back to «completed AND payment !== null».
  const paidVisits: PaidVisit[] = useMemo(
    () =>
      appointments
        .filter((a) => {
          if (a.status !== "completed") return false;
          const ps = a.payment_status;
          if (ps === "paid" || ps === "partial") return true;
          return ps === undefined && a.payment !== null;
        })
        .map((a) => ({
          id: a.id,
          date: a.date,
          amount: getPaidAmount(a) || a.total_amount,
          method: a.payment_method,
        }))
        .sort((x, y) => y.date.localeCompare(x.date)),
    [appointments],
  );

  const lastPaymentDate = paidVisits[0]?.date ?? "";
  const avgTicket =
    paidVisits.length > 0
      ? Math.round(
          paidVisits.reduce((s, v) => s + v.amount, 0) / paidVisits.length,
        )
      : 0;

  // Collapsed-row summary: долг shouts (red), otherwise quiet LTV.
  const summary =
    debt > 0 ? `долг ${formatEUR(debt)}` : ltv > 0 ? formatEUR(ltv) : "";

  return (
    <CollapsibleCard
      title="Финансы"
      summary={summary}
      tone={debt > 0 ? "danger" : "default"}
    >
      <View className="gap-2 px-1 py-1">
        <Row
          icon={<Wallet color={t.faint} size={14} />}
          label="LTV"
          value={ltv > 0 ? formatEUR(ltv) : "—"}
          t={t}
        />
        <Row
          icon={<TrendingUp color={t.faint} size={14} />}
          label="Средний чек"
          value={avgTicket > 0 ? formatEUR(avgTicket) : "—"}
          t={t}
        />
        <Row
          icon={<Calendar color={t.faint} size={14} />}
          label="Последняя оплата"
          value={lastPaymentDate ? formatVisitDate(lastPaymentDate) : "—"}
          t={t}
        />
        <Row
          label="Последний визит"
          value={lastVisit ? formatVisitDate(lastVisit) : "—"}
          t={t}
        />
        {debt > 0 ? <Row label="Долг" value={formatEUR(debt)} tone="bad" t={t} /> : null}

        {tier ? (
          // Золотой пилл уровня — литеральные цвета веба (не токены DS:
          // это семантика «лояльность», одинаковая на обеих платформах).
          <View
            className="flex-row items-center gap-2 rounded-[10px] px-2 py-2"
            style={{ backgroundColor: "rgba(255,204,0,0.10)" }}
          >
            <Star color="#B78600" size={14} strokeWidth={2.2} />
            <Text className="flex-1 text-[13px] font-semibold" style={{ color: "#B78600" }}>
              {tier.label}
            </Text>
            <Text className="text-[13px] font-bold tabular-nums" style={{ color: "#B78600" }}>
              −{tier.percent}%
            </Text>
          </View>
        ) : null}
      </View>

      {paidVisits.length > 0 ? (
        <View className="mt-2 border-t pt-2" style={{ borderColor: t.separator }}>
          <Text className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wider" style={{ color: t.faint }}>
            История транзакций
          </Text>
          {paidVisits.slice(0, HISTORY_LIMIT).map((v) => (
            <View
              key={v.id}
              className="flex-row items-center gap-2 px-1 py-0.5"
            >
              <Text className="flex-1 text-xs" style={{ color: t.sub }} numberOfLines={1}>
                {formatVisitDate(v.date)}
                {v.method ? ` · ${methodLabel(v.method)}` : ""}
              </Text>
              <Text className="text-xs font-semibold" style={{ color: t.success }}>
                +{formatEUR(v.amount)}
              </Text>
            </View>
          ))}
          {paidVisits.length > HISTORY_LIMIT ? (
            <Text className="px-1 pt-1 text-[11px]" style={{ color: t.faint }}>
              + ещё {paidVisits.length - HISTORY_LIMIT} оплат
            </Text>
          ) : null}
        </View>
      ) : null}
    </CollapsibleCard>
  );
}

function Row({
  icon,
  label,
  value,
  tone = "default",
  t,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  tone?: "default" | "bad";
  t: ReturnType<typeof useThemeColors>;
}) {
  return (
    <View className="flex-row items-center gap-2">
      {icon ? <View className="shrink-0">{icon}</View> : null}
      <Text className="flex-1 text-sm" style={{ color: t.sub }}>{label}</Text>
      <Text
        className="text-sm font-bold"
        style={{ color: tone === "bad" ? t.danger : t.ink }}
      >
        {value}
      </Text>
    </View>
  );
}

function methodLabel(method: string): string {
  switch (method) {
    case "cash":
      return "нал";
    case "card":
      return "карта";
    case "transfer":
      return "перевод";
    case "other":
      return "сплит";
    default:
      return method;
  }
}

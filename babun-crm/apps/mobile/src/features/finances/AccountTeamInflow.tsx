import { Text, View } from "react-native";
import { formatEURExact as formatEUR } from "@babun/shared/common/utils/money";
import type { PaymentMethod } from "@babun/shared/local/finance/transaction";
import { Card } from "@/components/ui/Card";
import { useThemeColors } from "@/theme/colors";
import type { Team } from "@/features/reference/queries";
import type { AccountWithBalance } from "./accounts";
import type { AccountInflowBreakdown, TeamDirectInflow } from "./account-inflow";

const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: "Нал",
  card: "Карта",
  transfer: "Банк",
  other: "Другое",
};

function methodsLine(row: TeamDirectInflow): string {
  return (Object.keys(METHOD_LABEL) as PaymentMethod[])
    .filter((m) => (row.byMethod[m] ?? 0) !== 0)
    .map((m) => `${METHOD_LABEL[m]} ${formatEUR(row.byMethod[m] as number)}`)
    .join(" · ");
}

// «ПОСТУПЛЕНИЯ ПО КОМАНДАМ» — носитель требования №4: сколько зашло на
// общий счёт именно с каждой команды за месяц. Подключённая команда с
// нулём — тоже информация (€0); отвязанная с историей — «· отключена».
// Инкассации (переводы С командных счетов) — отдельным блоком, иначе
// месяц команды задвоился бы с прямыми оплатами.
export function AccountTeamInflow({
  account,
  breakdown,
  teamById,
}: {
  account: AccountWithBalance;
  breakdown: AccountInflowBreakdown;
  teamById: Map<string, Team>;
}) {
  const t = useThemeColors();

  // Подключённые команды всегда в списке (даже с нулём за месяц).
  const rows: TeamDirectInflow[] = [...breakdown.direct];
  for (const teamId of account.team_ids) {
    if (!rows.some((r) => r.teamId === teamId)) {
      rows.push({ teamId, byMethod: {}, total: 0 });
    }
  }

  const teamRow = (
    key: string,
    teamId: string | null,
    total: number,
    secondary?: string,
  ) => {
    const team = teamId ? teamById.get(teamId) : undefined;
    const detached =
      teamId !== null && !account.team_ids.includes(teamId);
    const name =
      teamId === null
        ? "Компания"
        : (team?.name ?? "Без бригады") + (detached ? " · отключена" : "");
    return (
      <View
        key={key}
        className="flex-row items-center gap-3 px-4"
        style={{ minHeight: 48, paddingVertical: 6 }}
      >
        <View
          style={{
            width: 2,
            height: 16,
            borderRadius: 1,
            backgroundColor: team?.color || t.faint,
          }}
        />
        <View className="min-w-0 flex-1">
          <Text
            className="text-[15px] font-medium"
            style={{ color: t.ink }}
            numberOfLines={1}
          >
            {name}
          </Text>
          {secondary ? (
            <Text className="mt-0.5 text-xs tabular-nums" style={{ color: t.sub }}>
              {secondary}
            </Text>
          ) : null}
        </View>
        <Text
          className="text-[15px] font-semibold tabular-nums"
          style={{ color: total > 0 ? t.success : total < 0 ? t.danger : t.sub }}
        >
          {formatEUR(total)}
        </Text>
      </View>
    );
  };

  return (
    <View>
      <Text
        accessibilityRole="header"
        className="px-5 pb-2 pt-6 text-[11px] font-bold uppercase tracking-wider"
        style={{ color: t.sub }}
      >
        Поступления по командам
      </Text>
      <Card style={{ marginHorizontal: 12 }}>
        {rows.map((row, i) => (
          <View
            key={row.teamId ?? "company"}
            style={{
              borderTopWidth: i > 0 ? 1 : 0,
              borderTopColor: t.separator,
            }}
          >
            {teamRow(
              row.teamId ?? "company",
              row.teamId,
              row.total,
              methodsLine(row) || undefined,
            )}
          </View>
        ))}

        {breakdown.collections.length > 0 ? (
          <>
            <View
              className="px-4 pb-1"
              style={{
                paddingTop: 10,
                borderTopWidth: rows.length > 0 ? 1 : 0,
                borderTopColor: t.separator,
              }}
            >
              <Text
                className="text-[11px] font-bold uppercase tracking-wider"
                style={{ color: t.sub }}
              >
                Инкассации
              </Text>
            </View>
            {breakdown.collections.map((c) => (
              <View
                key={c.teamId ?? "company"}
                style={{ borderTopWidth: 0 }}
              >
                {teamRow(`col-${c.teamId ?? "company"}`, c.teamId, c.amount)}
              </View>
            ))}
          </>
        ) : null}

        {breakdown.transfersNet !== 0 ? (
          <View
            className="flex-row items-center justify-between px-4"
            style={{
              minHeight: 44,
              borderTopWidth: 1,
              borderTopColor: t.separator,
            }}
          >
            <Text className="text-[15px] font-medium" style={{ color: t.sub }}>
              Переводы
            </Text>
            <Text
              className="text-[15px] font-semibold tabular-nums"
              style={{ color: t.sub }}
            >
              {breakdown.transfersNet > 0 ? "+" : "−"}
              {formatEUR(Math.abs(breakdown.transfersNet))}
            </Text>
          </View>
        ) : null}

        <View
          className="flex-row items-center justify-between px-4"
          style={{
            minHeight: 44,
            borderTopWidth: 1,
            borderTopColor: t.separator,
          }}
        >
          <Text className="text-[13px] font-semibold" style={{ color: t.sub }}>
            За месяц
          </Text>
          <Text
            className="text-[15px] font-bold tabular-nums"
            style={{ color: t.ink }}
          >
            {breakdown.total >= 0 ? "+" : "−"}
            {formatEUR(Math.abs(breakdown.total))}
          </Text>
        </View>
      </Card>
    </View>
  );
}

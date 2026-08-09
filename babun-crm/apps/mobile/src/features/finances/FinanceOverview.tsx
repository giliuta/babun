import { Pressable, ScrollView, Text, View } from "react-native";
import {
  ChevronDown,
  ChevronRight,
  EyeOff,
  FileText,
  Wallet,
} from "lucide-react-native";
import { formatEURExact as formatEUR } from "@babun/shared/common/utils/money";
import { Chip } from "@/components/ui/Chip";
import { useThemeColors } from "@/theme/colors";
import type { Team } from "@/features/reference/queries";
import { periodDates, periodTitle, type Period } from "./period";

// Which panel the overview selects below (web parity: HomeView in
// apps/web FinanceOverview.tsx). «Счета» и «Инвойсы» — НЕ панели: это
// отдельные страницы (решение владельца 2026-07-27), их плитки навигируют.
export type HomeView = "all" | "income" | "expense" | "debt" | "profit";

export interface InvoiceTileSummary {
  openCount: number;
  outstanding: number;
  overdue: number;
}

export interface OverviewTotals {
  income: number;
  expense: number;
  profit: number;
  debt: number;
  /** Собранный и уплаченный налог за период. Не показывать его — значит
   *  выдавать чужие деньги за прибыль. */
  vat?: { collected: number; paid: number; due: number };
}

// LOCKED v5 overview #6 «grouped-iOS premium» (finances-design.html +
// web FinanceOverview.tsx): company/team scope chips →
// period row split into NAME and DATES tap targets → «Счета» mini-card →
// joined Доход/Расход card on subtle tints → «Долги | Прибыль» row.
// Every card toggles the panel below; прибыль is always brandAccent.
export function FinanceOverview({
  teams,
  scopeTeamId,
  onScopeChange,
  period,
  onOpenPresets,
  onOpenCustom,
  totals,
  acctTotal,
  acctHasHidden,
  invoices,
  onOpenAccounts,
  onOpenDocuments,
  view,
  onTap,
}: {
  teams: Team[];
  scopeTeamId: string | null;
  onScopeChange: (id: string | null) => void;
  period: Period;
  onOpenPresets: () => void;
  onOpenCustom: () => void;
  totals: OverviewTotals;
  acctTotal: number;
  /** Часть счетов скрыта глазиком — Σ считает только видимые, и об этом
   *  надо сказать, иначе цифра выглядит полной суммой и врёт. */
  acctHasHidden?: boolean;
  invoices: InvoiceTileSummary;
  onOpenAccounts: () => void;
  onOpenDocuments: () => void;
  view: HomeView;
  onTap: (v: HomeView) => void;
}) {
  const t = useThemeColors();

  return (
    <View>
      {/* The owner needs a real company-wide P&L as well as team drill-down.
          `null` is the aggregate scope; individual chips keep the existing
          operational view. */}
      {teams.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0, backgroundColor: t.surface }}
          contentContainerStyle={{
            paddingHorizontal: 12,
            paddingTop: 6,
            paddingBottom: 7,
            gap: 8,
            alignItems: "center",
          }}
        >
          <Chip
            label="Компания"
            variant="outline"
            color={t.accent}
            radio
            selected={scopeTeamId === null}
            onPress={() => onScopeChange(null)}
            accessibilityLabel="Все команды компании"
          />
          {teams.map((team) => (
            <Chip
              key={team.id}
              label={team.name}
              variant="outline"
              color={team.color || t.accent}
              radio
              selected={scopeTeamId === team.id}
              onPress={() => onScopeChange(team.id)}
              accessibilityLabel={`Команда ${team.name}`}
              style={{ maxWidth: 180 }}
            />
          ))}
        </ScrollView>
      ) : null}

      {/* period row — NAME opens the preset list, DATES open the wheels */}
      <View
        className="flex-row items-center justify-between px-4"
        style={{
          backgroundColor: t.surface,
          borderTopWidth: 1,
          borderTopColor: t.separator,
          borderBottomWidth: 1,
          borderBottomColor: t.separator,
          minHeight: 44,
        }}
      >
        <Pressable
          onPress={onOpenPresets}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Период: ${periodTitle(period)}`}
          className="flex-row items-center gap-1 py-2 active:opacity-60"
        >
          <Text className="text-[15px] font-semibold" style={{ color: t.ink }}>
            {periodTitle(period)}
          </Text>
          <ChevronDown color={t.faint} size={14} strokeWidth={2.6} />
        </Pressable>
        <Pressable
          onPress={onOpenCustom}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Выбрать диапазон дат"
          className="py-2 active:opacity-60"
        >
          <Text
            className="text-[15px] font-bold tabular-nums"
            style={{ color: t.ink }}
          >
            {periodDates(period)}
          </Text>
        </Pressable>
      </View>

      {/* overview cards */}
      <View className="px-4 pb-2 pt-3" style={{ gap: 8 }}>
        {/* Счета | Документы — две плитки-СТРАНИЦЫ (не панели): счета слева,
            документы (инвойсы/чеки/договоры) справа. */}
        <View className="flex-row" style={{ gap: 8 }}>
          <Pressable
            onPress={onOpenAccounts}
            accessibilityRole="button"
            accessibilityLabel={
              acctHasHidden
                ? `Счета: ${formatEUR(acctTotal)}, часть счетов скрыта`
                : `Счета: ${formatEUR(acctTotal)}`
            }
            className="flex-1 rounded-xl px-3.5 py-2.5 active:opacity-70"
            style={{ minHeight: 58, backgroundColor: t.surface }}
          >
            <View className="flex-row items-center gap-1.5">
              <Wallet color={t.sub} size={14} />
              <Text className="text-xs font-semibold" style={{ color: t.sub }}>
                Счета
              </Text>
              <View className="ml-auto">
                <ChevronRight color={t.chevron} size={14} />
              </View>
            </View>
            <View className="mt-1 flex-row items-center gap-1.5">
              <Text
                className="text-[17px] font-bold tabular-nums"
                style={{ color: t.ink }}
                numberOfLines={1}
                adjustsFontSizeToFit
              >
                {formatEUR(acctTotal)}
              </Text>
              {acctHasHidden ? <EyeOff color={t.faint} size={13} /> : null}
            </View>
          </Pressable>
          <Pressable
            onPress={onOpenDocuments}
            accessibilityRole="button"
            accessibilityLabel={`Документы, к оплате ${formatEUR(invoices.outstanding)}`}
            className="flex-1 rounded-xl px-3.5 py-2.5 active:opacity-70"
            style={{ minHeight: 58, backgroundColor: t.surface }}
          >
            <View className="flex-row items-center gap-1.5">
              <FileText color={t.sub} size={14} />
              <Text className="text-xs font-semibold" style={{ color: t.sub }}>
                Документы
              </Text>
              <View className="ml-auto">
                <ChevronRight color={t.chevron} size={14} />
              </View>
            </View>
            <View className="mt-1 flex-row items-baseline gap-1.5">
              <Text
                className="text-[17px] font-bold tabular-nums"
                style={{ color: t.ink }}
                numberOfLines={1}
                adjustsFontSizeToFit
              >
                {formatEUR(invoices.outstanding)}
              </Text>
              <Text
                className="text-[11px] font-medium"
                style={{ color: invoices.overdue > 0 ? t.danger : t.faint }}
                numberOfLines={1}
              >
                {invoices.overdue > 0
                  ? `просрочено ${formatEUR(invoices.overdue)}`
                  : `${invoices.openCount} ждут`}
              </Text>
            </View>
          </Pressable>
        </View>

        {/* Доход / Расход — одна карточка, две половины на тонких тинтах */}
        <View
          className="flex-row overflow-hidden rounded-xl"
          style={{ backgroundColor: t.surface }}
        >
          <Pressable
            onPress={() => onTap("income")}
            accessibilityRole="button"
            accessibilityState={{ selected: view === "income" }}
            accessibilityLabel={`Доход: ${formatEUR(totals.income)}`}
            className="flex-1 px-4 py-3 active:opacity-80"
            style={{
              backgroundColor: t.success + (view === "income" ? "26" : "0d"),
            }}
          >
            <View className="mb-1 flex-row items-center gap-1.5">
              <View
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: t.success }}
              />
              <Text className="text-xs font-semibold" style={{ color: t.sub }}>
                Доход
              </Text>
            </View>
            <Text
              className="text-[22px] font-bold tabular-nums"
              style={{ color: t.success }}
            >
              {formatEUR(totals.income)}
            </Text>
          </Pressable>
          <View className="my-2.5 w-px" style={{ backgroundColor: t.separator }} />
          <Pressable
            onPress={() => onTap("expense")}
            accessibilityRole="button"
            accessibilityState={{ selected: view === "expense" }}
            accessibilityLabel={`Расход: ${formatEUR(totals.expense)}`}
            className="flex-1 px-4 py-3 active:opacity-80"
            style={{
              backgroundColor: t.danger + (view === "expense" ? "26" : "0d"),
            }}
          >
            <View className="mb-1 flex-row items-center gap-1.5">
              <View
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: t.danger }}
              />
              <Text className="text-xs font-semibold" style={{ color: t.sub }}>
                Расход
              </Text>
            </View>
            <Text
              className="text-[22px] font-bold tabular-nums"
              style={{ color: t.danger }}
            >
              {totals.expense > 0 ? "−" : ""}
              {formatEUR(totals.expense)}
            </Text>
          </Pressable>
        </View>

        {/* Долги | Прибыль — строкой */}
        <View className="flex-row" style={{ gap: 8 }}>
          <Pressable
            onPress={() => onTap("debt")}
            accessibilityRole="button"
            accessibilityState={{ selected: view === "debt" }}
            accessibilityLabel={`Долги: ${formatEUR(totals.debt)}`}
            className="flex-1 flex-row items-center rounded-xl px-3.5 active:opacity-70"
            style={{
              minHeight: 44,
              backgroundColor: t.surface,
              borderWidth: 1.5,
              borderColor: view === "debt" ? t.warning : "transparent",
            }}
          >
            <View
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: t.warning }}
            />
            <Text className="ml-2 text-sm font-semibold" style={{ color: t.sub }}>
              Долги
            </Text>
            <View className="ml-auto flex-row items-center gap-1">
              <Text
                className="text-[15px] font-bold tabular-nums"
                style={{ color: t.warning }}
              >
                {formatEUR(totals.debt)}
              </Text>
              <ChevronRight color={t.chevron} size={14} />
            </View>
          </Pressable>
          <Pressable
            onPress={() => onTap("profit")}
            accessibilityRole="button"
            accessibilityState={{ selected: view === "profit" }}
            accessibilityLabel="Разбор прибыли"
            className="flex-1 flex-row items-center rounded-xl px-3.5 active:opacity-70"
            style={{
              minHeight: 44,
              backgroundColor:
                t.brandAccent + (view === "profit" ? "29" : "12"),
              borderWidth: 1.5,
              borderColor: view === "profit" ? t.brandAccent : "transparent",
            }}
          >
            <Text
              className="text-sm font-semibold"
              style={{ color: t.brandAccent }}
            >
              Прибыль
            </Text>
            <Text
              className="ml-auto text-[15px] font-bold tabular-nums"
              style={{ color: t.brandAccent }}
            >
              {totals.profit >= 0 ? "" : "−"}
              {formatEUR(Math.abs(totals.profit))}
            </Text>
          </Pressable>
        </View>

        {/* НДС К УПЛАТЕ — отдельной строкой под прибылью, а не внутри неё.
            Владелец 2026-08-09: «400 моё, а 80 отдельно, считать наперёд».
            Цифра появляется, только когда налог включён: бизнесу без НДС
            пустая строка ничего не объясняет. */}
        {totals.vat && (totals.vat.collected !== 0 || totals.vat.paid !== 0) ? (
          <View
            className="mt-2 flex-row items-center rounded-xl px-3.5 py-2"
            style={{ backgroundColor: t.surface }}
          >
            <Text className="text-sm font-semibold" style={{ color: t.sub }}>
              НДС к уплате
            </Text>
            <Text
              className="ml-2 text-[11px]"
              style={{ color: t.faint }}
              numberOfLines={1}
            >
              собрал {formatEUR(totals.vat.collected)} · зачёл{" "}
              {formatEUR(totals.vat.paid)}
            </Text>
            <Text
              className="ml-auto text-[15px] font-bold tabular-nums"
              style={{ color: totals.vat.due > 0 ? t.warning : t.success }}
            >
              {formatEUR(totals.vat.due)}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

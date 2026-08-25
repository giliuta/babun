import { useMemo, type ReactElement } from "react";
import {
  Pressable,
  SectionList,
  Text,
  View,
  type RefreshControlProps,
} from "react-native";
import {
  formatEURExact as formatEUR,
  moneySign,
} from "@babun/shared/common/utils/money";
import {
  signedAmount,
  type FinanceTransaction,
} from "@babun/shared/local/finance/transaction";
import type { Account } from "@babun/shared/local/finance/account";
import type { FinanceCategory } from "@babun/shared/db/repositories/finance-categories";
import type { Client } from "@babun/shared/local/clients";
import type { Appointment } from "@babun/shared/local/appointments";
import { EmptyState } from "@/components/ui/EmptyState";
import { useThemeColors } from "@/theme/colors";
import { humanDay } from "@/features/appointments/helpers";
import { useCalendarSettings } from "@/features/settings/local-settings";
import type { Team } from "@/features/reference/queries";
import type { Service } from "@/features/services/queries";
import { PanelHeader } from "./PanelHeader";

// Day-grouped operations feed — port of the web TransactionsFeed
// (mockup «Вариант 3»): colored pill on the left, «время · клиент» over
// the description, amount on the right. An income tied to an appointment
// titles itself with the visit's SERVICES and its tap jumps to the
// client card; everything else opens the tx popup.
// «ЧЧ:ММ» из ISO-времени по часам БИЗНЕСА — фолбэк контекста дохода.
// `new Date(iso).getHours()` читал бы часы УСТРОЙСТВА: у диспетчера с
// телефоном в другом поясе время оплаты уезжало на смещение, хотя весь
// остальной контур живёт по calendar_settings.timezone.
function hhmm(iso: string, timeZone: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(d);
  } catch {
    // Битая зона в настройках: часы устройства честнее пустой строки.
    return `${String(d.getHours()).padStart(2, "0")}:${String(
      d.getMinutes(),
    ).padStart(2, "0")}`;
  }
}

export function TransactionsFeed({
  transactions,
  emptyTitle,
  accounts,
  teams,
  categories,
  clients,
  appointments,
  services,
  title,
  onReset,
  onTxTap,
  contextMode = "default",
  scroll = true,
  refreshControl,
  footnote,
}: {
  /** Подпись пустого состояния. По умолчанию «Нет операций за период»;
   *  при активном поиске экран честно говорит, где именно искали. */
  emptyTitle?: string;
  transactions: FinanceTransaction[];
  accounts: Account[];
  teams: Team[];
  categories: FinanceCategory[];
  clients: Client[];
  appointments: Appointment[];
  services: Service[];
  /** Section eyebrow, e.g. «Операции · 12». */
  title: string;
  /** Shown as an «Все» reset link when the feed is filtered. */
  onReset?: () => void;
  onTxTap: (tx: FinanceTransaction) => void;
  /** «team» — лента одного счёта: имя счёта в контексте избыточно,
   *  фолбэк-строка показывает только команду. */
  contextMode?: "default" | "team";
  /** false — плоский рендер для вложения в родительский ScrollView
   *  (деталь счёта); SectionList внутри ScrollView не живёт. */
  scroll?: boolean;
  /** Pull-to-refresh хозяина экрана (U86). Только для собственного
   *  SectionList: в плоском рендере контрол ставит родительский скролл. */
  refreshControl?: ReactElement<RefreshControlProps>;
  /** ЧЕГО В ЛЕНТЕ НЕТ, А В ПЛИТКЕ ЕСТЬ. Расход экрана «Финансы» включает
   *  материалы записей — расчётную величину, у которой нет проводки в
   *  журнале. Без этой строки плитка показывала €540, лента складывалась в
   *  €400, и разницу владелец искал пальцем по списку. */
  footnote?: { text: string; onPress?: () => void };
}) {
  const t = useThemeColors();
  // Та же зона и тот же фолбэк, что у периода на экране финансов
  // (finances/index.tsx): лента не имеет права печатать время в другом
  // поясе, чем шапка периода над ней.
  const businessTimezone =
    useCalendarSettings().data?.timezone ?? "Europe/Nicosia";

  const lookups = useMemo(
    () => ({
      account: new Map(accounts.map((a) => [a.id, a])),
      team: new Map(teams.map((x) => [x.id, x])),
      category: new Map(categories.map((c) => [c.id, c])),
      client: new Map(clients.map((c) => [c.id, c])),
      appointment: new Map(appointments.map((a) => [a.id, a])),
      service: new Map(services.map((s) => [s.id, s])),
    }),
    [accounts, teams, categories, clients, appointments, services],
  );

  const sections = useMemo(() => {
    const byDate = new Map<string, FinanceTransaction[]>();
    for (const tx of transactions) {
      const arr = byDate.get(tx.occurred_on) ?? [];
      arr.push(tx);
      byDate.set(tx.occurred_on, arr);
    }
    return [...byDate.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([date, data]) => ({
        title: date,
        // Общая лента: переводы нейтральны для P&L и исключены из дневного
        // итога (web groupByDay parity). Лента ОДНОГО счёта (contextMode
        // "team"): перевод меняет именно этот баланс — включаем, иначе
        // итог дня спорит с футером «За месяц» и балансом счёта.
        net: data.reduce(
          (s, tx) =>
            tx.type === "transfer" && contextMode !== "team"
              ? s
              : s + signedAmount(tx),
          0,
        ),
        data,
      }));
  }, [transactions, contextMode]);

  const renderRow = (tx: FinanceTransaction) => {
    const isIncome = tx.type === "income";
    const isRefund = tx.type === "refund";
    const isIn = isIncome || isRefund;
    const isEx = tx.type === "expense";
    const isTr = tx.type === "transfer";

    const cat = tx.category_id ? lookups.category.get(tx.category_id) : null;
    const appt = tx.appointment_id
      ? lookups.appointment.get(tx.appointment_id)
      : null;

    // title — the service NAME (visit services > the operation note),
    // not the bare category. Falls back per type (web parity).
    let desc = "";
    if (isIn && appt && appt.service_ids.length > 0) {
      desc = appt.service_ids
        .map((id) => lookups.service.get(id)?.name ?? "")
        .filter(Boolean)
        .join(", ");
    }
    if (!desc) {
      desc = isIn
        ? tx.notes || cat?.name || (tx.type === "refund" ? "Возврат" : "Поступление")
        : isTr
          ? // Перевод не отдаёт заголовок заметке: «на бензин −€50» без слова
            // «Перевод» неотличим от расхода, хотя для P&L строка нейтральна.
            // Сама заметка уходит в ctx-строку ниже.
            "Перевод"
          : cat?.name || tx.notes || "Расход";
    }

    // context line: время · клиент (income) / комментарий (expense/transfer)
    let ctx = "";
    if (isIn) {
      const client = tx.client_id ? lookups.client.get(tx.client_id) : null;
      // Доход без привязанной записи — время создания операции (web parity).
      const time = appt?.time_start || hhmm(tx.created_at, businessTimezone);
      ctx = [time, client?.full_name].filter(Boolean).join(" · ");
    } else if (tx.notes && (isTr || (isEx && cat))) {
      ctx = tx.notes;
    }
    if (!ctx) {
      ctx = [
        contextMode === "team" || !tx.account_id
          ? null
          : lookups.account.get(tx.account_id)?.name,
        tx.team_id ? lookups.team.get(tx.team_id)?.name : null,
      ]
        .filter(Boolean)
        .join(" · ");
    }

    const barColor = isIncome ? t.success : isRefund || isEx ? t.danger : t.faint;
    const amountColor = isIncome ? t.success : isRefund || isEx ? t.danger : t.sub;
    const sign = isIncome || (isTr && tx.amount > 0) ? "" : "−";

    return (
      <Pressable
        onPress={() => onTxTap(tx)}
        accessibilityRole="button"
        accessibilityLabel={`${desc}, ${isIncome ? "поступление" : isRefund ? "возврат" : isEx ? "списание" : "перевод"} ${formatEUR(Math.abs(tx.amount))}`}
        className="flex-row items-center gap-3 px-4 active:opacity-60"
        style={{ backgroundColor: t.surface, minHeight: 56 }}
      >
        <View
          className="rounded-full"
          style={{ width: 6, height: 36, backgroundColor: barColor }}
        />
        <View className="flex-1">
          {ctx ? (
            <Text className="text-xs" style={{ color: t.faint }} numberOfLines={1}>
              {ctx}
            </Text>
          ) : null}
          <Text
            className={`text-[15px] ${isTr ? "font-medium" : "font-semibold"}`}
            style={{ color: isTr ? t.sub : t.ink }}
            numberOfLines={1}
          >
            {desc}
          </Text>
        </View>
        <Text
          className="text-base font-bold"
          style={{ color: amountColor, fontVariant: ["tabular-nums"] }}
        >
          {sign}
          {formatEUR(Math.abs(tx.amount))}
        </Text>
      </Pressable>
    );
  };

  // Эйбрау — общий примитив всех панелей экрана (`PanelHeader`): своя копия
  // жила здесь и потому оставалась единственной панелью с именем.
  const listHeader = <PanelHeader title={title} onReset={onReset} />;

  const sectionHeader = (section: { title: string; net: number }) => {
    // Ноль движения — не приход: день, где приход и расход схлопнулись в €0,
    // зелёным означал бы «деньги пришли». Цвет = смысл, у нуля его нет.
    const netSign = moneySign(section.net);
    return (
      <View
        className="flex-row items-center justify-between px-4 py-1.5"
        style={{ backgroundColor: t.canvas }}
      >
        <Text
          className="text-xs font-semibold uppercase tracking-wider"
          style={{ color: t.sub }}
        >
          {humanDay(section.title)}
        </Text>
        <Text
          className="text-xs font-semibold"
          style={{
            color: netSign < 0 ? t.danger : netSign > 0 ? t.success : t.sub,
            fontVariant: ["tabular-nums"],
          }}
        >
          {formatEUR(section.net)}
        </Text>
      </View>
    );
  };

  // Сноска — не строка ленты: у неё нет ни дня, ни счёта, ни тапа на правку.
  // Поэтому она стоит ПОД списком, тише строк, и ведёт туда, где эти деньги
  // разложены поимённо (разбор прибыли).
  const footnoteNode = footnote ? (
    <Pressable
      onPress={footnote.onPress}
      disabled={!footnote.onPress}
      accessibilityRole={footnote.onPress ? "button" : "text"}
      accessibilityLabel={footnote.text}
      style={({ pressed }) => ({
        paddingHorizontal: 16,
        paddingVertical: 12,
        backgroundColor: pressed && footnote.onPress ? t.pressed : "transparent",
      })}
    >
      <Text
        maxFontSizeMultiplier={1.3}
        style={{ fontSize: 13, lineHeight: 18, color: t.caption }}
      >
        {footnote.text}
      </Text>
    </Pressable>
  ) : null;

  if (!scroll) {
    return (
      <View>
        {listHeader}
        {sections.length === 0 ? (
          <EmptyState title={emptyTitle ?? "Нет операций за период"} />
        ) : (
          sections.map((section) => (
            <View key={section.title}>
              {sectionHeader(section)}
              {section.data.map((tx, i) => (
                <View key={tx.id}>
                  {i > 0 ? (
                    <View className="ml-4 h-px" style={{ backgroundColor: t.separator }} />
                  ) : null}
                  {renderRow(tx)}
                </View>
              ))}
            </View>
          ))
        )}
        {footnoteNode}
      </View>
    );
  }

  return (
    <SectionList
      style={{ flex: 1 }}
      sections={sections}
      refreshControl={refreshControl}
      keyExtractor={(tx) => tx.id}
      ListHeaderComponent={listHeader}
      contentContainerStyle={{ paddingBottom: 96 }}
      renderSectionHeader={({ section }) => sectionHeader(section)}
      renderItem={({ item }) => renderRow(item)}
      ItemSeparatorComponent={() => (
        <View className="ml-4 h-px" style={{ backgroundColor: t.separator }} />
      )}
      ListEmptyComponent={
        <EmptyState title={emptyTitle ?? "Нет операций за период"} />
      }
      ListFooterComponent={footnoteNode}
    />
  );
}

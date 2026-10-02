import { useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Bell, ChevronRight } from "lucide-react-native";
import type { Appointment } from "@babun/shared/local/appointments";
import { STATUS_LABELS, getDebtAmount } from "@babun/shared/local/appointments";
import type { Client } from "@babun/shared/local/clients";
import type { ClientStats } from "@babun/shared/local/selectors/client-stats";
import { formatEUR } from "@babun/shared/common/utils/money";
import { reminderBadge } from "@/features/clients/format";
import { clientDebt } from "@/features/clients/filter";
import { humanDay } from "@/features/appointments/helpers";
import {
  archivedVisitTag,
  hasManyLiveTeams,
  liveVisitTeam,
  type VisitTeamRow,
} from "@/features/clients/archived-visit";
import { recordServiceNames } from "@/features/clients/last-record";
import { useAllServices } from "@/features/services/queries";
import { useTeams } from "@/features/reference/queries";
import { clientSubParams } from "@/features/clients/clients-company";
import {
  useClientsCapabilities,
  useClientsScopeOrNull,
} from "@/features/clients/company-scope";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

// МАЛЕНЬКАЯ КАРТОЧКА ПОД НОМЕРОМ (владелец 2026-07-26). Не строки-факты, а
// сводка: долг первым и янтарём («обрати внимание», не авария), напоминание,
// и одной строкой доверие — визиты, сумма, когда был, когда записан.
// Отдельной карточкой, а не хвостом блока идентичности: это ПРОИЗВОДНОЕ, а не
// поле, которое правят.
//
// Она же — ВХОД В ИСТОРИЮ ЗАПИСЕЙ (владелец 2026-08-02). Отдельной строки
// «История записей · N» больше нет: она повторяла те же визиты числом, а
// место на карточке не бесконечное.
//
// Жила внутри `ClientHeader`; вынесена 2026-09-21 (STORY-085), когда шапке
// понадобился выбор «Человек / Компания», а файл уже был за 650 строк.
//
// ЛИЦО — ПОСЛЕДНЯЯ ЗАПИСЬ ЦЕЛИКОМ (владелец 03.10: «убрать кнопку „Записать“
// и сделать полноценно: в истории высвечивается последняя запись — тап по
// ней открывает страницу со всеми записями, там выбираю запись»). Строка
// «6 визитов · €600 · был …» уступила место самой записи: когда, во сколько,
// какая команда, что делали, сколько и в каком она состоянии — всё вместе,
// как строка в истории записей. Долг остаётся своей строкой сверху и ведёт
// в «Неоплаченные» (22.09).

export function ClientSummaryCard({
  client,
  stats,
  lastRecord,
  onOpenHistory,
  showMoney,
}: {
  client: Client;
  stats: ClientStats | undefined;
  /** Последняя запись клиента (`lastClientRecord`); `null` — записей нет. */
  lastRecord: Appointment | null;
  /** Право «Долг и деньги» у этого клиента (30.09); нет — `caps.money`. */
  showMoney?: boolean;
  /** Открыть историю записей. Не задан — запись остаётся показанием, без
   *  перехода (черновик, нет права «История»). */
  onOpenHistory?: () => void;
}) {
  const t = useThemeColors();
  const router = useRouter();
  const scope = useClientsScopeOrNull();
  // Справочник с архивом — назвать команду и архивного визита; ключ общий с
  // календарём и историей, сети не прибавляет.
  const { data: allTeams = [] } = useTeams({ includeInactive: true });
  const teamsById = useMemo(() => new Map(allTeams.map((team) => [team.id, team])), [allTeams]);
  // Прошлые визиты — чтение: имя убранной услуги обязано пережить её.
  const { data: services = [] } = useAllServices();
  const serviceName = useMemo(() => {
    const names = new Map(services.map((service) => [service.id, service.name]));
    return (id: string) => names.get(id);
  }, [services]);
  // Долг — общей формулой продукта, а не своей. Раньше здесь стояло сырое
  // `stats.debt`, а список и фильтр считали иначе: карточка молчала о долге,
  // который список печатал крупно (владелец 2026-08-07).
  // ДЕНЬГИ КЛИЕНТА — ТОЛЬКО ТОМУ, КОМУ ОНИ ОТКРЫТЫ (STORY-088, волна 4).
  const capsMoney = useClientsCapabilities().money;
  const money = showMoney ?? capsMoney;
  const debtAmount = money ? clientDebt(client, stats) : 0;
  const debt = debtAmount > 0 ? formatEUR(debtAmount) : null;
  // «Напомнить» пишет reminder_at — строка делает дату видимой: серая, когда
  // впереди, красная — сегодня/прошло.
  const badge = reminderBadge(client.reminder_at);

  // ПРИ ДОЛГЕ — «НЕОПЛАЧЕННЫЕ» (владелец 2026-09-22): тапнули по «Долг €240» —
  // хотят видеть, ЗА ЧТО. Дверь та же — история визитов, с фильтром.
  const openUnpaid = onOpenHistory
    ? () =>
        router.push({
          pathname: "/clients/visits",
          params: clientSubParams(client.id, scope, { unpaid: "1" }),
        })
    : undefined;

  const record = lastRecord ? describeRecord(lastRecord, { money, teamsById, serviceName, t }) : null;

  return (
    <>
      {debt ? (
        <SummaryRow
          onPress={openUnpaid}
          label={`Неоплаченные записи · Долг ${debt}`}
        >
          <Text
            maxFontSizeMultiplier={1.3}
            style={{ fontSize: 15, fontWeight: "700", color: t.warning, fontVariant: ["tabular-nums"] }}
          >
            {`Долг ${debt}`}
          </Text>
        </SummaryRow>
      ) : null}
      {badge ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 16, paddingVertical: 6 }}>
          <Bell color={badge.due ? t.danger : t.sub} size={12} strokeWidth={2.2} />
          <Text
            maxFontSizeMultiplier={1.3}
            style={{ fontSize: 13, fontWeight: badge.due ? "600" : "400", color: badge.due ? t.danger : t.sub }}
          >
            {`Напомнить · ${badge.label}`}
          </Text>
        </View>
      ) : null}
      {record ? (
        <SummaryRow
          onPress={onOpenHistory}
          separated={!!debt || !!badge}
          label={`История записей · последняя: ${record.when}${record.what ? ` · ${record.what}` : ""}`}
        >
          {/* КОГДА — первой строкой и чернилами; ЧТО и КТО — второй, тише;
              деньги и состояние — справа, своим цветом, как в истории. */}
          <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
            <Text
              maxFontSizeMultiplier={1.3}
              numberOfLines={1}
              style={{ flex: 1, fontSize: 15, fontWeight: "600", color: t.ink, fontVariant: ["tabular-nums"] }}
            >
              {record.when}
            </Text>
            {record.money ? (
              <Text
                maxFontSizeMultiplier={1.3}
                style={{ fontSize: 15, fontWeight: "600", color: record.money.color, fontVariant: ["tabular-nums"] }}
              >
                {record.money.text}
              </Text>
            ) : null}
          </View>
          {record.what ? (
            <Text maxFontSizeMultiplier={1.3} numberOfLines={2} style={{ fontSize: 14, color: t.body }}>
              {record.what}
            </Text>
          ) : null}
          <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={{ fontSize: 13, color: record.stateColor }}>
            {record.state}
          </Text>
        </SummaryRow>
      ) : (
        // Записей нет — словами, без кнопки (владелец 15.09).
        <Text
          maxFontSizeMultiplier={1.3}
          style={{ fontSize: 15, color: t.sub, paddingHorizontal: 16, paddingVertical: 12 }}
        >
          Записей пока нет
        </Text>
      )}
    </>
  );
}

/** Строка блока: дверь с шевроном, когда есть куда вести, иначе показание. */
function SummaryRow({
  onPress,
  separated,
  label,
  children,
}: {
  onPress?: () => void;
  separated?: boolean;
  label: string;
  children: React.ReactNode;
}) {
  const t = useThemeColors();
  return (
    <Pressable
      onPress={
        onPress
          ? () => {
              haptics.tap();
              onPress();
            }
          : undefined
      }
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={label}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        minHeight: 44,
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderTopWidth: separated ? 1 : 0,
        borderTopColor: t.separator,
        backgroundColor: pressed && onPress ? t.pressed : "transparent",
      })}
    >
      <View style={{ flex: 1, gap: 3 }}>{children}</View>
      {onPress ? <ChevronRight color={t.chevron} size={18} strokeWidth={2.2} /> : null}
    </Pressable>
  );
}

/** Запись словами — те же части, что у строки истории записей. */
function describeRecord(
  a: Appointment,
  ctx: {
    money: boolean;
    teamsById: ReadonlyMap<string, VisitTeamRow>;
    serviceName: (id: string) => string | undefined;
    t: ReturnType<typeof useThemeColors>;
  },
) {
  const { t } = ctx;
  const team =
    archivedVisitTag(a.team_id, ctx.teamsById) ??
    liveVisitTeam(a.team_id, ctx.teamsById, hasManyLiveTeams(ctx.teamsById));
  const when = [humanDay(a.date), a.time_start?.slice(0, 5), team].filter(Boolean).join(" · ");
  const services = recordServiceNames(a, ctx.serviceName);
  const note = (a.comment ?? "").trim();
  const what = services.length > 0 ? services.join(", ") : note;
  const owed = getDebtAmount(a);
  const moneyText =
    !ctx.money || a.status === "cancelled"
      ? null
      : owed > 0
        ? { text: `долг ${formatEUR(owed)}`, color: t.warning }
        : (a.total_amount ?? 0) > 0
          ? { text: formatEUR(a.total_amount), color: t.sub }
          : null;
  const stateColor =
    a.status === "cancelled" ? t.faint : a.status === "completed" ? t.success : t.accent;
  return { when, what, money: moneyText, state: STATUS_LABELS[a.status] ?? "Запись", stateColor };
}

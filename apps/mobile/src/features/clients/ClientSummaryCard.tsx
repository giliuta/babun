import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Bell, ChevronRight } from "lucide-react-native";
import type { Client } from "@babun/shared/local/clients";
import type { ClientStats } from "@babun/shared/local/selectors/client-stats";
import { formatEUR } from "@babun/shared/common/utils/money";
import {
  formatShortDateRu,
  reminderBadge,
  visitsWord,
} from "@/features/clients/format";
import { clientDebt } from "@/features/clients/filter";
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

export function ClientSummaryCard({
  client,
  stats,
  onOpenHistory,
}: {
  client: Client;
  stats: ClientStats | undefined;
  /** Открыть историю записей. Не задан — сводка остаётся просто текстом
   *  (черновик, клиент без единой записи). */
  onOpenHistory?: () => void;
}) {
  const t = useThemeColors();
  const router = useRouter();
  const { data: teams = [] } = useTeams();
  const scope = useClientsScopeOrNull();
  // Долг — общей формулой продукта, а не своей. Раньше здесь стояло сырое
  // `stats.debt`, а список и фильтр считали иначе: карточка молчала о долге,
  // который список печатал крупно. Три формулы на трёх экранах — прямая
  // причина «я не верю этим числам» (владелец 2026-08-07).
  // ДЕНЬГИ КЛИЕНТА — ТОЛЬКО ТОМУ, КОМУ ОНИ ОТКРЫТЫ (STORY-088, волна 4). Долг
  // и «потрачено» у сотрудника считались бы из сумм, которые сервер отдал
  // ему по блокам записи, — неполная цифра хуже никакой. Визиты и «был …»
  // остаются: это история, а не деньги.
  const money = useClientsCapabilities().money;
  const debtAmount = money ? clientDebt(client, stats) : 0;
  const debt = debtAmount > 0 ? formatEUR(debtAmount) : null;
  // «Напомнить» (card-actions) пишет reminder_at — строка делает дату
  // видимой: серая, когда впереди, красная — сегодня/прошло.
  const badge = reminderBadge(client.reminder_at);
  const nextApt = stats?.nextApt ?? null;
  const lastTeam =
    (stats?.lastTeamId && teams.find((x) => x.id === stats.lastTeamId)?.name) || null;
  // СВОДКА ДОВЕРИЯ. Не один серый абзац, а факты РАЗНОГО ВЕСА (владелец
  // 2026-08-06: «не нравится, что „6 визитов · €600 · был 30 мая“ серым —
  // надо, чтоб выделялось»): сколько раз приезжали и сколько денег принесли —
  // чернилами и деньгами, «когда были» — тихо, «записан» — кобальтом, потому
  // что это единственный факт про БУДУЩЕЕ.
  const trustSegments: { text: string; color: string; weight: "400" | "600" | "700" }[] =
    stats
      ? [
          stats.visits > 0
            ? {
                text: `${stats.visits} ${visitsWord(stats.visits)}`,
                color: t.ink,
                weight: "700" as const,
              }
            : null,
          money && stats.totalSpent > 0
            ? {
                text: formatEUR(stats.totalSpent),
                color: t.success,
                weight: "700" as const,
              }
            : null,
          stats.lastVisitDate
            ? {
                text: `был ${formatShortDateRu(stats.lastVisitDate)}`,
                color: t.sub,
                weight: "400" as const,
              }
            : null,
          // КТО ЕЗДИЛ В ПРОШЛЫЙ РАЗ (владелец 22.09: «какая команда
          // обслуживала — лучше по истории»). Тише всех: это справка, а не
          // деньги и не дата. Список тот же, что у строки клиента в списке.
          lastTeam
            ? { text: lastTeam, color: t.sub, weight: "400" as const }
            : null,
          // Предстоящая запись — здесь же, а не отдельной строкой: это такой
          // же факт «когда», как «был 27 мая», только про будущее.
          nextApt
            ? {
                text: `записан ${formatShortDateRu(nextApt.date)} · ${nextApt.time}`,
                color: t.accent,
                weight: "600" as const,
              }
            : null,
        ].filter((x): x is NonNullable<typeof x> => x !== null)
      : [];

  if (!debt && !badge && trustSegments.length === 0) return null;

  // ПРИ ДОЛГЕ СВОДКА ВЕДЁТ В «НЕОПЛАЧЕННЫЕ» (владелец 2026-09-22): тапнули по
  // «Долг €240» — хотят видеть, ЗА ЧТО, а не всю историю за три года. Адрес
  // сводка собирает сама, а не просит у страницы второй обработчик: дверь та
  // же — история визитов, только с фильтром `unpaid=1`, и открывается она
  // ровно тогда же, когда страница дала `onOpenHistory` (права, черновик,
  // записи — это решает страница, не сводка).
  const open = !onOpenHistory
    ? undefined
    : debt
      ? () =>
          router.push({
            pathname: "/clients/visits",
            params: clientSubParams(client.id, scope, { unpaid: "1" }),
          })
      : onOpenHistory;

  return (
    <Pressable
      onPress={
        open
          ? () => {
              haptics.tap();
              open();
            }
          : undefined
      }
      disabled={!open}
      accessibilityRole={open ? "button" : undefined}
      accessibilityLabel={
        open
          ? debt
            ? `Неоплаченные записи · Долг ${debt}`
            : `История записей · ${trustSegments.map((s) => s.text).join(" · ")}`
          : undefined
      }
      // СТРОКА БЛОКА «ИСТОРИЯ», а не своя карточка (владелец 22.09: «визиты
      // и сумма — это история клиента; нажимаем — там полный перечень»).
      // Безымянной карточки на странице не осталось: у каждого блока шапка.
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        minHeight: 44,
        paddingHorizontal: 16,
        paddingVertical: 10,
        backgroundColor: pressed && open ? t.pressed : "transparent",
      })}
    >
      <View style={{ flex: 1, gap: 4 }}>
        {debt ? (
          <Text
            maxFontSizeMultiplier={1.3}
            style={{ fontSize: 15, fontWeight: "700", color: t.warning, fontVariant: ["tabular-nums"] }}
          >
            {`Долг ${debt}`}
          </Text>
        ) : null}
        {badge ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Bell
              color={badge.due ? t.danger : t.sub}
              size={12}
              strokeWidth={2.2}
            />
            <Text
              maxFontSizeMultiplier={1.3}
              style={{
                fontSize: 13,
                fontWeight: badge.due ? "600" : "400",
                color: badge.due ? t.danger : t.sub,
              }}
            >
              {`Напомнить · ${badge.label}`}
            </Text>
          </View>
        ) : null}
        {trustSegments.length > 0 ? (
          <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 15, fontVariant: ["tabular-nums"] }}>
            {trustSegments.map((seg, i) => (
              <Text key={seg.text}>
                {i > 0 ? (
                  <Text style={{ color: t.faint, fontWeight: "400" }}>
                    {"  ·  "}
                  </Text>
                ) : null}
                <Text style={{ color: seg.color, fontWeight: seg.weight }}>
                  {seg.text}
                </Text>
              </Text>
            ))}
          </Text>
        ) : null}
      </View>
      {open ? (
        <ChevronRight color={t.chevron} size={18} strokeWidth={2.2} />
      ) : null}
    </Pressable>
  );
}

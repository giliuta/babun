import { Text, View } from "react-native";
import { MessageSquare } from "lucide-react-native";
import { Divider } from "@/components/ui/Divider";
import { SectionCard } from "@/components/ui/SectionCard";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { CAN_PAY_HERE } from "@/lib/pay-here";
import { useThemeColors } from "@/theme/colors";
import { formatCountRu } from "@babun/shared/common/utils/plural-ru";
import { LOW_BALANCE_CENTS, type SmsAccount } from "./sms-model";
import { euro } from "./sms-words";

// КАБИНЕТ → SMS — ЧАСТИ СТРАНИЦЫ (STORY-089; владелец 30.09: «переделать…
// календари нашей компании… в нашем стиле, более красиво… правильные тарифы
// и рассказать, сколько стоит SMS»).
//
//   • БАЛАНС — компактно: сумма, «≈ N SMS», месяц; ниже €5 — «Пополните
//     баланс» строкой (плашки над страницей нет);
//   • ТАРИФ — три лимита по длине: 1, 2 или 3 SMS и их цена.
//   Календари — в «Истории SMS» выбором (владелец 30.09).
//   Бонусов и скидок за крупное пополнение нет (владелец 30.09: «платят
//   полную сумму… сколько им нужно»).

/** «5 SMS» — число со словом (склонение делает formatCountRu). */
export const smsCount = (n: number): string => formatCountRu(n, ["SMS", "SMS", "SMS"]);

/** Баланс — компактно (владелец 30.09): сумма и «≈ N SMS» слева, месяц
 *  справа. Ниже €5 — «Пополните баланс» цветом предупреждения. */
export function SmsBalanceCard({ account }: { account: SmsAccount }) {
  const t = useThemeColors();
  const owner = account.owner;
  if (!owner) return null;
  const debt = owner.balanceCents < 0;
  const low = owner.balanceCents < LOW_BALANCE_CENTS;
  const left = debt ? 0 : Math.floor(owner.balanceCents / Math.max(1, account.priceCents));
  // «SMS» НА ЭТОЙ СТРАНИЦЕ — ЧАСТЬ ПО ТАРИФУ, а не сообщение (повторный аудит
  // 03.10): «≈ 156 SMS» и «До 134 знаков — 2 SMS» считают части, а месяц
  // печатал число сообщений — «€1,20 · 5 SMS» при цене €0,12 за SMS. Месяц —
  // в частях (сумма частей по командам); нет разбивки — число сообщений.
  const monthParts = owner.teams.reduce((sum, team) => sum + team.segments, 0) || owner.monthCount;
  // В приложении из магазина «пополните» не говорим (владелец 04.10,
  // `pay-here.ts`) — только состояние.
  const line = debt
    ? CAN_PAY_HERE ? "Долг — пополните баланс" : "Долг"
    : low
      ? left > 0
        ? CAN_PAY_HERE ? `≈ ${smsCount(left)} · пополните баланс` : `≈ ${smsCount(left)} · баланс на исходе`
        : CAN_PAY_HERE ? "Пополните баланс" : "Баланс на исходе"
      : `≈ ${smsCount(left)}`;
  return (
    <SectionCard title="Баланс">
      <View style={{ flexDirection: "row", alignItems: "flex-end", paddingHorizontal: 16, paddingBottom: 14, gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Text
            maxFontSizeMultiplier={1.2}
            style={{ fontSize: 28, fontWeight: "700", color: debt ? t.danger : t.ink, fontVariant: ["tabular-nums"] }}
          >
            {euro(owner.balanceCents)}
          </Text>
          <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 14, color: debt ? t.danger : low ? t.warning : t.sub, marginTop: 1 }}>
            {line}
          </Text>
        </View>
        <View style={{ alignItems: "flex-end" }} accessible accessibilityLabel={`За месяц: ${euro(owner.monthCents)}, ${smsCount(monthParts)}`}>
          <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 12, color: t.sub }}>
            За месяц
          </Text>
          <Text
            maxFontSizeMultiplier={1.3}
            style={{ fontSize: 15, fontWeight: "600", color: owner.monthCount === 0 ? t.sub : t.ink, fontVariant: ["tabular-nums"], marginTop: 1 }}
          >
            {euro(owner.monthCents)} · {smsCount(monthParts)}
          </Text>
        </View>
      </View>
    </SectionCard>
  );
}

/** Тариф — лимитами по длине, без оговорок (владелец 30.09: «70 знаков,
 *  латиницей 160, эмодзи — не понимаю… давай просто лимиты по сообщению»).
 *  Эмодзи в поле не вводятся, длиннее 3 SMS набрать нельзя. */
export function SmsTariffCard({ priceCents }: { priceCents: number }) {
  const limits = [
    { upTo: "До 70 знаков", parts: 1 },
    { upTo: "До 134 знаков", parts: 2 },
    { upTo: "До 201 знака", parts: 3 },
  ];
  return (
    <SectionCard title="Тариф">
      {limits.map((row, index) => (
        <View key={row.parts}>
          {index > 0 ? <Divider inset={48} /> : null}
          <SettingsRow
            tile="neutral"
            icon={MessageSquare}
            title={row.upTo}
            sub={row.parts === 3 ? "3 SMS — длиннее нельзя" : smsCount(row.parts)}
            value={euro(priceCents * row.parts)}
          />
        </View>
      ))}
    </SectionCard>
  );
}

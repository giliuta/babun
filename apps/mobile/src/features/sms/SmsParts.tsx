import { Text, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { Layers, MessageSquare, Smile, Users } from "lucide-react-native";
import { Divider } from "@/components/ui/Divider";
import { iconPreset } from "@/components/ui/icon-set";
import { SectionCard } from "@/components/ui/SectionCard";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { PaymentTile, TILE_GAP, useTileWidth } from "@/features/appointments/PaymentTiles";
import { useThemeColors } from "@/theme/colors";
import { formatCountRu } from "@babun/shared/common/utils/plural-ru";
import { teamStats, type SmsAccount } from "./sms-model";
import { TOPUP_AMOUNTS_CENTS } from "./sms-account";
import { euro } from "./sms-words";

// КАБИНЕТ → SMS — ЧАСТИ СТРАНИЦЫ (STORY-089; владелец 30.09: «переделать…
// календари нашей компании… в нашем стиле, более красиво… правильные тарифы
// и рассказать, сколько стоит SMS»).
//
//   • БАЛАНС — сумма крупно, как итог в финансах; под ней «≈ N SMS» и две
//     плитки «слово | число»: месяц в деньгах и в штуках;
//   • ТАРИФ — сколько стоит SMS простыми словами и что дают пакеты;
//   • КАЛЕНДАРИ — команды компании плитками в их цветах и значках: SMS за
//     месяц; тап — SMS этой команды (шаблоны, имя отправителя).
//   Бонусов и скидок за крупное пополнение нет (владелец 30.09: «платят
//   полную сумму… сколько им нужно»).

type Team = { id: string; name: string; color: string | null; icon: string | null };

/** «5 SMS» — число со словом (склонение делает formatCountRu). */
const smsCount = (n: number): string => formatCountRu(n, ["SMS", "SMS", "SMS"]);

/** «слово | число» — маленькая плитка-итог, как сводка в финансах. */
function StatTile({ label, value, quiet }: { label: string; value: string; quiet?: boolean }) {
  const t = useThemeColors();
  return (
    <View
      style={{
        flex: 1,
        borderRadius: t.radius.card,
        backgroundColor: t.fill,
        paddingHorizontal: 12,
        paddingVertical: 9,
      }}
      accessible
      accessibilityLabel={`${label}: ${value}`}
    >
      <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 12, color: t.sub }}>
        {label}
      </Text>
      <Text
        maxFontSizeMultiplier={1.3}
        style={{ fontSize: 17, fontWeight: "700", color: quiet ? t.sub : t.ink, fontVariant: ["tabular-nums"], marginTop: 1 }}
      >
        {value}
      </Text>
    </View>
  );
}

/** Баланс крупно: сколько денег и примерно сколько коротких SMS. */
export function SmsBalanceCard({ account }: { account: SmsAccount }) {
  const t = useThemeColors();
  const owner = account.owner;
  if (!owner) return null;
  const debt = owner.balanceCents < 0;
  const left = debt ? 0 : Math.floor(owner.balanceCents / Math.max(1, account.priceCents));
  return (
    <SectionCard title="Баланс">
      <View style={{ paddingHorizontal: 16, paddingBottom: 14 }}>
        <Text
          maxFontSizeMultiplier={1.2}
          style={{
            fontSize: 34,
            fontWeight: "700",
            letterSpacing: -0.5,
            color: debt ? t.danger : t.ink,
            fontVariant: ["tabular-nums"],
          }}
        >
          {euro(owner.balanceCents)}
        </Text>
        <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 15, color: debt ? t.danger : t.sub, marginTop: 2 }}>
          {debt ? "Долг — SMS не уходят" : `≈ ${smsCount(left)}`}
        </Text>
        <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
          <StatTile label="За месяц" value={euro(owner.monthCents)} quiet={owner.monthCents === 0} />
          <StatTile label="Ушло" value={smsCount(owner.monthCount)} quiet={owner.monthCount === 0} />
        </View>
      </View>
    </SectionCard>
  );
}

/** Тариф словами: цена одной SMS, длинные сообщения, эмодзи и пакеты. */
export function SmsTariffCard({ priceCents }: { priceCents: number }) {
  const t = useThemeColors();
  const tileWidth = useTileWidth(2);
  return (
    <SectionCard title="Тариф">
      <SettingsRow
        tile="neutral"
        icon={MessageSquare}
        title="1 SMS"
        sub="70 знаков, латиницей 160"
        value={euro(priceCents)}
      />
      <Divider inset={48} />
      <SettingsRow
        tile="neutral"
        icon={Layers}
        title="Длинное сообщение"
        sub="каждые 67 знаков (153 латиницей) — ещё одна SMS"
      />
      <Divider inset={48} />
      <SettingsRow tile="neutral" icon={Smile} title="Эмодзи" sub="считается за 2 знака" />
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          gap: TILE_GAP,
          paddingHorizontal: 16,
          paddingTop: 10,
          paddingBottom: 14,
        }}
      >
        {TOPUP_AMOUNTS_CENTS.map((cents) => {
          const n = Math.floor(cents / Math.max(1, priceCents));
          return (
            <View
              key={cents}
              style={{
                width: tileWidth,
                borderRadius: t.radius.card,
                backgroundColor: t.fill,
                paddingHorizontal: 12,
                paddingVertical: 9,
              }}
              accessible
              accessibilityLabel={`${euro(cents)} — примерно ${n} SMS`}
            >
              <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 17, fontWeight: "700", color: t.ink }}>
                {euro(cents)}
              </Text>
              <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 12, color: t.sub, marginTop: 1 }}>
                ≈ {smsCount(n)}
              </Text>
            </View>
          );
        })}
      </View>
    </SectionCard>
  );
}

function useOpenTeam() {
  const router = useRouter();
  return (teamId: string) =>
    router.push({ pathname: "/calendar/sms", params: { team: teamId } } as unknown as Href);
}

function teamLine(account: SmsAccount, teamId: string): string {
  const s = teamStats(account, teamId);
  const sender = account.senders?.[teamId];
  return `${sender ?? "Нет имени"} · ${smsCount(s.count)}`;
}

/** Календари компании — плитки в цвет и со значком команды, три в ряд, как
 *  счета в финансах (владелец 30.09 выбрал этот вид). */
export function SmsTeamsTiles({ account, teams }: { account: SmsAccount; teams: Team[] }) {
  const t = useThemeColors();
  const open = useOpenTeam();
  const width = useTileWidth(3);
  return (
    <SectionCard title="Календари">
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: TILE_GAP, paddingHorizontal: 16, paddingBottom: 14 }}>
        {teams.map((team) => {
          const s = teamStats(account, team.id);
          return (
            <PaymentTile
              key={team.id}
              icon={iconPreset(team.icon) ?? Users}
              label={team.name}
              color={team.color ?? t.ink}
              tint={team.color}
              width={width}
              compact
              state="idle"
              amount={smsCount(s.count)}
              amountColor={s.count === 0 ? t.sub : undefined}
              onPress={() => open(team.id)}
              accessibilityLabel={`${team.name}: ${teamLine(account, team.id)}`}
            />
          );
        })}
      </View>
    </SectionCard>
  );
}

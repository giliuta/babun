import { Linking, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import Head from "expo-router/head";
import { CircleCheck, CircleX } from "lucide-react-native";
import { GradientButton } from "@/components/ui/GradientButton";
import { Screen } from "@/components/ui/Screen";
import { GUTTER } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";

// «ОПЛАТА ПРОШЛА» — СТРАНИЦА ВОЗВРАТА ИЗ STRIPE (STORY-089; владелец 30.09:
// «пополнить баланс просто и легко для клиента»). Человек платил из
// приложения в браузере телефона; здесь одна мысль — деньги дойдут сами,
// вернитесь в приложение. Внизу одно действие — открыть приложение.
export default function PayDone() {
  const t = useThemeColors();
  const { topup } = useLocalSearchParams<{ topup?: string }>();
  const cancelled = topup === "cancelled";
  const Icon = cancelled ? CircleX : CircleCheck;
  return (
    <Screen edges={["top", "bottom"]}>
      <Head>
        <title>{cancelled ? "Оплата отменена · Babun" : "Оплата прошла · Babun"}</title>
      </Head>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: GUTTER * 2 }}>
        <Icon size={56} strokeWidth={1.8} color={cancelled ? t.sub : t.success} />
        <Text
          maxFontSizeMultiplier={1.3}
          style={{ fontSize: 22, fontWeight: "700", color: t.ink, marginTop: 16, textAlign: "center" }}
        >
          {cancelled ? "Оплата отменена" : "Оплата прошла"}
        </Text>
        <Text
          maxFontSizeMultiplier={1.3}
          style={{ fontSize: 16, color: t.sub, marginTop: 8, textAlign: "center", lineHeight: 22 }}
        >
          {cancelled
            ? "Деньги не списаны. Пополнить можно в приложении: Кабинет → SMS."
            : "Баланс SMS пополнится через минуту. Вернитесь в приложение Babun."}
        </Text>
      </View>
      <View style={{ paddingHorizontal: GUTTER, paddingBottom: 16 }}>
        <GradientButton label="Открыть Babun" onPress={() => void Linking.openURL("babun://cabinet/sms")} />
      </View>
    </Screen>
  );
}

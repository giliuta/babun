import { Linking, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import Head from "expo-router/head";
import { CircleCheck, CircleX } from "lucide-react-native";
import { BrandLockup } from "@/components/brand/BrandMark";
import { GradientButton } from "@/components/ui/GradientButton";
import { Screen } from "@/components/ui/Screen";
import { GUTTER } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";

// «ОПЛАТА ПРОШЛА» — СТРАНИЦА ВОЗВРАТА ИЗ STRIPE (STORY-089; владелец 30.09:
// «пополнить баланс просто и легко для клиента»). Человек платил из
// приложения в браузере телефона; здесь одна мысль — деньги дойдут сами,
// вернитесь в приложение. Внизу одно действие — открыть приложение.
//
// ТАРИФ (01.10): сюда же возвращает оплата тарифа (`?tariff=paid|cancelled`)
// и «Управление подпиской» (`?tariff=portal`) — слова свои, кнопка ведёт в
// Кабинет → Тариф.
export default function PayDone() {
  const t = useThemeColors();
  const { topup, tariff } = useLocalSearchParams<{ topup?: string; tariff?: string }>();
  const isTariff = typeof tariff === "string";
  const cancelled = (isTariff ? tariff : topup) === "cancelled";
  const Icon = cancelled ? CircleX : CircleCheck;
  const words = isTariff
    ? tariff === "portal"
      ? { title: "Готово", body: "Изменения подписки дойдут до приложения через минуту. Вернитесь в Babun." }
      : cancelled
        ? { title: "Оплата отменена", body: "Деньги не списаны. Тариф можно выбрать в приложении: Кабинет → Тариф." }
        : { title: "Оплата прошла", body: "Тариф включится через минуту. Вернитесь в приложение Babun." }
    : cancelled
      ? { title: "Оплата отменена", body: "Деньги не списаны. Пополнить можно в приложении: Кабинет → SMS." }
      : { title: "Оплата прошла", body: "Баланс SMS пополнится через минуту. Вернитесь в приложение Babun." };
  return (
    <Screen edges={["top", "bottom"]}>
      <Head>
        <title>{`${words.title} · Babun`}</title>
      </Head>
      <View style={{ alignItems: "center", paddingTop: 16 }}>
        <BrandLockup />
      </View>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: GUTTER * 2 }}>
        <Icon size={56} strokeWidth={1.8} color={cancelled ? t.sub : t.success} />
        <Text
          maxFontSizeMultiplier={1.3}
          style={{ fontSize: 22, fontWeight: "700", color: t.ink, marginTop: 16, textAlign: "center" }}
        >
          {words.title}
        </Text>
        <Text
          maxFontSizeMultiplier={1.3}
          style={{ fontSize: 16, color: t.sub, marginTop: 8, textAlign: "center", lineHeight: 22 }}
        >
          {words.body}
        </Text>
      </View>
      <View style={{ paddingHorizontal: GUTTER, paddingBottom: 16 }}>
        <GradientButton label="Открыть Babun" onPress={() => void Linking.openURL(isTariff ? "babun://cabinet/tariff" : "babun://cabinet/sms")} />
      </View>
    </Screen>
  );
}

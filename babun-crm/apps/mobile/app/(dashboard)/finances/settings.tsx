import { Alert, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import {
  Building2,
  FileText,
  Percent,
  Receipt,
  Share2,
  Tags,
  Wallet,
} from "lucide-react-native";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { Divider } from "@/components/ui/Divider";
import { SettingsRow } from "@/components/ui/SettingsRow";
import {
  useVatSettings,
  vatSummaryLine,
} from "@/features/finances/vat-queries";

// НАСТРОЙКИ ФИНАНСОВ — СТРАНИЦА, А НЕ СПИСОК В ALERT.
//
// Было: шестерёнка открывала системный Alert с шестью строками. Это против
// закона продукта («настройка — всегда полноценная страница, лист — только
// действие»), и вдобавок Alert не умеет ни подписей, ни текущих значений:
// нельзя было увидеть, включён ли НДС, не проваливаясь внутрь.

export default function FinanceSettingsScreen() {
  const router = useRouter();
  const vat = useVatSettings();

  return (
    <Screen>
      <ScreenHeader title="Настройки финансов" />
      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 24 }}>
        <SectionEyebrow>Деньги</SectionEyebrow>
        <SectionCard>
          <SettingsRow
            tile="#2F6FD6"
            icon={Wallet}
            title="Счета"
            sub="Кассы команд и общие счета компании"
            onPress={() => router.push("/accounts")}
          />
          <Divider inset={56} />
          <SettingsRow
            tile="#8E44AD"
            icon={Tags}
            title="Категории операций"
            sub="На что уходят и откуда приходят деньги"
            onPress={() => router.push("/cabinet/categories")}
          />
          <Divider inset={56} />
          <SettingsRow
            tile="#0E7C86"
            icon={Receipt}
            title="Шаблоны операций"
            sub="Повторяющиеся расходы в один тап"
            onPress={() => router.push("/cabinet/templates")}
          />
        </SectionCard>

        <SectionEyebrow>Документы</SectionEyebrow>
        <SectionCard>
          <SettingsRow
            tile="#C0392B"
            icon={Percent}
            title="НДС и страна"
            sub={vatSummaryLine(vat.data)}
            onPress={() => router.push("/finances/vat")}
          />
          <Divider inset={56} />
          <SettingsRow
            tile="#1F7A44"
            icon={FileText}
            title="Инвойсы"
            sub="Выставленные счета и их оплата"
            onPress={() => router.push("/documents")}
          />
        </SectionCard>

        <SectionEyebrow>Выгрузка</SectionEyebrow>
        <SectionCard>
          <SettingsRow
            tile="#5B6678"
            icon={Share2}
            title="Отчёт бухгалтеру"
            sub="Операции и документы за период — файлом"
            onPress={() =>
              router.navigate({
                pathname: "/finances",
                params: { exportReport: String(Date.now()) },
              })
            }
          />
          <Divider inset={56} />
          <SettingsRow
            tile="#5B6678"
            icon={Building2}
            title="Реквизиты компании"
            sub="Печатаются в инвойсах и чеках"
            onPress={() =>
              Alert.alert(
                "Реквизиты компании",
                "Пока печатаются данные из профиля компании. Отдельная страница появится вместе с шаблонами документов.",
              )
            }
          />
        </SectionCard>
      </ScrollView>
    </Screen>
  );
}

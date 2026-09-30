import { useState } from "react";
import { View } from "react-native";
import { ArrowDownToLine, CreditCard, RefreshCw, Wallet } from "lucide-react-native";
import { Divider } from "@/components/ui/Divider";
import { NoticeBar } from "@/components/ui/NoticeBar";
import { PickerSheet } from "@/components/ui/PickerSheet";
import { SectionCard } from "@/components/ui/SectionCard";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SwitchRow } from "@/components/ui/SwitchRow";
import { GUTTER } from "@/components/ui/tokens";
import { confirmThen } from "@/lib/confirm";
import { notify } from "@/lib/notify";
import { useThemeColors } from "@/theme/colors";
import {
  AUTOTOPUP_THRESHOLDS_CENTS,
  openSmsCheckout,
  smsErrorText,
  TOPUP_AMOUNTS_CENTS,
  useForgetAutotopupCard,
  useSaveAutotopup,
  type SmsAutotopup,
} from "./sms-account";
import { euro } from "./sms-words";

// АВТОПОПОЛНЕНИЕ БАЛАНСА SMS (STORY-089, волна 13; владелец 30.09: «чтобы
// партнёры автоматически пополняли… зачисление на их счёт»). Карта
// сохраняется оплатой на странице Stripe — в приложении она открывается в
// браузере (владелец 30.09: «оплата отдельной страницей, не через Apple»).
//
//   • Карты нет — строка-дверь: выбрать сумму, оплатить её на Stripe, и карта
//     сохранится; дальше баланс сам пополняется на ту же сумму, когда падает
//     ниже порога.
//   • Карта есть — выключатель, «Когда меньше» и «Пополнять на» (строки с
//     шторкой выбора), карта строкой «Visa •••• 4242» — тап убирает её.
//   • Банк отказал или открыт спор — автопополнение выключено само, причина
//     словами над блоком.

type Picking = "start" | "threshold" | "amount" | null;

export function SmsAutotopupCard({ auto }: { auto: SmsAutotopup }) {
  const t = useThemeColors();
  const save = useSaveAutotopup();
  const forget = useForgetAutotopupCard();
  const [picking, setPicking] = useState<Picking>(null);

  const patch = (p: { enabled?: boolean; thresholdCents?: number; amountCents?: number }) =>
    save.mutate(p, { onError: (e) => notify("Не удалось сохранить", smsErrorText(e)) });

  const start = async (cents: number) => {
    try {
      await openSmsCheckout(cents, { thresholdCents: auto.thresholdCents });
    } catch (e) {
      notify("Оплата не открылась", e instanceof Error ? e.message : undefined);
    }
  };

  const dropCard = () =>
    confirmThen(
      "Убрать карту?",
      {
        message: "Автопополнение выключится. Снова включить — оплатой с сохранением карты.",
        confirmLabel: "Убрать",
        destructive: true,
      },
      () => forget.mutate(undefined, { onError: (e) => notify("Не удалось убрать карту", smsErrorText(e)) }),
    );

  const amounts = (onPick: (cents: number) => void, hint?: (cents: number) => string) =>
    TOPUP_AMOUNTS_CENTS.map((cents) => ({
      id: String(cents),
      label: euro(cents),
      hint: hint?.(cents),
      icon: Wallet,
      color: t.accent,
      onPress: () => onPick(cents),
    }));

  return (
    <>
      {auto.error ? (
        <View style={{ marginHorizontal: GUTTER, marginTop: 12 }}>
          <NoticeBar tone="error" message={`Автопополнение выключено: ${auto.error}`} />
        </View>
      ) : null}
      <SectionCard title="Автопополнение">
        {auto.card ? (
          <>
            <SwitchRow
              label="Автопополнение"
              // Включено — порог и сумма видны строками ниже; выключено —
              // подпись говорит, что включится.
              hint={auto.enabled ? undefined : `${euro(auto.amountCents)}, когда меньше ${euro(auto.thresholdCents)}`}
              value={auto.enabled}
              disabled={save.isPending}
              onChange={(enabled) => patch({ enabled })}
            />
            {auto.enabled ? (
              <>
                <Divider inset={48} />
                <SettingsRow
                  tile="neutral"
                  icon={ArrowDownToLine}
                  title="Когда меньше"
                  value={euro(auto.thresholdCents)}
                  onPress={() => setPicking("threshold")}
                />
                <Divider inset={48} />
                <SettingsRow
                  tile="neutral"
                  icon={RefreshCw}
                  title="Пополнять на"
                  value={euro(auto.amountCents)}
                  onPress={() => setPicking("amount")}
                />
              </>
            ) : null}
            <Divider inset={48} />
            <SettingsRow
              tile="neutral"
              icon={CreditCard}
              title={auto.card}
              sub="Карта автопополнения"
              onPress={dropCard}
            />
          </>
        ) : (
          <SettingsRow
            tile="neutral"
            icon={RefreshCw}
            title="Выключено"
            sub="Сохранить карту при оплате"
            onPress={() => setPicking("start")}
          />
        )}
      </SectionCard>

      <PickerSheet
        visible={picking === "start"}
        title="Автопополнение"
        items={amounts(
          (cents) => {
            setPicking(null);
            void start(cents);
          },
          () => `сейчас и дальше — когда меньше ${euro(auto.thresholdCents)}`,
        )}
        onClose={() => setPicking(null)}
      />
      <PickerSheet
        visible={picking === "threshold"}
        title="Когда меньше"
        items={AUTOTOPUP_THRESHOLDS_CENTS.map((cents) => ({
          id: String(cents),
          label: euro(cents),
          icon: ArrowDownToLine,
          color: t.accent,
          onPress: () => {
            setPicking(null);
            patch({ thresholdCents: cents });
          },
        }))}
        onClose={() => setPicking(null)}
      />
      <PickerSheet
        visible={picking === "amount"}
        title="Пополнять на"
        items={amounts((cents) => {
          setPicking(null);
          patch({ amountCents: cents });
        })}
        onClose={() => setPicking(null)}
      />
    </>
  );
}

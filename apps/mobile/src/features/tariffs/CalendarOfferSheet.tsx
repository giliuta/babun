import { useRef, useState } from "react";
import { Text, View } from "react-native";
import { Check } from "lucide-react-native";
import { useQueryClient } from "@tanstack/react-query";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { GradientButton } from "@/components/ui/GradientButton";
import { useToast } from "@/components/ui/Toast";
import { GUTTER, TYPE } from "@/components/ui/tokens";
import { useCurrentRole } from "@/features/settings/tenant";
import { CAN_PAY_HERE } from "@/lib/pay-here";
import { notify } from "@/lib/notify";
import { useThemeColors } from "@/theme/colors";
import { CALENDAR_PRICE, calendarsMonthly, euro } from "./calendar-price";
import { openTariffCheckout, useStartTrial, useTariff } from "./use-tariff";

// ПРЕДЛОЖЕНИЕ «НОВЫЙ КАЛЕНДАРЬ» (владелец 12.10: «чтоб добавить календарь,
// мне нужно заплатить — вот и всё… предложение покупки»). «Добавить» сверх
// оплаченного открывает не плашку «нужно изменить тариф», а это предложение:
// цена календаря, что в неё входит, итог за все календари и одно действие —
// пробный 14 дней (если его не было) или оплата за живые + новый календарь.
// В сборке без оплаты (`CAN_PAY_HERE` выключен) цен и оплаты нет — только
// пробный, если он есть.

const INCLUDES = ["Клиенты, записи и деньги", "Инвойсы, чеки и SMS", "Люди — бесплатно и без лимита"] as const;

export function CalendarOfferSheet({
  visible,
  calendars,
  onClose,
  onUnlocked,
}: {
  visible: boolean;
  /** Живых календарей сейчас — новый станет следующим. */
  calendars: number;
  onClose: () => void;
  /** Пробный включён — можно сразу заводить календарь. */
  onUnlocked: () => void;
}) {
  const t = useThemeColors();
  const toast = useToast();
  const { state } = useTariff();
  const role = useCurrentRole().data;
  const startTrial = useStartTrial();
  const [paying, setPaying] = useState(false);
  const qc = useQueryClient();
  // ЧТО ДЕЛАТЬ, КОГДА ЛИСТ УЕДЕТ (13.10). Лист создания календаря — второе
  // окно: открытое, пока это ещё уезжает, iOS не показывает («already
  // presenting»), и невидимое окно глотает тапы. Как у остальных листов —
  // через `onExited`.
  const afterExit = useRef<(() => void) | null>(null);
  const owner = role === "owner";
  const next = calendars + 1;
  const canTrial = owner && !state.trial && !state.trialUsed && !state.paid;

  const tryFree = async () => {
    try {
      await startTrial.mutateAsync("max");
      toast("Пробный — 14 дней", "success");
      afterExit.current = onUnlocked;
      onClose();
    } catch (e) {
      notify("Пробный не включился", e instanceof Error ? e.message : undefined);
    }
  };

  const pay = async () => {
    setPaying(true);
    try {
      const result = await openTariffCheckout("max", null, next);
      // ПОДПИСКА УЖЕ ЕСТЬ — СЕРВЕР МЕНЯЕТ ЕЁ НА МЕСТЕ, без браузера (13.10).
      // Раньше лист молча закрывался: ни тоста, ни нового тарифа, и
      // «Добавить» снова открывал это же предложение.
      if (result === "changed" || result === "same") {
        // Тариф пишет вебхук Stripe — через пару секунд.
        void qc.invalidateQueries({ queryKey: ["tenant"] });
        setTimeout(() => void qc.invalidateQueries({ queryKey: ["tenant"] }), 4000);
      }
      if (result === "changed") {
        toast("Оплата за календари обновлена", "success");
        afterExit.current = onUnlocked;
      }
      onClose();
    } catch (e) {
      notify("Оплата не открылась", e instanceof Error ? e.message : undefined);
    } finally {
      setPaying(false);
    }
  };

  const action = !owner
    ? null
    : canTrial
      ? { label: "Попробовать 14 дней бесплатно", run: tryFree }
      : CAN_PAY_HERE
        ? { label: `Оплатить ${calendarsMonthly(next)} в месяц`, run: pay }
        : null;

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      onExited={() => {
        const run = afterExit.current;
        afterExit.current = null;
        run?.();
      }}
      title="Новый календарь"
      padded={false}
      footer={
        <View style={{ paddingHorizontal: GUTTER, gap: 8 }}>
          {!owner ? (
            <Text className="text-center text-[13px]" style={{ color: t.sub }}>
              Календари добавляет владелец
            </Text>
          ) : null}
          {action ? (
            <GradientButton
              label={action.label}
              onPress={() => void action.run()}
              loading={startTrial.isPending || paying}
            />
          ) : null}
        </View>
      }
    >
      <View style={{ paddingHorizontal: GUTTER, paddingBottom: 8, gap: 12 }}>
        {CAN_PAY_HERE ? (
          <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6 }}>
            <Text style={{ ...TYPE.display, color: t.ink, fontVariant: ["tabular-nums"] }}>
              {euro(CALENDAR_PRICE.monthly)}
            </Text>
            <Text style={{ ...TYPE.subhead, color: t.faint }}>в месяц за календарь</Text>
          </View>
        ) : null}
        <View style={{ gap: 6 }}>
          {INCLUDES.map((line) => (
            <View key={line} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Check size={14} color={t.accent} strokeWidth={2.4} />
              <Text style={{ ...TYPE.body, color: t.sub }}>{line}</Text>
            </View>
          ))}
        </View>
        {CAN_PAY_HERE ? (
          <Text style={{ ...TYPE.subhead, color: t.ink }}>
            {`Календарей станет ${next} — ${calendarsMonthly(next)} в месяц`}
          </Text>
        ) : null}
      </View>
    </BottomSheet>
  );
}

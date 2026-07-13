import { useMemo } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import type { Appointment } from "@babun/shared/local/appointments";
import { formatEUR } from "@babun/shared/common/utils/money";
import { computeDayFinance } from "@babun/shared/local/finance/day-summary";
import { getDayExtras } from "@babun/shared/local/day-extras";
import { parseYMD } from "@/features/appointments/helpers";
import { useDayExtras, useFinanceServices } from "@/features/calendar/queries";
import { useThemeColors } from "@/theme/colors";

// Разбор финансов дня по тапу на футер Доход/Расход (запрос владельца
// 2026-07-13; веб-аналог DayFinanceModal): те же цифры, что в футере и
// месяце — общий computeDayFinance, расхождение невозможно. Центрированная
// карточка в языке CityPickerModal.
export function DayFinanceModal({
  dateYmd,
  appointments,
  teamId,
  onClose,
}: {
  /** День разбора (null = закрыто). */
  dateYmd: string | null;
  /** Записи этого дня, уже отфильтрованные по команде. */
  appointments: Appointment[];
  teamId: string | null;
  onClose: () => void;
}) {
  const t = useThemeColors();
  const services = useFinanceServices();
  const { data: extrasMap = {} } = useDayExtras();

  const extras = dateYmd ? getDayExtras(extrasMap, teamId, dateYmd) : [];
  const totals = useMemo(
    () => computeDayFinance(appointments, services, extras),
    // extras — производная extrasMap+dateYmd; сами зависимости стабильнее.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [appointments, services, extrasMap, teamId, dateYmd],
  );

  const dateLabel = dateYmd
    ? (() => {
        const s = parseYMD(dateYmd).toLocaleDateString("ru-RU", {
          weekday: "short",
          day: "numeric",
          month: "long",
        });
        return s.charAt(0).toUpperCase() + s.slice(1);
      })()
    : "";

  const methods: { label: string; v: number }[] = [
    { label: "Наличные", v: totals.byMethod.cash },
    { label: "Карта", v: totals.byMethod.card },
    { label: "Перевод", v: totals.byMethod.transfer },
    { label: "Другое", v: totals.byMethod.other },
  ].filter((m) => m.v > 0);

  return (
    <Modal
      visible={dateYmd != null}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable
        onPress={onClose}
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          padding: 16,
          backgroundColor: t.scrim,
        }}
      >
        <Pressable
          onPress={() => {}}
          style={{
            width: "100%",
            maxWidth: 340,
            borderRadius: 20,
            overflow: "hidden",
            paddingBottom: 12,
            backgroundColor: t.canvas,
            boxShadow: t.cardShadow,
          }}
        >
          <View
            className="px-4 pb-3 pt-4"
            style={{
              backgroundColor: t.surface,
              borderBottomWidth: 1,
              borderBottomColor: t.separator,
            }}
          >
            <Text style={{ fontSize: 17, fontWeight: "600", color: t.ink }}>
              Финансы дня
            </Text>
            <Text style={{ marginTop: 2, fontSize: 13, color: t.sub }}>
              {dateLabel}
            </Text>
          </View>

          <ScrollView style={{ maxHeight: 420 }} bounces={false}>
            <View
              className="mx-3 mt-3 overflow-hidden rounded-[14px]"
              style={{ backgroundColor: t.surface }}
            >
              <Row label="Запланировано" v={totals.planned} color={t.sub} t={t} />
              <Sep t={t} />
              <Row label="Заработано" v={totals.earned} color={t.success} t={t} />
              <Sep t={t} />
              <Row label="Расход" v={totals.spent} color={t.danger} t={t} />
              <Sep t={t} />
              <Row
                label="Прибыль"
                v={totals.profit}
                color={totals.profit < 0 ? t.danger : t.accent}
                bold
                t={t}
              />
            </View>

            {methods.length > 0 ? (
              <>
                <Text
                  className="px-6 pb-1 pt-3"
                  style={{
                    fontSize: 11,
                    fontWeight: "700",
                    letterSpacing: 0.6,
                    textTransform: "uppercase",
                    color: t.faint,
                  }}
                >
                  По способам оплаты
                </Text>
                <View
                  className="mx-3 overflow-hidden rounded-[14px]"
                  style={{ backgroundColor: t.surface }}
                >
                  {methods.map((m, i) => (
                    <View key={m.label}>
                      {i > 0 ? <Sep t={t} /> : null}
                      <Row label={m.label} v={m.v} color={t.ink} t={t} />
                    </View>
                  ))}
                </View>
              </>
            ) : null}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Row({
  label,
  v,
  color,
  bold,
  t,
}: {
  label: string;
  v: number;
  color: string;
  bold?: boolean;
  t: { ink: string };
}) {
  return (
    <View className="flex-row items-center justify-between px-4 py-3">
      <Text
        maxFontSizeMultiplier={1.3}
        style={{ fontSize: 15, fontWeight: bold ? "600" : "400", color: t.ink }}
      >
        {label}
      </Text>
      <Text
        className="tabular-nums"
        maxFontSizeMultiplier={1.3}
        style={{ fontSize: 15, fontWeight: "600", color }}
      >
        {formatEUR(v)}
      </Text>
    </View>
  );
}

function Sep({ t }: { t: { separator: string } }) {
  return (
    <View style={{ height: 1, marginLeft: 16, backgroundColor: t.separator }} />
  );
}

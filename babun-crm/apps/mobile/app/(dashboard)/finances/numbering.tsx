import { useEffect, useState } from "react";
import { Alert, ScrollView, Text, TextInput, View } from "react-native";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { SwitchRow } from "@/components/ui/SwitchRow";
import { Spinner } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";
import { useThemeColors } from "@/theme/colors";
import { useTenant, useUpdateTenant } from "@/features/settings/tenant";
import { useNextInvoiceNumber } from "@/features/invoices/queries";
import { formatInvoiceNumber } from "@/features/invoices/numbering";

// НУМЕРАЦИЯ СЧЕТОВ — ЧЕТЫРЕ ВОПРОСА, А НЕ КОНСТРУКТОР ШАБЛОНОВ.
//
// Владелец 2026-08-10: «если к нам заходит новый бизнес, у него уже были
// выставлены инвойсы — номер должен идти с правильной структуры». Отсюда
// «Продолжить с номера»: у кого в старой программе последний счёт был №1420,
// продолжает с 1421, и серия не начинается заново.
//
// Закон (директива ЕС 2006/112, ст. 226) требует лишь последовательный номер,
// однозначно определяющий документ. Ни «без пропусков», ни единственной серии
// он не требует — поэтому аннулированный счёт сохраняет свой номер, а мы не
// заставляем никого «закрывать дыры».
//
// Токенов вроде {YYYY} здесь нет намеренно: ни Xero, ни Zoho, ни Stripe их не
// дают, а объяснять шаблонный язык владельцу бригады — плохая сделка.

export default function InvoiceNumberingScreen() {
  const t = useThemeColors();
  const toast = useToast();
  const tenant = useTenant();
  const update = useUpdateTenant();
  const nextNumber = useNextInvoiceNumber(new Date().getFullYear());

  const [prefix, setPrefix] = useState("");
  const [padding, setPadding] = useState("3");
  const [continueFrom, setContinueFrom] = useState("");

  useEffect(() => {
    if (!tenant.data) return;
    setPrefix(tenant.data.invoice_prefix || "INV");
    setPadding(String(tenant.data.invoice_number_padding || 3));
    setContinueFrom(
      tenant.data.invoice_next_number ? String(tenant.data.invoice_next_number) : "",
    );
  }, [tenant.data]);

  if (tenant.isLoading || !tenant.data) {
    return (
      <Screen className="items-center justify-center">
        <Spinner size={28} label="Загрузка настроек нумерации" />
      </Screen>
    );
  }

  const data = tenant.data;
  const yearlyReset = data.invoice_number_yearly_reset;
  const save = (patch: Parameters<typeof update.mutate>[0]) =>
    update.mutate(patch, {
      onSuccess: () => toast("Сохранено", "success"),
      onError: (e) => Alert.alert("Не удалось сохранить", (e as Error).message),
    });

  const paddingValue = Math.min(8, Math.max(1, Number(padding) || 3));
  // Образец собирается той же формулой, что и сервер: человек должен видеть
  // именно тот номер, который получит документ.
  const sample = formatInvoiceNumber({
    prefix: prefix.trim() || "INV",
    year: new Date().getFullYear(),
    seq: Number(continueFrom) || 1,
    padding: paddingValue,
    yearlyReset,
  });

  return (
    <Screen>
      <ScreenHeader title="Нумерация счетов" />
      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 32 }}>
        <SectionCard>
          <View className="px-4 pb-3 pt-4">
            <Text className="text-xs" style={{ color: t.sub }}>
              Следующий счёт получит номер
            </Text>
            <Text className="mt-1 text-2xl font-bold" style={{ color: t.ink }}>
              {nextNumber.data ?? sample}
            </Text>
          </View>
        </SectionCard>

        <SectionEyebrow>Из чего собран номер</SectionEyebrow>
        <SectionCard>
          <Row
            label="Буквы"
            value={prefix}
            onChangeText={setPrefix}
            placeholder="INV"
            autoCapitalize="characters"
            onCommit={() => {
              const clean = prefix.trim().toUpperCase();
              if (!clean || clean === data.invoice_prefix) return;
              setPrefix(clean);
              save({ invoice_prefix: clean });
            }}
          />
          <Divider />
          <Row
            label="Знаков в номере"
            value={padding}
            onChangeText={setPadding}
            placeholder="3"
            keyboardType="number-pad"
            hint="3 → 001, 5 → 00001"
            onCommit={() => {
              if (paddingValue === data.invoice_number_padding) return;
              setPadding(String(paddingValue));
              save({ invoice_number_padding: paddingValue });
            }}
          />
          <Divider />
          <SwitchRow
            label="Начинать нумерацию заново каждый год"
            hint={
              yearlyReset
                ? "В номере стоит год, счётчик обнуляется 1 января"
                : "Сквозная нумерация: года в номере нет, счётчик не обнуляется"
            }
            value={yearlyReset}
            onChange={(on) => save({ invoice_number_yearly_reset: on })}
          />
        </SectionCard>

        <SectionEyebrow>Переезд со старой программы</SectionEyebrow>
        <SectionCard>
          <Row
            label="Продолжить с номера"
            value={continueFrom}
            onChangeText={setContinueFrom}
            placeholder="напр. 1421"
            keyboardType="number-pad"
            onCommit={() => {
              const value = Number(continueFrom);
              if (!continueFrom.trim()) {
                if (data.invoice_next_number != null) save({ invoice_next_number: null });
                return;
              }
              if (!Number.isInteger(value) || value < 1 || value > 1000000000) {
                Alert.alert("Номер не подходит", "Введите целое число от 1.");
                setContinueFrom(
                  data.invoice_next_number ? String(data.invoice_next_number) : "",
                );
                return;
              }
              if (value === data.invoice_next_number) return;
              save({ invoice_next_number: value });
            }}
          />
        </SectionCard>
        <Text className="mx-4 mt-1.5 text-xs" style={{ color: t.sub }}>
          Заполняется один раз при переезде: следующий счёт получит этот номер, а
          дальше нумерация пойдёт сама. Назад серия не двигается — это был бы
          повтор уже выданного номера.
        </Text>
      </ScrollView>
    </Screen>
  );
}

function Row({
  label,
  value,
  placeholder,
  hint,
  keyboardType,
  autoCapitalize,
  onChangeText,
  onCommit,
}: {
  label: string;
  value: string;
  placeholder: string;
  hint?: string;
  keyboardType?: "number-pad";
  autoCapitalize?: "characters";
  onChangeText: (value: string) => void;
  onCommit: () => void;
}) {
  const t = useThemeColors();
  return (
    <View className="flex-row items-center px-4 py-3" style={{ gap: 12 }}>
      <View style={{ flex: 1 }}>
        <Text className="text-base" style={{ color: t.ink }}>
          {label}
        </Text>
        {hint ? (
          <Text className="mt-0.5 text-xs" style={{ color: t.faint }}>
            {hint}
          </Text>
        ) : null}
      </View>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        onBlur={onCommit}
        onSubmitEditing={onCommit}
        placeholder={placeholder}
        placeholderTextColor={t.placeholder}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        keyboardAppearance="light"
        accessibilityLabel={label}
        className="min-w-20 rounded-xl px-3 py-2 text-[15px] font-semibold"
        // textAlign через style: NativeWind не доносит класс выравнивания до
        // TextInput (на это есть контрактный тест).
        style={{ backgroundColor: t.fill, color: t.ink, textAlign: "right" }}
      />
    </View>
  );
}

function Divider() {
  const t = useThemeColors();
  return <View className="ml-4 h-px" style={{ backgroundColor: t.separator }} />;
}

import { useEffect, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { Divider } from "@/components/ui/Divider";
import { SectionCard } from "@/components/ui/SectionCard";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { SwitchRow } from "@/components/ui/SwitchRow";
import { useToast } from "@/components/ui/Toast";
import { useThemeColors } from "@/theme/colors";
import { useTenant, useUpdateTenant } from "@/features/settings/tenant";
import { useNextInvoiceNumber } from "@/features/invoices/queries";
import { formatInvoiceNumber } from "@/features/invoices/numbering";
import { notify } from "@/lib/notify";

// БЛАНК ИНВОЙСА — НА СТРАНИЦЕ «РЕКВИЗИТЫ» (владелец 2026-09-30: «реквизиты
// общие; счета клиентам — туда же; номер инвойса идёт от реквизитов»).
// Отдельной двери «Счета клиентам» больше нет: номер — у каждого набора
// реквизитов (в его карточке), а здесь то, что одно на все бланки: что
// подставлять в новый счёт, приписка и вид номера.
//
// Поле «Продолжить с номера» снято: после первого инвойса набора сервер его
// не читает (серия живёт на реквизитах), и правка ничего не меняла. Номер
// «этот инвойс — 104» правится в карточке реквизитов.
//
// ЭТО ТОЛЬКО ДЕФОЛТЫ. Выставленный счёт хранит свои строки, свой срок и свою
// приписку: поменяли настройку — старые документы не переписываются.

const LINE_SOURCE = [
  { value: "services", label: "Услуги строками" },
  { value: "total", label: "Одной строкой" },
] as const;

export function InvoiceSettingsBlocks() {
  const t = useThemeColors();
  const toast = useToast();
  const tenant = useTenant();
  const update = useUpdateTenant();
  const nextNumber = useNextInvoiceNumber(new Date().getFullYear());

  const [prefix, setPrefix] = useState("");
  const [padding, setPadding] = useState("3");
  const [dueDays, setDueDays] = useState("7");
  const [lineTitle, setLineTitle] = useState("");
  const [footer, setFooter] = useState("");

  useEffect(() => {
    if (!tenant.data) return;
    setPrefix(tenant.data.invoice_prefix || "INV");
    setPadding(String(tenant.data.invoice_number_padding || 3));
    setDueDays(String(tenant.data.invoice_due_days ?? 7));
    setLineTitle(tenant.data.invoice_default_line_title || "Услуги");
    setFooter(tenant.data.invoice_footer_note ?? "");
  }, [tenant.data]);

  if (!tenant.data) return null;

  const data = tenant.data;
  const yearlyReset = data.invoice_number_yearly_reset;
  const lineSource = data.invoice_line_source === "total" ? "total" : "services";
  const save = (patch: Parameters<typeof update.mutate>[0]) =>
    update.mutate(patch, {
      onSuccess: () => toast("Сохранено", "success"),
      onError: (e) => notify("Не удалось сохранить", (e as Error).message),
    });

  const paddingValue = Math.min(8, Math.max(1, Number(padding) || 3));
  // Образец собирается той же формулой, что и сервер: человек должен видеть
  // именно тот номер, который получит документ.
  const sample = formatInvoiceNumber({
    prefix: prefix.trim() || "INV",
    year: new Date().getFullYear(),
    seq: 1,
    padding: paddingValue,
    yearlyReset,
  });

  return (
    <>
    <SectionEyebrow>Что подставлять в новый счёт</SectionEyebrow>
    <SectionCard>
      <View className="px-4 pb-1 pt-3.5">
        <Text className="text-base" style={{ color: t.ink }}>
          Строки счёта по записи
        </Text>
        <Text className="mt-0.5 text-xs" style={{ color: t.faint }}>
          {lineSource === "services"
            ? "Каждая услуга визита — своя строка с количеством и ценой"
            : "Весь визит одной позицией на общую сумму"}
        </Text>
      </View>
      <View className="px-4 pb-3.5 pt-2">
        <SegmentedControl
          options={LINE_SOURCE}
          value={lineSource}
          onChange={(next) => {
            if (next === lineSource) return;
            save({ invoice_line_source: next });
          }}
        />
      </View>
      <Divider inset={16} />
      <Row
        label="Срок оплаты"
        hint={
          dueDays.trim() !== "" && Number(dueDays) === 0
            ? "Оплата по факту: срок — день выставления"
            : "Дней после выставления, потом счёт станет просроченным"
        }
        value={dueDays}
        onChangeText={setDueDays}
        placeholder="7"
        keyboardType="number-pad"
        onCommit={() => {
          // Стёртое поле — не «0 дней»: Number("") = 0 молча записывал
          // «оплата по факту» (аудит 2026-09-30). Пусто — вернуть как было.
          if (dueDays.trim() === "") {
            setDueDays(String(data.invoice_due_days ?? 7));
            return;
          }
          const value = Number(dueDays);
          if (!Number.isInteger(value) || value < 0 || value > 365) {
            notify("Срок не подходит", "Введите целое число от 0 до 365.");
            setDueDays(String(data.invoice_due_days ?? 7));
            return;
          }
          if (value === data.invoice_due_days) return;
          save({ invoice_due_days: value });
        }}
      />
      <Divider inset={16} />
      <Row
        label="Название строки"
        hint="Когда у записи нет услуг или выбрано «одной строкой»"
        value={lineTitle}
        onChangeText={setLineTitle}
        placeholder="Услуги"
        wide
        onCommit={() => {
          const clean = lineTitle.trim();
          // Пустое название сделало бы документ без предмета: сумма есть,
          // а за что — нет. Возвращаем прежнее, а не сохраняем пустоту.
          if (!clean) {
            setLineTitle(data.invoice_default_line_title || "Услуги");
            return;
          }
          if (clean === data.invoice_default_line_title) return;
          setLineTitle(clean);
          save({ invoice_default_line_title: clean });
        }}
      />
    </SectionCard>

    <SectionEyebrow>Приписка внизу счёта</SectionEyebrow>
    <SectionCard>
      <TextInput
        value={footer}
        onChangeText={setFooter}
        onBlur={() => {
          const clean = footer.trim();
          const current = data.invoice_footer_note ?? "";
          if (clean === current) return;
          save({ invoice_footer_note: clean || null });
        }}
        multiline
        placeholder="Например: оплата в течение срока на IBAN CY00 0000 0000. Спасибо за доверие!"
        placeholderTextColor={t.placeholder}
        keyboardAppearance="light"
        accessibilityLabel="Приписка внизу счёта"
        className="px-4 py-3 text-[15px]"
        style={{ color: t.ink, minHeight: 88, textAlignVertical: "top" }}
      />
    </SectionCard>
    <Text className="mx-4 mt-1.5 text-xs" style={{ color: t.sub }}>
      Подставляется в каждый новый счёт и правится прямо в нём. Уже
      выставленные документы не меняются.
    </Text>

    <SectionEyebrow>Номер документа</SectionEyebrow>
    <SectionCard>
      <View className="px-4 pb-3 pt-3.5">
        <Text className="text-xs" style={{ color: t.sub }}>
          Следующий номер основных реквизитов
        </Text>
        <Text className="mt-1 text-2xl font-bold" style={{ color: t.ink }}>
          {nextNumber.data ?? sample}
        </Text>
      </View>
      <Divider inset={16} />
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
      <Divider inset={16} />
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
      <Divider inset={16} />
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
    <Text className="mx-4 mt-1.5 text-xs" style={{ color: t.sub }}>
      Закон требует одного: номер последовательный и однозначно определяет
      документ. Пропуски допустимы — поэтому аннулированный счёт сохраняет
      свой номер.
    </Text>

    </>
  );
}

function Row({
  label,
  value,
  placeholder,
  hint,
  keyboardType,
  autoCapitalize,
  wide,
  onChangeText,
  onCommit,
}: {
  label: string;
  value: string;
  placeholder: string;
  hint?: string;
  keyboardType?: "number-pad";
  autoCapitalize?: "characters";
  /** Текстовое значение длиннее числа — поле забирает половину строки. */
  wide?: boolean;
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
        className="rounded-[10px] px-3 py-2 text-[15px] font-semibold"
        // textAlign через style: NativeWind не доносит класс выравнивания до
        // TextInput (на это есть контрактный тест).
        style={{
          backgroundColor: t.fill,
          color: t.ink,
          textAlign: "right",
          minWidth: wide ? 140 : 80,
        }}
      />
    </View>
  );
}

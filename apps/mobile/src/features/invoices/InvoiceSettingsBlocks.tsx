import { useEffect, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { Divider } from "@/components/ui/Divider";
import { SectionCard } from "@/components/ui/SectionCard";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useToast } from "@/components/ui/Toast";
import { useThemeColors } from "@/theme/colors";
import { useTenant, useUpdateTenant } from "@/features/settings/tenant";
import { notify } from "@/lib/notify";

// БЛАНК ИНВОЙСА — НА СТРАНИЦЕ «РЕКВИЗИТЫ» (владелец 2026-09-30: «реквизиты
// общие; счета клиентам — туда же; номер инвойса идёт от реквизитов»).
// Отдельной двери «Счета клиентам» больше нет: номер — у каждого набора
// реквизитов (в его карточке), а здесь то, что одно на все бланки: что
// подставлять в новый счёт, приписка и вид номера.
//
// Блок «Номер» (буквы, знаков в номере, «заново каждый год») снят 2026-10-01
// (STORY-101): серия — у юрлица, свои INV, REC и CN, год в номере всегда (закон
// о VAT Кипра), а буквы и разрядность серии — свойство юрлица. Старт серии
// («первый инвойс — 104») задаётся в карточке реквизитов.
//
// БЛОКИ — С ШАПКОЙ ВНУТРИ, как в карточке реквизитов (`CompanySheet`) и в
// записи: подпись над карточкой была старым видом раздела и на соседних
// страницах уже не встречается.
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

  const [dueDays, setDueDays] = useState("7");
  const [lineTitle, setLineTitle] = useState("");
  const [footer, setFooter] = useState("");

  useEffect(() => {
    if (!tenant.data) return;
    setDueDays(String(tenant.data.invoice_due_days ?? 7));
    setLineTitle(tenant.data.invoice_default_line_title || "Услуги");
    setFooter(tenant.data.invoice_footer_note ?? "");
  }, [tenant.data]);

  if (!tenant.data) return null;

  const data = tenant.data;
  const lineSource = data.invoice_line_source === "total" ? "total" : "services";
  const save = (patch: Parameters<typeof update.mutate>[0]) =>
    update.mutate(patch, {
      onSuccess: () => toast("Сохранено", "success"),
      onError: (e) => notify("Не удалось сохранить", (e as Error).message),
    });

  return (
    <>
    <SectionCard title="Новый счёт">
      <View className="px-4 pb-1 pt-2">
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

    <SectionCard title="Приписка внизу">
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
        className="px-4 pb-3 pt-1 text-[15px]"
        style={{ color: t.ink, minHeight: 88, textAlignVertical: "top" }}
      />
    </SectionCard>
    <Text className="mx-4 mt-1.5 text-xs" style={{ color: t.sub }}>
      Правится и в самом счёте. Выставленные счета не меняются.
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
  wide,
  onChangeText,
  onCommit,
}: {
  label: string;
  value: string;
  placeholder: string;
  hint?: string;
  keyboardType?: "number-pad";
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

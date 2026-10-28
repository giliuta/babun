import { useState } from "react";
import { ScrollView, View } from "react-native";

import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { DateWheelSheet } from "@/components/ui/DateWheelSheet";
import { ColumnDoorRow, FieldRow } from "@/components/ui/card-rows";
import { SectionCard } from "@/components/ui/SectionCard";
import { FOOTER_SIDE } from "@/components/ui/tokens";
import { formatShortDateRu } from "@/features/clients/format";
import { PERSON_COLUMN } from "@/features/clients/contact-column";
import type { MasterProfile } from "@/features/reference/master-profile";
import type { Master } from "@/features/reference/queries";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

import { useMasterProfileWrite } from "./use-profile-write";

// «ЛИЧНОЕ» И «ВЫПЛАТЫ» ПАРТНЁРА — СТРОКАМИ, КАК «ДОСТУП» НА ЭТОЙ ЖЕ СТРАНИЦЕ
// Строка — цветная плитка, название, значение второй строкой и стрелка; тап —
// шторка: даты — барабаном, адрес — полем, реквизиты для выплат — одним листом из трёх полей
// (их присылают одним сообщением) с курсором в том, по которому тапнули.

type DateField = "birthday" | "hire_date";
type TextKey = "address" | "bank_name" | "iban" | "tax_number";

const pad = (n: number) => String(n).padStart(2, "0");
const localYmd = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const PAYOUT_FIELDS: { key: Exclude<TextKey, "address">; label: string }[] = [
  { key: "bank_name", label: "Банк" },
  { key: "iban", label: "IBAN" },
  { key: "tax_number", label: "Налоговый номер" },
];

const clean = (key: TextKey, value: string) =>
  key === "iban" ? value.replace(/\s+/g, " ").trim() : value.trim();

export function PartnerPersonalBlocks({
  card,
  joinedAt,
  readOnly,
}: {
  card: Master;
  /** Когда принял приглашение — «С нами с», пока дату не поставили руками. */
  joinedAt?: string | null;
  readOnly: boolean;
}) {
  const { profile, write } = useMasterProfileWrite(card);
  const [dateOpen, setDateOpen] = useState<DateField | null>(null);
  const [sheet, setSheet] = useState<{ keys: TextKey[]; focus: TextKey } | null>(null);
  const stored = (field: DateField) => (profile[field] as string | undefined) || null;
  const dateValue = (field: DateField) =>
    stored(field) ?? (field === "hire_date" && joinedAt ? localYmd(joinedAt) : null);
  const text = (key: TextKey) => ((profile[key] as string | undefined) ?? "").trim();
  const open = (run: () => void) =>
    readOnly
      ? undefined
      : () => {
          haptics.tap();
          run();
        };

  // СТРОКИ — КОЛОНКОЙ, КАК «ПРОФИЛЬ» И ПОЛЯ ПАРТНЁРА ВЫШЕ: подпись слева,
  // значение рядом, правка за дверью (`ColumnDoorRow`). Плитка с подписью
  // второй строкой была третьим способом показать данные человека.
  const row = (
    i: number,
    label: string,
    value: string | null,
    placeholder: string,
    onPress?: () => void,
  ) => (
    <ColumnDoorRow
      key={label}
      separated={i > 0}
      label={label}
      value={value}
      placeholder={placeholder}
      column={PERSON_COLUMN}
      onPress={onPress}
    />
  );

  const birthday = dateValue("birthday");
  const since = dateValue("hire_date");
  const payoutKeys: TextKey[] = PAYOUT_FIELDS.map((f) => f.key);

  return (
    <>
      <SectionCard title="Личное" padded={false}>
        {row(0, "День рождения", birthday ? formatShortDateRu(birthday) : null, "Дата", open(() => setDateOpen("birthday")))}
        {row(1, "С нами с", since ? formatShortDateRu(since) : null, "Дата", open(() => setDateOpen("hire_date")))}
        {row(2, "Адрес", text("address") || null, "Адрес", open(() => setSheet({ keys: ["address"], focus: "address" })))}
      </SectionCard>
      <SectionCard title="Выплаты" padded={false}>
        {PAYOUT_FIELDS.map((field, i) =>
          row(i, field.label, text(field.key) || null, field.label, open(() => setSheet({ keys: payoutKeys, focus: field.key }))),
        )}
      </SectionCard>

      <DateWheelSheet
        visible={dateOpen !== null}
        title={dateOpen === "birthday" ? "День рождения" : "С нами с"}
        value={dateOpen ? dateValue(dateOpen) : null}
        // День рождения не с сегодняшней даты: у неё смысла нет.
        seed={dateOpen === "birthday" ? "1990-01-01" : undefined}
        clearLabel={dateOpen && stored(dateOpen) ? "Убрать дату" : undefined}
        onApply={(ymd) => {
          if (dateOpen) write({ [dateOpen]: ymd } as MasterProfile);
          setDateOpen(null);
        }}
        onClear={() => {
          if (dateOpen) write({ [dateOpen]: null } as unknown as MasterProfile);
          setDateOpen(null);
        }}
        onClose={() => setDateOpen(null)}
      />
      <TextFieldsSheet
        open={sheet}
        initial={text}
        onClose={() => setSheet(null)}
        onApply={(patch) => {
          write(patch as MasterProfile);
          setSheet(null);
        }}
      />
    </>
  );
}

const SHEET_FIELD: Record<TextKey, { label: string; caps: "words" | "characters" | "sentences"; multiline?: boolean }> = {
  address: { label: "Адрес", caps: "sentences", multiline: true },
  bank_name: { label: "Банк", caps: "words" },
  iban: { label: "IBAN", caps: "characters" },
  tax_number: { label: "Налоговый номер", caps: "characters" },
};

/** Лист полей — как лист реквизитов клиента: поля стопкой, «Применить»
 *  внизу, закрыли фоном с правкой — набранное сохраняется. */
function TextFieldsSheet({
  open,
  initial,
  onClose,
  onApply,
}: {
  open: { keys: TextKey[]; focus: TextKey } | null;
  initial: (key: TextKey) => string;
  onClose: () => void;
  onApply: (patch: Partial<Record<TextKey, string | null>>) => void;
}) {
  const t = useThemeColors();
  const [form, setForm] = useState<Partial<Record<TextKey, string>>>({});
  const [shownFor, setShownFor] = useState<typeof open>(null);
  // Открыли заново — поля с сохранённого.
  if (open && open !== shownFor) {
    setShownFor(open);
    setForm(Object.fromEntries(open.keys.map((key) => [key, initial(key)])));
  }
  const keys = open?.keys ?? shownFor?.keys ?? [];
  const changed = keys.some((key) => clean(key, form[key] ?? "") !== initial(key));
  const apply = () =>
    onApply(Object.fromEntries(keys.map((key) => [key, clean(key, form[key] ?? "") || null])));
  const title = keys.length > 1 ? "Выплаты" : SHEET_FIELD[keys[0] ?? "address"].label;
  return (
    <BottomSheet
      visible={open !== null}
      onClose={() => (changed ? apply() : onClose())}
      title={title}
      padded={false}
      maxHeightRatio={0.92}
      avoidKeyboard
      footer={
        <View style={{ paddingHorizontal: FOOTER_SIDE }}>
          <Button label="Применить" disabled={!changed} onPress={apply} />
        </View>
      }
    >
      <ScrollView
        style={{ flexShrink: 1, backgroundColor: t.canvas }}
        contentContainerStyle={{ paddingTop: 8, paddingBottom: 16 }}
        keyboardShouldPersistTaps="handled"
      >
        <SectionCard dense title={keys.length > 1 ? "Куда платить" : undefined}>
          {keys.map((key, i) => (
            <FieldRow
              key={key}
              label={SHEET_FIELD[key].label}
              value={form[key] ?? ""}
              placeholder={SHEET_FIELD[key].label}
              addLabel="Добавить"
              stacked
              live
              tabular={key === "iban" || key === "tax_number"}
              multiline={SHEET_FIELD[key].multiline}
              separated={i > 0}
              autoCapitalize={SHEET_FIELD[key].caps}
              keyboardType={key === "iban" || key === "tax_number" ? "latin" : undefined}
              autoFocus={open?.focus === key}
              onSave={(v) => setForm((prev) => ({ ...prev, [key]: v }))}
            />
          ))}
        </SectionCard>
      </ScrollView>
    </BottomSheet>
  );
}

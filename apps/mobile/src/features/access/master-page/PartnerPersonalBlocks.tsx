import { useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { Cake, CalendarHeart, CreditCard, Hash, Landmark, MapPin, type LucideIcon } from "lucide-react-native";

import { DateWheelSheet } from "@/components/ui/DateWheelSheet";
import { SectionCard } from "@/components/ui/SectionCard";
import { SelectRow } from "@/components/ui/select-rows";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { formatShortDateRu } from "@/features/clients/format";
import type { MasterProfile } from "@/features/reference/master-profile";
import type { Master } from "@/features/reference/queries";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

import { useMasterProfileWrite } from "./use-profile-write";

// «ЛИЧНОЕ» И «ВЫПЛАТЫ» ПАРТНЁРА (владелец 04.10: «выплаты и личное —
// редизайн, в нашем дизайне, максимально удобно»; «Выплачено · €15 в октябре»
// он назвал лишним — его нет). Из двух вариантов остался второй: плашки со
// значками, как «SMS» у клиента — каждое поле своей плашкой с цветной
// плиткой, значение в мягкой плашке справа; даты — барабаном, текст правится
// на месте и сохраняется, когда поле отпускают.

type DateField = "birthday" | "hire_date";

const pad = (n: number) => String(n).padStart(2, "0");
const localYmd = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

type PayoutKey = "bank_name" | "iban" | "tax_number";

const PAYOUT_FIELDS: { key: PayoutKey; label: string; icon: LucideIcon; caps: "words" | "characters" }[] = [
  { key: "bank_name", label: "Банк", icon: Landmark, caps: "words" },
  { key: "iban", label: "IBAN", icon: CreditCard, caps: "characters" },
  { key: "tax_number", label: "Налоговый номер", icon: Hash, caps: "characters" },
];

const cleanPayout = (key: PayoutKey, value: string) =>
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
  const { profile, write, writeText } = useMasterProfileWrite(card);
  const [dateOpen, setDateOpen] = useState<DateField | null>(null);
  const stored = (field: DateField) => (profile[field] as string | undefined) || null;
  const dateValue = (field: DateField) =>
    stored(field) ?? (field === "hire_date" && joinedAt ? localYmd(joinedAt) : null);
  const openDate = readOnly
    ? undefined
    : (field: DateField) => {
        haptics.tap();
        setDateOpen(field);
      };
  const value = (key: PayoutKey | "address") => ((profile[key] as string | undefined) ?? "").trim();
  const save = (key: PayoutKey | "address", next: string) =>
    writeText(key, key === "address" ? next.trim() : cleanPayout(key as PayoutKey, next));

  const body = (
    <PlaqueLook dateValue={dateValue} value={value} save={save} openDate={openDate} readOnly={readOnly} />
  );

  return (
    <>
      {body}
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
    </>
  );
}

function PlaqueLook({
  dateValue,
  value,
  save,
  openDate,
  readOnly,
}: {
  dateValue: (field: DateField) => string | null;
  value: (key: PayoutKey | "address") => string;
  save: (key: PayoutKey | "address", next: string) => void;
  openDate?: (field: DateField) => void;
  readOnly: boolean;
}) {
  const t = useThemeColors();
  const tone = (on: string) => (readOnly ? t.faint : on);
  const dateRow = (field: DateField, title: string, icon: LucideIcon, color: string) => {
    const ymd = dateValue(field);
    return (
      <SelectRow
        icon={icon}
        color={tone(color)}
        plain
        title={title}
        disabled={readOnly}
        accessibilityLabel={`${title}: ${ymd ? formatShortDateRu(ymd) : "не указано"}`}
        onPress={() => openDate?.(field)}
        trailing={<Pill text={ymd ? formatShortDateRu(ymd) : "Выбрать"} muted={!ymd} />}
      />
    );
  };
  return (
    <>
      <SectionCard title="Личное" padded={false}>
        <View style={{ paddingHorizontal: 2, paddingTop: 2, paddingBottom: 4, gap: 2 }}>
          {dateRow("birthday", "День рождения", Cake, SETTINGS_TILE.red)}
          {dateRow("hire_date", "С нами с", CalendarHeart, SETTINGS_TILE.green)}
          <EditPlaque
            icon={MapPin}
            color={tone(SETTINGS_TILE.blue)}
            title="Адрес"
            value={value("address")}
            caps="sentences"
            readOnly={readOnly}
            onSave={(next) => save("address", next)}
          />
        </View>
      </SectionCard>
      <SectionCard title="Выплаты" padded={false}>
        <View style={{ paddingHorizontal: 2, paddingTop: 2, paddingBottom: 4, gap: 2 }}>
          {PAYOUT_FIELDS.map((field) => (
            <EditPlaque
              key={field.key}
              icon={field.icon}
              color={tone(t.accent)}
              title={field.label}
              value={value(field.key)}
              caps={field.caps}
              readOnly={readOnly}
              onSave={(next) => save(field.key, next)}
            />
          ))}
        </View>
      </SectionCard>
    </>
  );
}

function Pill({ text, muted }: { text: string; muted?: boolean }) {
  const t = useThemeColors();
  return (
    <View
      style={{
        minWidth: 96,
        height: 36,
        justifyContent: "center",
        alignItems: "center",
        paddingHorizontal: 12,
        borderRadius: t.radius.input,
        backgroundColor: `${t.accent}14`,
      }}
    >
      <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 15, color: muted ? t.placeholder : t.accent }}>
        {text}
      </Text>
    </View>
  );
}

/** Плашка со значком и значением в мягкой плашке справа — правится на месте,
 *  сохраняется, когда поле отпускают (как «Имя для SMS» у клиента). */
function EditPlaque({
  icon,
  color,
  title,
  value,
  caps,
  readOnly,
  onSave,
}: {
  icon: LucideIcon;
  color: string;
  title: string;
  value: string;
  caps: "words" | "characters" | "sentences";
  readOnly: boolean;
  onSave: (next: string) => void;
}) {
  const t = useThemeColors();
  const ref = useRef<TextInput>(null);
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <SelectRow
      icon={icon}
      color={color}
      plain
      title={title}
      disabled={readOnly}
      accessibilityLabel={`${title}: ${value || "не указан"}`}
      onPress={() => ref.current?.focus()}
      trailing={
        <View
          style={{
            minWidth: 96,
            maxWidth: 190,
            height: 36,
            justifyContent: "center",
            paddingHorizontal: 12,
            borderRadius: t.radius.input,
            backgroundColor: `${t.accent}14`,
          }}
        >
          <TextInput
            ref={ref}
            value={draft ?? value}
            editable={!readOnly}
            placeholder="не указан"
            placeholderTextColor={t.placeholder}
            selectionColor={t.accent}
            autoCapitalize={caps}
            autoCorrect={false}
            numberOfLines={1}
            onFocus={() => setDraft(value)}
            onChangeText={setDraft}
            onBlur={() => {
              if (draft !== null && draft.trim() !== value) onSave(draft);
              setDraft(null);
            }}
            style={{ fontSize: 15, color: t.accent, padding: 0, textAlign: "right" }}
          />
        </View>
      }
    />
  );
}

import { useState } from "react";
import { ScrollView, View } from "react-native";
import type { ClientRequisites } from "@babun/shared/local/clients";
import {
  REQUISITES_KEYS,
  type RequisitesFields,
} from "@babun/shared/local/client-requisites";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { FieldRow, RowCaption } from "@/components/ui/card-rows";
import { SectionCard } from "@/components/ui/SectionCard";
import { SwitchRow } from "@/components/ui/SwitchRow";
import { GUTTER } from "@/components/ui/tokens";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

// ЛИСТ ОДНОГО НАБОРА РЕКВИЗИТОВ — создание и правка одним телом (закон
// «одна сущность — одно тело»). Четыре поля разом: реквизиты почти всегда
// присылают одним сообщением (владелец 22.09: «продумай все нюансы»), и
// заводить их по полю за заход было нельзя.
//
// У НЕОСНОВНОГО набора, когда наборов больше одного, внизу — переключатель
// «Основные реквизиты», тем же видом и тем же законом, что у реквизитов своей
// компании (`CompanySheet`): ОДНОСТОРОННИЙ — основные назначают, а не
// снимают; снимаются они сами, когда основными делают другие.

const FIELDS: {
  key: (typeof REQUISITES_KEYS)[number];
  label: string;
  autoCapitalize?: "words" | "none";
  multiline?: boolean;
}[] = [
  { key: "legal_name", label: "Юридическое имя", autoCapitalize: "words" },
  { key: "vat_number", label: "VAT номер", autoCapitalize: "none" },
  { key: "reg_number", label: "Регистрационный номер", autoCapitalize: "none" },
  { key: "billing_address", label: "Юридический адрес", multiline: true },
];

type Form = Record<(typeof REQUISITES_KEYS)[number], string>;

const formOf = (set: ClientRequisites | null): Form => ({
  legal_name: set?.legal_name ?? "",
  vat_number: set?.vat_number ?? "",
  reg_number: set?.reg_number ?? "",
  billing_address: set?.billing_address ?? "",
});

/** Черновик листа → поля набора. Чистку (края, заглавные, пустое = null)
 *  делает нормализация писателя — та же, что у сервера. */
const fieldsOf = (form: Form): RequisitesFields => ({
  legal_name: form.legal_name,
  vat_number: form.vat_number,
  reg_number: form.reg_number,
  billing_address: form.billing_address,
});

export function RequisitesSheet({
  visible,
  set,
  canMakeDefault,
  onClose,
  onSave,
  onMakeDefault,
}: {
  visible: boolean;
  /** Правимый набор; `null` — новый. */
  set: ClientRequisites | null;
  /** Показать переключатель основного (наборов больше одного). */
  canMakeDefault: boolean;
  onClose: () => void;
  onSave: (fields: RequisitesFields) => Promise<boolean>;
  onMakeDefault: () => void;
}) {
  const t = useThemeColors();
  const [form, setForm] = useState<Form>(() => formOf(set));
  const [saving, setSaving] = useState(false);
  // Курсор — в первое пустое поле НА МОМЕНТ ОТКРЫТИЯ: считать его на каждом
  // рендере нельзя, вписали имя — «первое пустое» уехало бы на VAT посреди
  // набора.
  const [focusKey] = useState(
    () => FIELDS.find((f) => !formOf(set)[f.key].trim())?.key ?? null,
  );
  const typed = FIELDS.some((f) => form[f.key].trim().length > 0);
  // Правлено ли что-то относительно открытого набора.
  const changed = FIELDS.some((f) => form[f.key].trim() !== formOf(set)[f.key].trim());
  // ЗАКРЫЛИ ФОНОМ ИЛИ СВАЙПОМ — НАБРАННОЕ СОХРАНЯЕТСЯ, как в листе объекта
  // (аудит 22.09: вставили четыре поля, смахнули — всё пропало). Пустой
  // новый набор просто закрывается: сохранять нечего.
  // Закрываем, только когда записалось (аудит 23.09): сеть отказала — лист
  // остаётся открытым с набранным, а подсказка «Не удалось сохранить» уже
  // сказала почему. Иначе четыре поля исчезали вместе с листом.
  const dismiss = async () => {
    if (saving) return;
    if (changed && typed) {
      setSaving(true);
      const ok = await onSave(fieldsOf(form));
      setSaving(false);
      if (!ok) return;
    }
    onClose();
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={() => void dismiss()}
      title="Реквизиты"
      padded={false}
      maxHeightRatio={0.92}
      avoidKeyboard
      footer={
        <View style={{ paddingHorizontal: GUTTER }}>
          <Button
            label={set ? "Применить" : "Добавить реквизиты"}
            loading={saving}
            disabled={!typed || saving}
            onPress={async () => {
              setSaving(true);
              const ok = await onSave(fieldsOf(form));
              setSaving(false);
              if (ok) {
                haptics.success();
                onClose();
              }
            }}
          />
        </View>
      }
    >
      <ScrollView
        style={{ flexShrink: 1, backgroundColor: t.canvas }}
        contentContainerStyle={{ paddingTop: 8, paddingBottom: 16 }}
        keyboardShouldPersistTaps="handled"
      >
        <SectionCard dense title="На бумаге">
          {FIELDS.map((f, i) => (
            <FieldRow
              key={f.key}
              label={f.label}
              value={form[f.key]}
              placeholder={f.label}
              addLabel="Добавить"
              stacked
              live
              separated={i > 0}
              multiline={f.multiline}
              autoCapitalize={f.autoCapitalize}
              // Курсор сразу в первое пустое поле: лист открыли, чтобы
              // вписать, а не чтобы посмотреть.
              autoFocus={f.key === focusKey}
              onSave={(v) => setForm((prev) => ({ ...prev, [f.key]: v }))}
            />
          ))}
        </SectionCard>
        <RowCaption text="Печатается получателем в инвойсе этому клиенту." />
        {set && canMakeDefault ? (
          <SectionCard dense>
            <SwitchRow
              label="Основные реквизиты"
              hint="Их сам подставляет инвойс"
              value={set.is_default}
              disabled={set.is_default}
              // Сперва правки формы, потом «основные» (аудит 22.09: исправили
              // VAT, переключили — лист закрывался, и VAT пропадал). Очередь
              // писателя одна, порядок записей сохраняется.
              onChange={async (next) => {
                if (!next) return;
                if (changed && typed && !(await onSave(fieldsOf(form)))) return;
                onMakeDefault();
              }}
            />
          </SectionCard>
        ) : null}
      </ScrollView>
    </BottomSheet>
  );
}

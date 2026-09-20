import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { ControlRow, NavRow } from "@/components/ui/card-rows";
import { Field } from "@/components/ui/Field";
import { SectionCard } from "@/components/ui/SectionCard";
import { useThemeColors } from "@/theme/colors";
import type { Company, CompanyDraft } from "./queries";

// КАРТОЧКА РЕКВИЗИТОВ — ОДНА ФОРМА НА СОЗДАНИЕ И НА ПРАВКУ (тот же закон, что у
// объекта: «если я показываю в одном месте, значит то же самое будет
// показывать в другом»).
//
// ПОЛЯ — РОВНО ТЕ, ЧТО ПЕЧАТАЮТСЯ НА БУМАГЕ, и ни одного лишнего: имя внутри
// продукта, имя на документе, адрес, VAT, регистрационный номер, счёт в банке
// и связь. Каждое поле здесь однажды окажется в чужих руках — в чеке или
// инвойсе у клиента, — поэтому выдумывать сюда «заметку для себя» нельзя.

const EMPTY: CompanyDraft = {
  name: "",
  legal_name: null,
  business_address: null,
  vat_number: null,
  reg_number: null,
  iban: null,
  bank_name: null,
  contact_phone: null,
  contact_email: null,
};

export function CompanySheet({
  visible,
  company,
  saving,
  onSave,
  onMakeDefault,
  onClose,
}: {
  visible: boolean;
  /** `null` — заводим новую. */
  company: Company | null;
  saving: boolean;
  onSave: (patch: CompanyDraft) => void;
  /** Сделать эту компанию основной. `undefined` — она уже основная либо
   *  компания ещё не заведена: переключать нечего. */
  onMakeDefault?: () => void;
  onClose: () => void;
}) {
  const t = useThemeColors();
  const [draft, setDraft] = useState<CompanyDraft>(EMPTY);

  // Гидрация РАЗ НА ОТКРЫТИЕ: переписывать черновик на каждый рендер значит
  // затирать набранное под пальцем.
  useEffect(() => {
    if (!visible) return;
    setDraft(
      company
        ? {
            name: company.name,
            legal_name: company.legal_name,
            business_address: company.business_address,
            vat_number: company.vat_number,
            reg_number: company.reg_number,
            iban: company.iban,
            bank_name: company.bank_name,
            contact_phone: company.contact_phone,
            contact_email: company.contact_email,
          }
        : EMPTY,
    );
  }, [visible, company]);

  const set = (patch: Partial<CompanyDraft>) =>
    setDraft((prev) => ({ ...prev, ...patch }));
  const text = (value: string) => (value.trim() ? value : null);

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={company ? company.name || "Реквизиты" : "Новые реквизиты"}
      scroll
      avoidKeyboard
      footer={
        <View style={{ paddingHorizontal: 20 }}>
          <Button
            label="Сохранить"
            loading={saving}
            disabled={!draft.name.trim()}
            onPress={() => onSave({ ...draft, name: draft.name.trim() })}
          />
        </View>
      }
    >
      <View style={{ gap: 10 }}>
        {/* ОСНОВНЫЕ — ЭТО ОТВЕТ НА ВОПРОС «ЧЕМ ПОДПИСАТЬ, ЕСЛИ НЕ ВЫБРАЛИ»
            (владелец 2026-09-20: «можно выбрать, что это будет как основное, но
            при этом можно выбирать другие»). Переключатель ОДНОСТОРОННИЙ:
            основные назначают, а не снимают — компания без основных реквизитов
            оставила бы документ без продавца. Снимаются они сами, когда
            основными делают другие. */}
        {company ? (
          <SectionCard>
            {company.is_default ? (
              <ControlRow label="Основные реквизиты">
                <Text style={{ fontSize: 15, fontWeight: "600", color: t.accent }}>
                  Да
                </Text>
              </ControlRow>
            ) : (
              <NavRow
                label="Сделать основными"
                value="Их подставляет чек по умолчанию"
                onPress={onMakeDefault}
              />
            )}
          </SectionCard>
        ) : null}
        <Field
          label="Название"
          value={draft.name}
          onChangeText={(name) => set({ name })}
          autoCapitalize="words"
          placeholder="Как называть этот набор внутри"
        />
        <Field
          label="Юридическое имя"
          value={draft.legal_name ?? ""}
          onChangeText={(v) => set({ legal_name: text(v) })}
          autoCapitalize="words"
          placeholder="Как печатать на документе"
        />
        <Field
          label="Юридический адрес"
          value={draft.business_address ?? ""}
          onChangeText={(v) => set({ business_address: text(v) })}
          multiline
        />
        <Field
          label="VAT номер"
          value={draft.vat_number ?? ""}
          onChangeText={(v) => set({ vat_number: text(v) })}
          autoCapitalize="characters"
        />
        <Field
          label="Регистрационный номер"
          value={draft.reg_number ?? ""}
          onChangeText={(v) => set({ reg_number: text(v) })}
          autoCapitalize="characters"
        />
        <Field
          label="IBAN"
          value={draft.iban ?? ""}
          onChangeText={(v) => set({ iban: text(v) })}
          autoCapitalize="characters"
        />
        <Field
          label="Банк"
          value={draft.bank_name ?? ""}
          onChangeText={(v) => set({ bank_name: text(v) })}
        />
        <Field
          label="Телефон"
          value={draft.contact_phone ?? ""}
          onChangeText={(v) => set({ contact_phone: text(v) })}
          keyboardType="phone-pad"
        />
        <Field
          label="Почта"
          value={draft.contact_email ?? ""}
          onChangeText={(v) => set({ contact_email: text(v) })}
          keyboardType="email-address"
          autoCapitalize="none"
        />
      </View>
    </BottomSheet>
  );
}

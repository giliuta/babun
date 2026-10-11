import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { tDynamic } from "@babun/shared/i18n/runtime";
import { isOnline, useIsOnline } from "@babun/shared/sync";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Field } from "@/components/ui/Field";
import { GradientButton } from "@/components/ui/GradientButton";
import { useToast } from "@/components/ui/Toast";
import { GUTTER } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import { useCreateCompany } from "./company-actions";

// НОВАЯ КОМПАНИЯ (владелец 11.10, макет «Личное и Компании»). Один вопрос —
// название. Тариф здесь не выбирают: первые 14 дней Про — сразу, дальше тариф
// в Кабинете компании. Первый календарь сервер заводит с именем компании, и
// телефон тут же переходит в неё.
export function CreateCompanySheet({
  visible,
  onClose,
  onCreated,
  firstCompany,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: (tenantId: string) => void;
  /** Своих компаний ещё нет — пробный, скорее всего, будет (решает сервер). */
  firstCompany: boolean;
}) {
  const t = useThemeColors();
  const online = useIsOnline();
  const toast = useToast();
  const create = useCreateCompany();
  const [name, setName] = useState("");
  const [failure, setFailure] = useState<string | null>(null);

  // Лист живёт в дереве и гасится пропом — черновик сбрасывается явно.
  useEffect(() => {
    if (visible) {
      setName("");
      setFailure(null);
    }
  }, [visible]);

  const canSave = online && name.trim().length > 0 && !create.isPending;
  const footerNote =
    failure ??
    (!online ? "Нет связи — компанию не создать" : firstCompany ? "Первые 14 дней — бесплатно" : null);

  const submit = async () => {
    if (!isOnline()) {
      setFailure("Нет связи — компанию не создать");
      return;
    }
    setFailure(null);
    try {
      const created = await create.mutateAsync(name.trim());
      toast(created.trial ? "Компания создана · 14 дней Про бесплатно" : "Компания создана", "success");
      onCreated(created.tenantId);
      onClose();
    } catch (e) {
      setFailure(e instanceof Error ? tDynamic(e.message) : "Не удалось создать компанию");
    }
  };

  return (
    <BottomSheet
      padded={false}
      visible={visible}
      onClose={onClose}
      title="Новая компания"
      avoidKeyboard
      footer={
        <View style={{ paddingHorizontal: GUTTER }}>
          {footerNote ? (
            <Text
              accessibilityLiveRegion="polite"
              className="mb-2 text-center text-[13px]"
              style={{ color: failure ? t.danger : t.sub }}
            >
              {footerNote}
            </Text>
          ) : null}
          <GradientButton
            label="Создать компанию"
            onPress={submit}
            disabled={!canSave}
            loading={create.isPending}
          />
        </View>
      }
    >
      <View style={{ paddingHorizontal: GUTTER, paddingTop: 4 }}>
        <Field
          label=""
          placeholder="Название компании"
          value={name}
          onChangeText={(v) => {
            setName(v);
            setFailure(null);
          }}
          maxLength={80}
          autoFocus
          returnKeyType="done"
          onSubmitEditing={() => {
            if (canSave) void submit();
          }}
        />
      </View>
    </BottomSheet>
  );
}

import { useState } from "react";
import { Text } from "react-native";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Field } from "@/components/ui/Field";
import { GradientButton } from "@/components/ui/GradientButton";
import { useToast } from "@/components/ui/Toast";
import { haptics } from "@/lib/haptics";
import { notify } from "@/lib/notify";
import { useThemeColors } from "@/theme/colors";
import { senderProblem, smsErrorText, useSaveTeamSender } from "./sms-account";

// ИМЯ ОТПРАВИТЕЛЯ КОМАНДЫ (STORY-089, волна 10; владелец 29.09: «от какого
// имени отправляется — в каждой команде можно написать имя»). Так SMS
// подписана в телефоне клиента. На Кипре имя не регистрируется заранее —
// действует сразу. Правила операторов: до 11 знаков, латиница, цифры и
// пробел, хотя бы одна буква; кириллицу операторы не пропускают. Пустое
// поле снимает имя — тогда команда не отправляет.

export function SmsSenderSheet({
  visible,
  teamId,
  current,
  onClose,
}: {
  visible: boolean;
  teamId: string;
  current: string | null;
  onClose: () => void;
}) {
  const t = useThemeColors();
  const toast = useToast();
  const save = useSaveTeamSender();
  const [name, setName] = useState(current ?? "");
  const [seeded, setSeeded] = useState(false);
  if (visible && !seeded) {
    setSeeded(true);
    setName(current ?? "");
  }
  if (!visible && seeded) setSeeded(false);

  const problem = senderProblem(name);

  const submit = () => {
    if (problem) return;
    save.mutate(
      { teamId, name },
      {
        onSuccess: () => {
          onClose();
          toast(name.trim() ? "Имя отправителя сохранено" : "Имя отправителя снято", "success");
        },
        onError: (e) => notify("Не удалось сохранить", smsErrorText(e)),
      },
    );
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Имя отправителя"
      avoidKeyboard
      footer={
        <GradientButton
          label="Сохранить"
          onPress={submit}
          disabled={!!problem || save.isPending}
          loading={save.isPending}
          onDisabledPress={
            problem
              ? () => {
                  haptics.warning();
                  toast(problem, "info");
                }
              : undefined
          }
        />
      }
    >
      <Field
        label="Имя"
        placeholder="Например, Giliuta"
        value={name}
        onChangeText={setName}
        maxLength={11}
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus
        returnKeyType="done"
        onSubmitEditing={submit}
      />
      <Text
        maxFontSizeMultiplier={1.3}
        style={{ marginTop: -4, marginBottom: 12, fontSize: 14, lineHeight: 19, color: problem ? t.warning : t.sub }}
      >
        {problem ?? "Латиница, цифры и пробел, до 11 знаков"}
      </Text>
    </BottomSheet>
  );
}

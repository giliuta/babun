import { useState } from "react";
import { Share } from "react-native";
import * as Linking from "expo-linking";
import { Mail } from "lucide-react-native";

import { AppearanceTile } from "@/components/ui/AppearanceSheet";
import { BottomSheet, SHEET_EXIT_MS } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { notify } from "@/lib/notify";
import {
  invitationErrorMessage,
  invitationPath,
  invitationShareText,
  isInvitationEmail,
} from "@/features/settings/invitation-flow";
import { ROLE_LABELS } from "@/features/settings/role-policy";
import { useCreateInvitation } from "@/features/settings/team-access";
import { useTenant } from "@/features/settings/tenant";

// «ДОБАВИТЬ МАСТЕРА» — ЭТО ПРИГЛАШЕНИЕ ПО ПОЧТЕ (STORY-081; владелец 14.09 на
// старой модалке «Имя · Телефон»: «мы договорились по почте»). Карточки по
// имени и телефону больше нет: мастер — аккаунт, принявший приглашение в этот
// календарь. Роль — мастер: из двух ролей приглашения она ближе всего к
// «по умолчанию всё выключено»; права настраиваются на его экране после приёма.
//
// ПИСЕМ BABUN ПОКА НЕ ШЛЁТ (почтовый сервис не подключён), поэтому ссылка
// уходит системным «Поделиться» — тем же текстом, что в «Доступ в CRM».
// Приглашение выписано на почту: принять его может только этот аккаунт.

/** Отказ сервера словами. Мастера без карточки сервер пускает только после
 *  правки 006 (`create_invitation`, `accept_invitation`, `handle_new_user`);
 *  до неё английская строка не должна доходить до владельца. */
function inviteErrorText(message: string): string {
  if (/requires an employee card|employee card is unavailable/i.test(message)) {
    return "Приглашение мастера по почте ещё включается. Попробуйте чуть позже.";
  }
  return invitationErrorMessage(message);
}

/** Ссылка приглашения — системным «Поделиться». Звать только после того, как
 *  лист уехал: окно поверх уезжающего листа не появляется (`SHEET_EXIT_MS`). */
export async function shareInvitation(args: {
  email: string;
  token: string;
  tenantName: string | null | undefined;
}): Promise<void> {
  const url = Linking.createURL(invitationPath(args.token));
  await Share.share({
    title: `Приглашение для ${args.email}`,
    message: invitationShareText({
      tenantName: args.tenantName,
      roleLabel: ROLE_LABELS.master,
      url,
    }),
    url,
  });
}

export const waitSheetExit = () =>
  new Promise<void>((resolve) => setTimeout(resolve, SHEET_EXIT_MS));

export function InviteMemberSheet({
  visible,
  teamId,
  teamName,
  onClose,
}: {
  visible: boolean;
  teamId: string;
  teamName: string | undefined;
  onClose: () => void;
}) {
  const tenantQuery = useTenant();
  const createInvitation = useCreateInvitation();
  const [email, setEmail] = useState("");
  const valid = isInvitationEmail(email);

  const close = () => {
    setEmail("");
    onClose();
  };

  const invite = async () => {
    if (!valid || createInvitation.isPending) return;
    try {
      const invitation = await createInvitation.mutateAsync({
        email,
        role: "master",
        masterId: null,
        teamId,
      });
      close();
      await waitSheetExit();
      try {
        await shareInvitation({
          email: invitation.email,
          token: invitation.token,
          tenantName: tenantQuery.data?.name,
        });
      } catch {
        notify("Приглашение создано", "Ссылку можно отправить позже: нажмите на почту в «Ждут ответа».");
      }
    } catch (error) {
      notify("Не удалось пригласить", inviteErrorText((error as Error).message));
    }
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={close}
      title="Пригласить мастера"
      subtitle={teamName}
      avoidKeyboard
      // Кнопка листа — `Button`, как «Создать» у «Новой метки». Боковые отступы
      // задаёт сам `SheetFooter` (GUTTER): своя обёртка делала кнопку уже поля.
      footer={
        <Button
          label="Пригласить"
          onPress={() => void invite()}
          disabled={!valid}
          loading={createInvitation.isPending}
        />
      }
    >
      {/* ПОЧТА — ОДНИМ БЛОКОМ, КАК «НАЗВАНИЕ» У МЕТКИ (владелец 14.09: «строчка
          почты — в едином блоке»): плитка слева внутри рамки, ввод справа.
          Подсказки нет: поле уже названо подписью. */}
      <Field
        label="Почта"
        leading={<AppearanceTile fallback={Mail} size={28} />}
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        textContentType="emailAddress"
        returnKeyType="send"
        autoFocus
        onSubmitEditing={() => void invite()}
      />
    </BottomSheet>
  );
}

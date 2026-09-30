import { useState } from "react";
import { Share } from "react-native";
import * as Linking from "expo-linking";
import { Mail, Phone, UserRound } from "lucide-react-native";

import { AppearanceTile } from "@/components/ui/AppearanceSheet";
import { BottomSheet, SHEET_EXIT_MS } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { notify } from "@/lib/notify";
import { formatPhoneAsYouType } from "@/features/clients/phone";
import { phoneToSave } from "@/features/profile/profile";
import {
  invitationErrorMessage,
  invitationPath,
  invitationShareText,
  isInvitationEmail,
} from "@/features/settings/invitation-flow";
import { useCreateInvitation } from "@/features/settings/team-access";

// «ДОБАВИТЬ МАСТЕРА» — ЭТО ПРИГЛАШЕНИЕ ПО ПОЧТЕ (STORY-081; владелец 14.09 на
// старой модалке «Имя · Телефон»: «мы договорились по почте»). Карточку по
// имени и телефону владелец больше не заводит: мастер — аккаунт, принявший
// приглашение в этот календарь, а карточку ему при приёме заводит сервер
// (`20260915040000_invited_master_gets_card.sql`).
//
// МИНИ-КАРТОЧКА ЧЕЛОВЕКА (владелец 15.09: «при отправке — имя, почта, номер
// телефона: мини-информация об этом человеке»). Почта — адрес приглашения и
// единственное обязательное поле; имя и телефон сервер кладёт в карточку
// мастера при приёме, а до ответа строка «Ждут ответа» называет человека по
// имени. Разбор номера — тот же, что у «Телефона» в «Профиле» (`phoneToSave`).
//
// ПРИГЛАШЕНИЕ ПРИХОДИТ В ПРИЛОЖЕНИЕ — в Кабинет приглашённого (разворот
// владельца 14.09), писем нет. Ссылку, если нужна, отправляют из «Ждут ответа»
// системным «Поделиться». Приглашение выписано на почту: принять его может
// только этот аккаунт.

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
    message: invitationShareText({ tenantName: args.tenantName, url }),
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
  const createInvitation = useCreateInvitation();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const valid = isInvitationEmail(email);

  const close = () => {
    setName("");
    setEmail("");
    setPhone("");
    onClose();
  };

  const invite = async () => {
    if (!valid || createInvitation.isPending) return;
    const phoneE164 = phoneToSave(phone);
    if (phoneE164 === undefined) {
      notify("Проверьте номер", "Номер не похож на телефон. Введите его с кодом страны.");
      return;
    }
    try {
      const invitation = await createInvitation.mutateAsync({
        email,
        role: "master",
        masterId: null,
        teamId,
        fullName: name,
        phone: phoneE164,
      });
      close();
      // ПРИГЛАШЕНИЕ ПРИХОДИТ В ПРИЛОЖЕНИЕ (разворот владельца 14.09): карточка
      // в Кабинете у приглашённого. Ответ одинаковый при любом аккаунте — есть
      // ли он, экран не раскрывает (006: без оракула).
      await waitSheetExit();
      notify(
        "Приглашение отправлено",
        `${invitation.email} увидит его в Кабинете. Если человек ещё не зарегистрирован в Babun — пусть зарегистрируется, потом отправьте приглашение ещё раз.`,
      );
    } catch (error) {
      notify("Не удалось пригласить", invitationErrorMessage((error as Error).message));
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
      {/* ПОЛЯ — ОДНИМ БЛОКОМ С ПЛИТКОЙ, КАК ПОЧТА (владелец 14.09: «строчка
          почты — в едином блоке»): плитка слева внутри рамки, ввод справа.
          Подсказок нет: поле уже названо подписью. */}
      <Field
        label="Имя"
        leading={<AppearanceTile fallback={UserRound} size={28} />}
        value={name}
        onChangeText={setName}
        autoCapitalize="words"
        autoCorrect={false}
        autoComplete="name"
        textContentType="name"
        returnKeyType="next"
        autoFocus
      />
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
        returnKeyType="next"
      />
      <Field
        label="Телефон"
        leading={<AppearanceTile fallback={Phone} size={28} />}
        value={phone}
        onChangeText={(value) => setPhone(formatPhoneAsYouType(value))}
        keyboardType="phone-pad"
        autoComplete="tel"
        textContentType="telephoneNumber"
        returnKeyType="send"
        onSubmitEditing={() => void invite()}
      />
    </BottomSheet>
  );
}

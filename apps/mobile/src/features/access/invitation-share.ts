import { Share } from "react-native";
import { SHEET_EXIT_MS } from "@/components/ui/BottomSheet";
import { invitationShareText, invitationShareUrl } from "@/features/settings/invitation-flow";

// ПРИГЛАШЕНИЕ ПРИХОДИТ В ПРИЛОЖЕНИЕ — в Кабинет приглашённого, писем нет.
// Ссылку, если нужна, отправляют из «Ждут ответа» системным «Поделиться».
// Приглашение выписано на почту: принять его может только этот аккаунт.

/** Ссылка приглашения — системным «Поделиться». Звать только после того, как
 *  лист уехал: окно поверх уезжающего листа не появляется (`SHEET_EXIT_MS`). */
export async function shareInvitation(args: {
  email: string;
  token: string;
  tenantName: string | null | undefined;
}): Promise<void> {
  const url = invitationShareUrl(args.token);
  await Share.share({
    title: `Приглашение для ${args.email}`,
    message: invitationShareText({ tenantName: args.tenantName, url }),
    url,
  });
}

export const waitSheetExit = () =>
  new Promise<void>((resolve) => setTimeout(resolve, SHEET_EXIT_MS));

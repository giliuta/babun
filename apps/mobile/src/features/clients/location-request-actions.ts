import { useCallback } from "react";
import { useToast } from "@/components/ui/Toast";
import { chooseOption } from "@/lib/choose";
import { haptics } from "@/lib/haptics";
import { useTenant } from "@/features/settings/tenant";
import {
  locationRequestLink,
  locationRequestShareText,
  locationRequestState,
  type LocationRequest,
} from "@/features/clients/location-request-link";
import {
  useCancelLocationRequest,
  useCreateLocationRequest,
} from "@/features/clients/location-requests";
import {
  canCopyLink,
  copyLink,
  shareLink,
} from "@/features/clients/location-request-share";

// ДЕЙСТВИЯ СО ССЫЛКОЙ КЛИЕНТУ (STORY-077): выписать и поделиться, поделиться
// ещё раз, скопировать, отозвать. Одна точка на карточку клиента и форму
// записи — строка «Ждём адрес» и «Попросить адрес у клиента» зовут её.

export function useLocationRequestActions() {
  const tenant = useTenant();
  const businessName = tenant.data?.name ?? null;
  const toast = useToast();
  const create = useCreateLocationRequest();
  const cancel = useCancelLocationRequest();

  const share = useCallback(
    async (token: string) => {
      const outcome = await shareLink(
        locationRequestShareText(businessName),
        locationRequestLink(token),
      );
      if (outcome === "copied") {
        haptics.success();
        toast("Ссылка скопирована", "success");
      } else if (outcome === "failed") {
        haptics.error();
        toast("Не удалось поделиться ссылкой", "error");
      }
      return outcome;
    },
    [businessName, toast],
  );

  /** Выписать ссылку клиенту и сразу открыть «Поделиться». Прежняя живая
   *  ссылка этого клиента гаснет на сервере — живая всегда одна. */
  const request = useCallback(
    async (clientId: string): Promise<boolean> => {
      try {
        const token = await create.mutateAsync(clientId);
        haptics.success();
        await share(token);
        return true;
      } catch (error) {
        haptics.error();
        toast(
          error instanceof Error ? error.message : "Не удалось создать ссылку",
          "error",
        );
        return false;
      }
    },
    [create, share, toast],
  );

  const copy = useCallback(
    async (token: string) => {
      const ok = await copyLink(locationRequestLink(token));
      toast(ok ? "Ссылка скопирована" : "Не удалось скопировать", ok ? "success" : "error");
    },
    [toast],
  );

  const revoke = useCallback(
    async (r: LocationRequest) => {
      try {
        await cancel.mutateAsync(r);
        haptics.success();
      } catch (error) {
        haptics.error();
        toast(
          error instanceof Error ? error.message : "Не удалось отозвать ссылку",
          "error",
        );
      }
    },
    [cancel, toast],
  );

  /** Меню строки «Ждём адрес» / «Ссылка устарела». */
  const menu = useCallback(
    async (r: LocationRequest) => {
      if (locationRequestState(r) === "expired") {
        const picked = await chooseOption("Ссылка устарела", [
          { label: "Выписать новую и поделиться" },
          { label: "Убрать", destructive: true },
        ]);
        if (picked === 0) await request(r.client_id);
        else if (picked === 1) await revoke(r);
        return;
      }
      const choices = [
        { label: "Поделиться ещё раз" },
        ...(canCopyLink() ? [{ label: "Скопировать ссылку" }] : []),
        { label: "Отозвать ссылку", destructive: true },
      ];
      const picked = await chooseOption("Ссылка клиенту", choices, {
        message: locationRequestLink(r.token),
      });
      if (picked === null) return;
      const label = choices[picked]?.label;
      if (label === "Поделиться ещё раз") await share(r.token);
      else if (label === "Скопировать ссылку") await copy(r.token);
      else if (label === "Отозвать ссылку") await revoke(r);
    },
    [copy, request, revoke, share],
  );

  return { request, share, menu, busy: create.isPending || cancel.isPending };
}

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useToast } from "@/components/ui/Toast";
import { memberAccessQueryKey } from "@/lib/company-query-keys";
import { useTenantId } from "@/lib/tenant";

import {
  levelOf as mapLevelOf,
  refusalOf,
  type AccessBlock,
  type AccessChange,
  type AccessLevel,
  type AccessRefusal,
  type MemberAccessMap,
} from "../access-map";
import { AccessRequestError, useSetMemberAccess } from "../queries";
import { templateBlocks, templateChanges, type AccessTemplate } from "../templates/templates";
import { MEMBER_REFUSAL_TEXT, levelChanges, withMemberChanges } from "./rights-rows";

// ЗАПИСЬ ПРАВ СОТРУДНИКА — ОДНА НА ГЛАВНУЮ СТРАНИЦУ И НА СТРАНИЦУ ПРАВ.
//
// Выбор уходит на сервер сразу: карта правится оптимистично, отказ
// возвращает прежнюю и говорит словами (`MEMBER_REFUSAL_TEXT`). Две записи
// не делят один снимок карты: пока летит первая, вторая не уходит — иначе
// откат второй вернул бы первую.

export const memberRefusal = (error: unknown): AccessRefusal =>
  error instanceof AccessRequestError ? refusalOf(error) : "other";

export function useMemberRightsWriter(userId: string, blocks: readonly AccessBlock[] | undefined) {
  const toast = useToast();
  const qc = useQueryClient();
  const tenantId = useTenantId();
  const setAccess = useSetMemberAccess(userId);
  /** Какая строка сейчас уезжает на сервер — она одна и пригашена. */
  const [saving, setSaving] = useState<string | null>(null);
  const key = memberAccessQueryKey(tenantId, userId);

  const pick = (block: AccessBlock, level: AccessLevel, teamId: string | null) => {
    if (!blocks || setAccess.isPending) return;
    // Сбрасываются ВСЕ зависимые, и неживые: их уровень хранится и заработает,
    // когда блок оживёт (`levelChanges`).
    const changes = levelChanges(blocks, block, level, teamId);
    if (!changes) return;
    setSaving(block.key);
    const previous = qc.getQueryData<MemberAccessMap>(key);
    if (previous) qc.setQueryData(key, withMemberChanges(previous, blocks, changes));
    setAccess.mutate(changes, {
      onError: (error) => {
        if (previous) qc.setQueryData(key, previous);
        toast(MEMBER_REFUSAL_TEXT[memberRefusal(error)], "error");
      },
      onSettled: () => setSaving(null),
    });
  };

  // ШАБЛОН — КОПИЕЙ В ЭТУ КОМАНДУ (владелец 29.09). Одна пачка в
  // `set_member_access`, оптимистично; «Отменить» возвращает прежние положения
  // тех же строк.
  const applyTemplate = (template: AccessTemplate, teamId: string, map: MemberAccessMap) => {
    if (!blocks || setAccess.isPending) return;
    const previous = qc.getQueryData<MemberAccessMap>(key) ?? map;
    const undo: AccessChange[] = templateBlocks(blocks).map((block) => ({
      block: block.key,
      team_id: teamId,
      level: mapLevelOf(block, previous, teamId),
    }));
    const changes = templateChanges(blocks, template, teamId);
    qc.setQueryData(key, withMemberChanges(previous, blocks, changes));
    setAccess.mutate(changes, {
      onSuccess: () =>
        toast(`Права по шаблону «${template.name}»`, "success", {
          label: "Отменить",
          onPress: () =>
            setAccess.mutate(undo, {
              onError: (error) => toast(MEMBER_REFUSAL_TEXT[memberRefusal(error)], "error"),
            }),
        }),
      onError: (error) => {
        qc.setQueryData(key, previous);
        toast(MEMBER_REFUSAL_TEXT[memberRefusal(error)], "error");
      },
    });
  };

  return {
    pick,
    applyTemplate,
    pending: setAccess.isPending,
    /** Строка, что сейчас сохраняется (`null` — ничего не летит). */
    busyKey: setAccess.isPending ? saving : null,
  };
}

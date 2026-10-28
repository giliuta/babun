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
} from "@/session/access-map";
import { AccessRequestError, useSetMemberAccess } from "@/session/access-queries";
import { MEMBER_REFUSAL_TEXT, levelChanges, withMemberChanges } from "./rights-rows";

// ЗАПИСЬ ПРАВ СОТРУДНИКА — ОДНА НА ГЛАВНУЮ СТРАНИЦУ И НА СТРАНИЦУ ПРАВ.
//
// Выбор уходит на сервер сразу: карта правится оптимистично, отказ
// возвращает прежнюю и говорит словами (`MEMBER_REFUSAL_TEXT`). Две записи
// не делят один снимок карты: пока летит первая, вторая не уходит — иначе
// откат второй вернул бы первую.

/** `busyKey` пачки роли — ни одна строка не ждёт отдельно. */
export const ROLE_BUSY = "role";

export const memberRefusal = (error: unknown): AccessRefusal =>
  error instanceof AccessRequestError ? refusalOf(error) : "other";

/** Отказ словами. Границы директора («не выше своих прав», «не ваша
 *  команда», «права директора меняет владелец») сервер называет сам — по-русски
 *  и точнее общей фразы. */
export function memberRefusalText(error: unknown): string {
  const refusal = memberRefusal(error);
  if (
    refusal === "other" &&
    error instanceof AccessRequestError &&
    error.hint?.startsWith("access:") &&
    /[А-Яа-яЁё]/.test(error.message)
  ) {
    return error.message;
  }
  return MEMBER_REFUSAL_TEXT[refusal];
}

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
    const previous = qc.getQueryData<MemberAccessMap>(key);
    // Нынешние положения — строке из нескольких прав («Услуги», «Цены»,
    // «Время»): от них зависит, что именно уйдёт на сервер.
    const current = (blockKey: string): AccessLevel => {
      const real = blocks.find((candidate) => candidate.key === blockKey);
      return real && previous && teamId ? mapLevelOf(real, previous, teamId) : (real?.levels[0] ?? "off");
    };
    const changes = levelChanges(blocks, block, level, teamId, current);
    if (!changes) return;
    setSaving(block.key);
    if (previous) qc.setQueryData(key, withMemberChanges(previous, blocks, changes));
    setAccess.mutate(changes, {
      onError: (error) => {
        if (previous) qc.setQueryData(key, previous);
        toast(memberRefusalText(error), "error");
      },
      onSettled: () => setSaving(null),
    });
  };

  /** Пачка прав разом — роль: одна поездка `set_member_access`, тот же
   *  оптимистичный откат, что у строки. В тосте «Отменить» возвращает
   *  прежние положения тех же прав такой же пачкой. */
  const applyBatch = (changes: readonly AccessChange[], done: string) => {
    if (!blocks || setAccess.isPending || changes.length === 0) return;
    const previous = qc.getQueryData<MemberAccessMap>(key);
    const undo: AccessChange[] | null = previous
      ? changes.map((change) => {
          const block = blocks.find((candidate) => candidate.key === change.block);
          return {
            ...change,
            level: block ? mapLevelOf(block, previous, change.team_id ?? "") : change.level,
          };
        })
      : null;
    setSaving(ROLE_BUSY);
    if (previous) qc.setQueryData(key, withMemberChanges(previous, blocks, changes));
    setAccess.mutate(changes, {
      onSuccess: () =>
        toast(
          done,
          "success",
          undo ? { label: "Отменить", onPress: () => applyBatch(undo, "Права вернулись") } : undefined,
        ),
      onError: (error) => {
        if (previous) qc.setQueryData(key, previous);
        toast(memberRefusalText(error), "error");
      },
      onSettled: () => setSaving(null),
    });
  };

  return {
    pick,
    applyBatch,
    pending: setAccess.isPending,
    /** Строка, что сейчас сохраняется (`null` — ничего не летит). */
    busyKey: setAccess.isPending ? saving : null,
  };
}

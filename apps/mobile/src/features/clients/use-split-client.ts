import { createElement, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "expo-router";
import { Phone } from "lucide-react-native";
import type { Client } from "@babun/shared/local/clients";
import { PickerSheet } from "@/components/ui/PickerSheet";
import { useThemeColors } from "@/theme/colors";
import { useClientsScopeOrNull } from "@/features/clients/company-scope";
import { newClientDraftHref } from "@/features/clients/ClientPeopleDoor";
import {
  canSplitClient,
  splitDraftParams,
  splitRowText,
  splittablePhones,
} from "@/features/clients/split-client";

// «РАЗДЕЛИТЬ КЛИЕНТА» — ПУНКТ «⋯» КАРТОЧКИ (STORY-086, сценарий ж «Сплит»).
//
// Ход: «⋯» → «Разделить клиента» → шторка «Кого выносим» с дополнительными
// номерами → тап по номеру → черновик нового клиента (номер основным, связь с
// этой карточкой без роли, курсор в имени). Номер уходит из этой карточки
// только после «Создать клиента» — это делает сам черновик
// (`useClientDraft`, опция `split`); бросили черновик — здесь ничего не
// тронуто. Решения — в чистом `split-client.ts`, здесь только проводка.

interface SplitClientInput {
  /** Карточка страницы; у черновика пункта нет. */
  client: Client | undefined;
  isDraft: boolean;
  /** `caps.edit` — номер уходит из этой карточки правкой. */
  canEdit: boolean;
  /** `caps.links` — вынесенный встаёт человеком этой карточки. */
  canLinks: boolean;
  /** Меню «⋯» открыто — нужно, чтобы знать, ушло ли его окно. */
  menuOpen: boolean;
}

export interface SplitClient {
  /** Обработчик пункта или `undefined` — пункта нет. */
  onSplit?: () => void;
  /** Проп `onExited` меню «⋯». */
  onMenuExited: () => void;
  /** Шторка «Кого выносим» — ставится в конец экрана, вне прокрутки. */
  sheet: ReactNode;
}

export function useSplitClient({
  client,
  isDraft,
  canEdit,
  canLinks,
  menuOpen,
}: SplitClientInput): SplitClient {
  const t = useThemeColors();
  const router = useRouter();
  const pathname = usePathname();
  const scope = useClientsScopeOrNull();
  const [pickOpen, setPickOpen] = useState(false);

  // ШТОРКА ПОДНИМАЕТСЯ ПОСЛЕ УХОДА МЕНЮ — по его `onExited`, а не таймером:
  // iOS не покажет вторую модалку поверх уходящей («already presenting»).
  // Порядок двух сигналов не гарантирован — пункт меню зовётся таймером
  // самого `PickerSheet`, и он приходит то до `onExited`, то после (та же
  // ловушка, что у «Человек» в `ClientExtraContacts`). Поэтому помним оба:
  // ушло ли меню и ждёт ли шторка.
  const menuGone = useRef(true);
  const afterMenu = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (menuOpen) menuGone.current = false;
  }, [menuOpen]);

  const onMenuExited = () => {
    menuGone.current = true;
    const next = afterMenu.current;
    afterMenu.current = null;
    next?.();
  };

  const eligible = canSplitClient({ client, isDraft, canEdit, canLinks });
  const phones = eligible ? splittablePhones(client) : [];

  const openPick = () => setPickOpen(true);
  const onSplit = eligible
    ? () => {
        if (menuGone.current) openPick();
        else afterMenu.current = openPick;
      }
    : undefined;

  const sheet =
    eligible && client
      ? createElement(PickerSheet, {
          visible: pickOpen,
          title: "Кого выносим",
          items: phones.map((entry) => {
            const text = splitRowText(entry);
            return {
              id: entry.id,
              label: text.label,
              hint: text.hint,
              icon: Phone,
              color: t.accent,
              // Черновик открывается маршрутом той же дорогой, что у
              // «Создать клиента» в шторке людей: связь и сплит едут адресом.
              onPress: () =>
                router.push(
                  newClientDraftHref(pathname, scope, splitDraftParams(client.id, entry)),
                ),
            };
          }),
          onClose: () => setPickOpen(false),
        })
      : null;

  return { onSplit, onMenuExited, sheet };
}

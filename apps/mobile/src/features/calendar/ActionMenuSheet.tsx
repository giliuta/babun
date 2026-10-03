import {
  Ban,
  Bell,
  Bookmark,
  CalendarClock,
  Copy,
  ExternalLink,
  MessageSquareText,
  MoreHorizontal,
  Move,
  Navigation,
  Palette,
  Phone,
  RotateCcw,
  Trash2,
  type LucideIcon,
} from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { PickerSheet } from "@/components/ui/PickerSheet";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { useThemeColors } from "@/theme/colors";

// МЕНЮ ЗАПИСИ И СВОБОДНОГО ВРЕМЕНИ — НАША ШТОРКА, А НЕ СИСТЕМНЫЙ ЛИСТ
// (владелец 2026-09-24: «когда зажимаю запись, шторка появляется — сделать в
// нашей архитектуре, в нашем стиле»). Тело — канонический `PickerSheet`
// (реестр выбора: «Действие» → `ui/PickerSheet`): шапка с именем и временем,
// строка — цветной значок и слово, тап выбирает и закрывает, действие ждёт,
// пока лист уедет. Значок и цвет пункта назначаются ЗДЕСЬ, по слову пункта:
// один пункт выглядит одинаково в любом меню календаря.

export type ActionMenuItem = {
  label: string;
  destructive?: boolean;
  /** Свой значок и цвет — для подменю из значений («Причина отмены»,
   *  «Напомнить…»), где у каждой строки одно и то же значение-жанр. */
  icon?: LucideIcon;
  color?: string;
  run: () => void;
};

export type ActionMenu = {
  title: string;
  subtitle?: string;
  items: ActionMenuItem[];
  /** Значок справа в шапке — дверь на страницу списка, из которого меню
   *  собрано («Быстрое событие» → «Типы событий»). */
  onSettings?: () => void;
  settingsLabel?: string;
  /** Строка, когда пунктов нет. */
  emptyText?: string;
};

const LOOK: Record<string, { icon: LucideIcon; color: string }> = {
  "Свободное перемещение": { icon: Move, color: SETTINGS_TILE.blue },
  Перенести: { icon: CalendarClock, color: SETTINGS_TILE.indigo },
  Копировать: { icon: Copy, color: SETTINGS_TILE.teal },
  Цвет: { icon: Palette, color: SETTINGS_TILE.purple },
  "Отменить визит": { icon: Ban, color: SETTINGS_TILE.yellow },
  Восстановить: { icon: RotateCcw, color: SETTINGS_TILE.green },
  "Открыть запись": { icon: ExternalLink, color: SETTINGS_TILE.blue },
  "Открыть событие": { icon: ExternalLink, color: SETTINGS_TILE.blue },
  "Напомнить…": { icon: Bell, color: SETTINGS_TILE.yellow },
  Позвонить: { icon: Phone, color: SETTINGS_TILE.green },
  Маршрут: { icon: Navigation, color: SETTINGS_TILE.teal },
  // Тот же значок, что у шаблона SMS без своего (шторка отправки).
  "Отправить SMS": { icon: MessageSquareText, color: SETTINGS_TILE.blue },
  "Метка дня": { icon: Bookmark, color: SETTINGS_TILE.teal },
};

/** Вид пункта меню записи — значок и цвет плитки. Тот же, что в самом меню:
 *  им рисует пункт и превью прав в шторке права (страница сотрудника). */
export function actionLook(label: string): { icon: LucideIcon; color: string } | undefined {
  return LOOK[label];
}

export function ActionMenuSheet({
  menu,
  onClose,
}: {
  menu: ActionMenu | null;
  onClose: () => void;
}) {
  const t = useThemeColors();
  // ПОДМЕНЮ ЖДЁТ, ПОКА УЕДЕТ МЕНЮ. Пункт «Отменить визит» открывает «Причину
  // отмены» той же шторкой; пока первая уезжает, iOS второе окно не
  // показывает — подменю просто не появлялось (поймано на симуляторе).
  // Поэтому новое меню, пришедшее во время ухода, ждёт `onExited`.
  const [shown, setShown] = useState<ActionMenu | null>(menu);
  const exiting = useRef(false);
  const pending = useRef<ActionMenu | null>(null);
  useEffect(() => {
    if (menu == null) {
      if (shown) exiting.current = true;
      return;
    }
    if (exiting.current) pending.current = menu;
    else setShown(menu);
    // `shown` намеренно вне зависимостей: реагируем только на новое меню.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu]);
  const visible = menu != null && shown === menu;
  return (
    <PickerSheet
      visible={visible}
      title={shown?.title ?? ""}
      subtitle={shown?.subtitle}
      onSettings={shown?.onSettings}
      settingsLabel={shown?.settingsLabel}
      emptyText={shown?.emptyText}
      onClose={onClose}
      onExited={() => {
        exiting.current = false;
        const next = pending.current;
        pending.current = null;
        setShown(next);
      }}
      items={(shown?.items ?? []).map((item) => {
        const look = LOOK[item.label];
        return {
          id: item.label,
          label: item.label,
          // Разрушительное — красным значком корзины, какое бы слово ни
          // стояло («Удалить запись», «Удалить серию»).
          icon: item.destructive
            ? Trash2
            : (item.icon ?? look?.icon ?? MoreHorizontal),
          color: item.destructive
            ? t.danger
            : (item.color ?? look?.color ?? SETTINGS_TILE.blue),
          onPress: item.run,
        };
      })}
    />
  );
}

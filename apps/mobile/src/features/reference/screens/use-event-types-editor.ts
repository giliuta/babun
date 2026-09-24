import { useMemo, useState } from "react";
import {
  generatePersonalEventTypeId,
  type PersonalEventType,
} from "@babun/shared/local/personal-event-types";
import { useToast } from "@/components/ui/Toast";
import {
  usePersonalEventTypes,
  useSavePersonalEventTypes,
} from "@/features/settings/local-settings";
import { confirmThen } from "@/lib/confirm";
import { notify } from "@/lib/notify";
import type { EventTypeDraft } from "./EventTypeSheet";

// ПРАВКА СПРАВОЧНИКА ТИПОВ СОБЫТИЙ — ОДНА НА ДВА ЭКРАНА: полный список
// «Типы событий» (порядок, скрыть, удалить) и страница «Дизайн» календаря,
// где типы стоят прямо среди настроек (владелец 24.09: «всё на одной
// странице»). Вынесено из EventTypesScreen, чтобы у страниц не было двух
// копий проверки дублей и записи.

export type EventTypeEditing =
  | { mode: "create" }
  | { mode: "edit"; type: PersonalEventType };

/** `teamId` — команда, чьи типы правим (владелец 24.09: «у каждой команды
 *  свои»). Без команды правка не пишется: тип без хозяина-команды база
 *  больше не принимает. */
export function useEventTypesEditor(teamId: string | null) {
  const toast = useToast();
  const typesQuery = usePersonalEventTypes(teamId);
  const save = useSavePersonalEventTypes();
  const [editing, setEditing] = useState<EventTypeEditing | null>(null);
  const [dragging, setDragging] = useState(false);

  // Живые сверху, скрытые под ними — тем же порядком, что у меток и услуг.
  const types = useMemo(() => {
    const all = typesQuery.data ?? [];
    return [...all.filter((x) => !x.hidden), ...all.filter((x) => x.hidden)];
  }, [typesQuery.data]);

  const write = (
    next: PersonalEventType[],
    failure: string,
    done?: () => void,
    removeIds?: string[],
  ) => {
    if (!teamId) {
      notify(failure, "Сначала заведите календарь.");
      return;
    }
    save.mutate(
      { types: next.map((type, i) => ({ ...type, order: i })), removeIds, teamId },
      {
        onSuccess: () => done?.(),
        onError: (e) => notify(failure, e.message),
      },
    );
  };

  const submit = (draft: EventTypeDraft) => {
    const value = draft.label.trim();
    if (!value) return;
    const exceptId = editing?.mode === "edit" ? editing.type.id : undefined;
    const clash = types.some(
      (type) =>
        type.id !== exceptId &&
        type.label.trim().toLowerCase() === value.toLowerCase(),
    );
    if (clash) {
      notify("Такой тип уже есть", "Введите другое название.");
      return;
    }
    const patch = {
      label: value,
      icon: draft.icon,
      color: draft.color,
      allDay: draft.allDay,
      defaultDuration: draft.allDay ? 720 : draft.duration,
    };
    const next =
      editing?.mode === "edit"
        ? types.map((type) =>
            type.id === exceptId ? { ...type, ...patch } : type,
          )
        : [
            ...types,
            {
              id: generatePersonalEventTypeId(),
              order: types.length,
              hidden: false,
              ...patch,
            },
          ];
    write(
      next,
      editing?.mode === "edit" ? "Не удалось сохранить тип" : "Не удалось завести тип",
      () => setEditing(null),
    );
  };

  const toggleHidden = (type: PersonalEventType) =>
    write(
      types.map((x) => (x.id === type.id ? { ...x, hidden: !x.hidden } : x)),
      type.hidden ? "Не удалось показать тип" : "Не удалось скрыть тип",
      () => toast(type.hidden ? "Тип показан" : "Тип скрыт"),
    );

  const remove = (type: PersonalEventType) => {
    if (save.isPending) return;
    confirmThen(
      "Удалить тип события?",
      {
        // ПРАВДА, А НЕ ПУГАЛКА: событие держит имя и цвет типа своим снимком,
        // как запись держит имя услуги. Уже заведённые события целы.
        message: `«${type.label}» исчезнет из выбора. События, уже названные так, имя и цвет сохранят.`,
        confirmLabel: "Удалить",
        destructive: true,
      },
      () =>
        write(
          types.filter((x) => x.id !== type.id),
          "Не удалось удалить тип",
          () => toast("Тип удалён"),
          [type.id],
        ),
    );
  };

  const reorder = (ids: string[]) => {
    const byId = new Map(types.map((type) => [type.id, type]));
    const next = ids
      .map((id) => byId.get(id))
      .filter((type): type is PersonalEventType => type != null);
    if (next.length !== types.length) return;
    write(next, "Не удалось изменить порядок");
  };

  return {
    typesQuery,
    types,
    save,
    editing,
    setEditing,
    submit,
    toggleHidden,
    remove,
    reorder,
    dragging,
    setDragging,
  };
}

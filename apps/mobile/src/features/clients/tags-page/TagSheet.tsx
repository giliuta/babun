import { useState } from "react";
import type { ClientTag } from "@babun/shared/local/clients";
import { PRESET_COLOR_CYCLE } from "@babun/shared/common/utils/colors";
import {
  TemplateList,
  TemplatesHeaderButton,
  useTemplatePicking,
  type TemplateItem,
} from "@/components/ui/TemplatePicker";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { useGuardedClose } from "@/components/ui/use-guarded-close";
import { Button } from "@/components/ui/Button";
import { NameColorField } from "@/components/ui/picker-fields";

export const DEFAULT_COLOR = PRESET_COLOR_CYCLE[2].value;

export type Editing = { mode: "create" } | { mode: "edit"; tag: ClientTag };

/** Редактор тега — канонический лист: имя с цветом одной строкой, одна
 *  кнопка внизу. Удаление здесь не живёт: оно на кромке свайпа (закон о двух
 *  окнах — вопрос, заданный из листа, не показался бы вовсе). */
export function TagSheet({
  editing,
  busy,
  onClose,
  onSubmit,
  templates,
}: {
  /** Шаблоны из других команд аккаунта (значок в шапке при создании). */
  templates?: readonly TemplateItem<ClientTag>[];
  editing: Editing | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (draft: { name: string; color: string; icon: string | null }) => void;
}) {
  const { picking, setPicking } = useTemplatePicking();
  const isEdit = editing?.mode === "edit";
  const [name, setName] = useState("");
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [icon, setIcon] = useState<string | null>(null);
  // key-remount через editing==null → null; локальный стейт инициализируем от
  // editing при каждом открытии (паттерн «render-time reset», как у меток).
  const [seeded, setSeeded] = useState<Editing | null>(null);
  const seedName = isEdit ? editing.tag.name : "";
  const seedColor = isEdit ? editing.tag.color || DEFAULT_COLOR : DEFAULT_COLOR;
  const seedIcon = isEdit ? (editing.tag.icon ?? null) : null;
  if (editing !== seeded) {
    setSeeded(editing);
    setPicking(false);
    setName(seedName);
    setColor(seedColor);
    setIcon(seedIcon);
  }
  // НАБРАННОЕ НЕ ПРОПАДАЕТ ОТ СКРИМА И СВАЙПА — как у метки: сначала вопрос.
  const dirty =
    editing !== null && (name !== seedName || color !== seedColor || icon !== seedIcon);
  const guard = useGuardedClose({
    dirty,
    busy,
    onClose,
    message: "Набранное в теге не сохранится.",
  });

  const applyTemplate = (tpl: ClientTag) => {
    setName(tpl.name);
    setColor(tpl.color || DEFAULT_COLOR);
    setIcon(tpl.icon ?? null);
    setPicking(false);
  };

  return (
    <BottomSheet
      visible={editing !== null && !guard.hidden}
      onClose={guard.close}
      onExited={guard.onExited}
      title={isEdit ? "Тег" : "Новый тег"}
      avoidKeyboard
      // Боковые отступы задаёт сам `SheetFooter` (GUTTER): своя обёртка
      // делала кнопку уже, чем в соседних листах справочников.
      footer={picking ? undefined : (<Button
          label={isEdit ? "Сохранить" : "Создать тег"}
          disabled={!name.trim() || busy}
          loading={busy}
          onPress={() => onSubmit({ name, color, icon })}
        />)}
    
      headerAction={
        !isEdit && (templates?.length ?? 0) > 0 ? (
          <TemplatesHeaderButton picking={picking} onToggle={() => setPicking((v) => !v)} />
        ) : undefined
      }
    >
      {picking ? (
        <TemplateList items={templates ?? []} gutter={false} onPick={applyTemplate} />
      ) : (
      <>
      <NameColorField
        name={name}
        onNameChange={setName}
        color={color}
        onColorChange={setColor}
        icon={icon}
        onIconChange={setIcon}
        autoFocus={!isEdit}
      />
          </>
      )}
    </BottomSheet>
  );
}

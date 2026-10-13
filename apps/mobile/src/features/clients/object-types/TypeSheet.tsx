import { useState } from "react";
import type { LocationLabel } from "@babun/shared/local/location-labels";
import { PRESET_COLOR_CYCLE } from "@babun/shared/common/utils/colors";
import {
  TemplateList,
  TemplatesHeaderButton,
  useTemplatePicking,
  type TemplateItem,
} from "@/components/ui/TemplatePicker";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { NameColorField } from "@/components/ui/picker-fields";

export type Editing = { mode: "create" } | { mode: "edit"; label: LocationLabel };

/** Что лист отдаёт наружу: имя и вид одним ответом. Тремя позиционными
 *  аргументами это разъезжается при первой же правке порядка. */
export interface TypeDraft {
  name: string;
  color: string | null;
  icon: string | null;
}

/** Правка типа — канонический `BottomSheet` с одним полем, как «Новая метка».
 *  Удаления здесь нет намеренно: оно живёт на кромке свайпа, а вопрос,
 *  заданный из листа, не показался бы вовсе (закон о двух окнах). */
export function TypeSheet({
  editing,
  busy,
  onClose,
  onSubmit,
  templates,
}: {
  /** Шаблоны из других команд аккаунта (значок в шапке при создании). */
  templates?: readonly TemplateItem<LocationLabel>[];
  editing: Editing | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (draft: TypeDraft) => void;
}) {
  const { picking, setPicking } = useTemplatePicking();
  const isEdit = editing?.mode === "edit";
  const [name, setName] = useState("");
  const [color, setColor] = useState<string | null>(null);
  const [icon, setIcon] = useState<string | null>(null);
  // Черновик берётся у той строки, которую открыли, и ровно один раз:
  // пока лист открыт, значением владеет поле.
  const [seededFor, setSeededFor] = useState<string | null>(null);
  const key = editing == null ? null : isEdit ? editing.label.id : "create";
  if (key !== seededFor) {
    setSeededFor(key);
    setPicking(false);
    setName(editing?.mode === "edit" ? editing.label.name : "");
    // НОВЫЙ ТИП РОЖДАЕТСЯ ЦВЕТНЫМ. Пустой вид у первой же строки читается как
    // «сломалось»: соседние справочники цветные. Правка чужой вид не трогает.
    setColor(
      editing?.mode === "edit"
        ? (editing.label.color ?? null)
        : PRESET_COLOR_CYCLE[0].value,
    );
    setIcon(editing?.mode === "edit" ? (editing.label.icon ?? null) : "house");
  }

  const applyTemplate = (tpl: LocationLabel) => {
    setName(tpl.name);
    setColor(tpl.color ?? null);
    setIcon(tpl.icon ?? "house");
    setPicking(false);
  };

  return (
    <BottomSheet
      visible={editing !== null}
      onClose={onClose}
      title={isEdit ? "Тип объекта" : "Новый тип"}
      avoidKeyboard
      footer={picking ? undefined : (<Button
          label={isEdit ? "Сохранить" : "Создать"}
          onPress={() => onSubmit({ name, color, icon })}
          disabled={!name.trim() || busy}
          loading={busy}
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
      {/* ИМЯ, ЦВЕТ И ЗНАЧОК ОДНОЙ СТРОКОЙ — тот же блок, что у метки, услуги,
          тега, категории и типа события (владелец 2026-09-10: «точно такой же
          блок… и используются везде»). */}
      <NameColorField
        name={name}
        onNameChange={setName}
        color={color}
        onColorChange={setColor}
        icon={icon}
        onIconChange={setIcon}
        autoFocus
      />
          </>
      )}
    </BottomSheet>
  );
}

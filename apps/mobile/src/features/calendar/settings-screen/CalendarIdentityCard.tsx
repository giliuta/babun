import { useEffect, useRef, useState } from "react";
import { SectionCard } from "@/components/ui/SectionCard";
import { NameColorField } from "@/components/ui/picker-fields";
import { TourTarget } from "@/components/tour/TourTarget";

// ИМЯ И ЦВЕТ КАЛЕНДАРЯ ПРАВЯТСЯ ПРЯМО В СТРОКЕ, без нижнего листа с кнопкой «Применить» и без шеврона,
// раскрывающего палитру: это лишний шаг ради двух правок, которые правятся на
// месте. Карточка И ЕСТЬ редактор: имя пишется в строке и сохраняется,
// когда из него уходят, точка слева открывает палитру поверх экрана.
export function CalendarIdentityCard({
  team,
  onPatch,
}: {
  team: { name: string; color?: string | null };
  onPatch: (p: Record<string, unknown>) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const name = draft ?? team.name;
  // НАБРАННОЕ ИМЯ НЕ ТЕРЯЕТСЯ НА УХОДЕ. Сохранение висит на `onBlur`, а поле,
  // которое снимают с экрана в фокусе (жест «назад», тап по другой команде в
  // ленте — карточка с `key={team.id}` пересоздаётся), blur не получает:
  // новое имя молча пропадало. Последнее состояние держим в ref и дописываем
  // его при размонтировании; уже сохранённое `commitName` гасит, чтобы не было
  // второй одинаковой записи.
  const latest = useRef({ draft, teamName: team.name, onPatch });
  latest.current = { draft, teamName: team.name, onPatch };
  useEffect(
    () => () => {
      const { draft: left, teamName, onPatch: patch } = latest.current;
      const trimmed = left?.trim();
      if (trimmed && trimmed !== teamName) patch({ name: trimmed });
    },
    [],
  );

  const commitName = () => {
    const trimmed = name.trim();
    // Пустое имя не пишем: календарь без имени не существует ни в чипах, ни в
    // переводах. Молча возвращаем как было.
    if (trimmed && trimmed !== team.name) onPatch({ name: trimmed });
    latest.current.draft = null;
    setDraft(null);
  };

  return (
    <SectionCard>
      <TourTarget id="settings.name">
      <NameColorField
        bare
        label={null}
        name={name}
        onNameChange={setDraft}
        onBlur={commitName}
        color={team.color}
        onColorChange={(hex) => onPatch({ color: hex })}
      />
      </TourTarget>
    </SectionCard>
  );
}

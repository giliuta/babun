import { useEffect, useRef, useState } from "react";
import { NameColorField } from "@/components/ui/picker-fields";
import { TourTarget } from "@/components/tour/TourTarget";
import { useTeamName } from "@/session/team-name";

// ИМЯ И ЦВЕТ КАЛЕНДАРЯ ПРАВЯТСЯ ПРЯМО В СТРОКЕ, без нижнего листа с кнопкой «Применить» и без шеврона,
// раскрывающего палитру: это лишний шаг ради двух правок, которые правятся на
// месте. Строка И ЕСТЬ редактор: имя пишется в строке и сохраняется,
// когда из него уходят, точка слева открывает палитру поверх экрана. Карточку
// даёт группа «Календарь» (`SettingsGroup`), своей у строки нет.
export function CalendarIdentityCard({
  team,
  onPatch,
}: {
  team: { name: string; color?: string | null };
  onPatch: (p: Record<string, unknown>) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  // ПОЛЕ ПОКАЗЫВАЕТ ИМЯ ПРАВИЛОМ ПОКАЗА (`useTeamName`), как чип ленты над ним:
  // календарь, названный почтой при регистрации, печатался адресом рядом с
  // чипом «Babun» — два имени одного календаря на одном экране. Почту поле не
  // выводит; пишет оно только то, что человек сам набрал.
  const teamName = useTeamName();
  const shown = teamName(team.name);
  const name = draft ?? shown;
  // НАБРАННОЕ ИМЯ НЕ ТЕРЯЕТСЯ НА УХОДЕ. Сохранение висит на `onBlur`, а поле,
  // которое снимают с экрана в фокусе (жест «назад», тап по другой команде в
  // ленте — карточка с `key={team.id}` пересоздаётся), blur не получает:
  // новое имя молча пропадало. Последнее состояние держим в ref и дописываем
  // его при размонтировании; уже сохранённое `commitName` гасит, чтобы не было
  // второй одинаковой записи.
  const latest = useRef({ draft, real: team.name, shown, onPatch });
  latest.current = { draft, real: team.name, shown, onPatch };
  useEffect(
    () => () => {
      const { draft: left, real, shown: was, onPatch: patch } = latest.current;
      const trimmed = left?.trim();
      if (trimmed && trimmed !== real && trimmed !== was) patch({ name: trimmed });
    },
    [],
  );

  const commitName = () => {
    // Пишется только правка: без неё (`draft === null`) или с тем же, что было
    // показано, имя не трогаем — иначе тап в поле и уход из него молча
    // заменяли бы настоящее имя-почту показанным. Пустое имя не пишем:
    // календарь без имени не существует ни в чипах, ни в переводах.
    const trimmed = draft?.trim();
    if (trimmed && trimmed !== team.name && trimmed !== shown) onPatch({ name: trimmed });
    latest.current.draft = null;
    setDraft(null);
  };

  return (
      <TourTarget id="settings.name">
      <NameColorField
        bare
        placeholder="Название календаря"
        label={null}
        name={name}
        onNameChange={setDraft}
        onBlur={commitName}
        color={team.color}
        onColorChange={(hex) => onPatch({ color: hex })}
      />
      </TourTarget>
  );
}

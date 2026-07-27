// ЛИЧНОЕ — Метка · Теги · День рождения · Язык.
//
// Владелец 2026-07-26: «теги должны быть на уровне „Личное“ как метки… туда
// же добавь теги, сделай одинаковое как метки, чтоб внизу так вот вылазило
// красиво… метка, день рождения, язык — всё в одном стиле».
//
// Поэтому все четыре — строки ОДНОГО вида: значение справа, тап открывает
// выбор. Метка и теги — один и тот же лист снизу; разница только смысловая
// (метка одна, тегов может быть несколько). Чипы тегов с карточки убраны: они
// были единственным местом, где выбор жил прямо на странице.
//
// Язык вернулся сюда по решению владельца 2026-07-26 («язык — тоже отличное
// решение»): из ФИЛЬТРОВ он убран, а как справочное поле клиента остаётся.
//
// Email уехал в «Ещё» — вместе с мессенджерами: их не заполняют каждый день.

import { useEffect, useState } from "react";
import type { Client, ClientTag } from "@babun/shared/local/clients";
import { getAvatarColor } from "@babun/shared/common/utils/avatar-color";
import { ControlRow, NavRow, RowGroup } from "@/features/clients/card-rows";
import { LabelPickerSheet } from "@/features/clients/LabelPickerSheet";
import { TagPickerSheet } from "@/features/clients/TagPickerSheet";
import {
  normalizeYMD,
  OptionalDateField,
} from "@/features/clients/OptionalDateField";
import { useJsonArrayWriter } from "@/features/clients/use-json-writer";
import { useCities } from "@/features/reference/queries";
import { haptics } from "@/lib/haptics";

interface PersonalBlockProps {
  client: Client;
  update: (patch: Partial<Client>) => Promise<boolean> | void;
  /** Каталог тегов тенанта (настройки клиентов → «Теги клиентов»). */
  tags?: ClientTag[];
}

/** Склонение: «3 тега». */
function tagsWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "тег";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "тега";
  return "тегов";
}

export function PersonalBlock({
  client,
  update,
  tags = [],
}: PersonalBlockProps) {
  const { data: cities = [] } = useCities();
  const [labelOpen, setLabelOpen] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);

  const label = client.city.trim();
  const labelColor =
    cities.find((c) => c.name === label)?.color ?? getAvatarColor(label);

  // Теги — набор, который RPC заменяет ЦЕЛИКОМ: пишем из свежайшего значения
  // и по очереди, иначе два быстрых тапа затирают друг друга.
  const tagWriter = useJsonArrayWriter<string>(client.tag_ids, (next) =>
    Promise.resolve(update({ tag_ids: next })).then((ok) => ok !== false),
  );
  // Отметка в листе — мгновенная: набор уезжает в RPC целиком и возвращается
  // только после round-trip. Локальное значение самоисцеляется от пропа.
  const [shownTags, setShownTags] = useState<string[]>(client.tag_ids);
  useEffect(() => setShownTags(client.tag_ids), [client.tag_ids]);

  const toggleTag = (id: string) => {
    setShownTags((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id],
    );
    void tagWriter.apply((all) =>
      all.includes(id) ? all.filter((x) => x !== id) : [...all, id],
    );
  };

  const chosenTags = tags.filter((tag) => shownTags.includes(tag.id));
  const tagsValue =
    chosenTags.length === 0
      ? null
      : chosenTags.length <= 2
        ? chosenTags.map((tag) => tag.name).join(", ")
        : `${chosenTags.length} ${tagsWord(chosenTags.length)}`;

  return (
    <>
      <RowGroup title="Личное">
        <NavRow
          label="Метка"
          value={label || null}
          placeholder="не выбрана"
          valueColor={label ? labelColor : undefined}
          onPress={() => {
            haptics.tap();
            setLabelOpen(true);
          }}
        />
        <NavRow
          label="Теги"
          value={tagsValue}
          placeholder="нет"
          separated
          onPress={() => {
            haptics.tap();
            setTagsOpen(true);
          }}
        />
        <ControlRow label="День рождения" separated>
          <OptionalDateField
            align="end"
            label="День рождения"
            // Колесо открывается не на сегодня: у дня рождения сегодняшняя
            // дата — бессмысленная отправная точка.
            seed="1990-01-01"
            value={normalizeYMD(client.birthday)}
            onChange={(v) => update({ birthday: v })}
          />
        </ControlRow>
      </RowGroup>

      <LabelPickerSheet
        visible={labelOpen}
        current={client.city}
        onSelect={(name) => update({ city: name, city_manual: true })}
        onClear={() => update({ city: "", city_manual: false })}
        onClose={() => setLabelOpen(false)}
      />
      <TagPickerSheet
        visible={tagsOpen}
        tags={tags}
        selected={shownTags}
        onToggle={toggleTag}
        onClose={() => setTagsOpen(false)}
      />
    </>
  );
}

export default PersonalBlock;

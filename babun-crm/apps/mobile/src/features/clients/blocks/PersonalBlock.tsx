// ЛИЧНОЕ — Метка · День рождения · Email. Справочные поля: ни одно из них
// не управляет поведением, кроме дня рождения (stats.birthdayInDays → бейдж
// «ДР на неделе»), поэтому дата идёт через нативный пикер, а не свободный
// текст.
//
// Переведён на ЗАКОН СТРОКИ (2026-07-26): те же строки, что имя и телефон, а
// не серые пилюли-инпуты внутри сворачиваемой карточки. Владелец: «это всё
// вводное хуета» — половина страницы говорила на одном языке, половина на
// другом, и разнобой был виден сразу.
//
// «Метка» — строго из библиотеки Кабинета (тот же корешок, что у дней
// календаря); ручной выбор ставит city_manual, и автоприсвоение из метки дня
// такого клиента больше не трогает.
//
// «Язык» УДАЛЁН (владелец 2026-07-25: «убираем вообще на хер языки»). Поле
// остаётся в модели — старые значения и SMS-шаблоны не ломаем, но на карточке
// его нет.

import { useState } from "react";
import type { Client } from "@babun/shared/local/clients";
import { getAvatarColor } from "@babun/shared/common/utils/avatar-color";
import {
  ControlRow,
  FieldRow,
  NavRow,
  RowGroup,
} from "@/features/clients/card-rows";
import { LabelPickerSheet } from "@/features/clients/LabelPickerSheet";
import {
  normalizeYMD,
  OptionalDateField,
} from "@/features/clients/OptionalDateField";
import { useCities } from "@/features/reference/queries";
import { haptics } from "@/lib/haptics";

interface PersonalBlockProps {
  client: Client;
  update: (patch: Partial<Client>) => void;
  /** Черновик: поля пишут на каждый символ — «Готово» читает черновик. */
  draft?: boolean;
}

export function PersonalBlock({ client, update, draft }: PersonalBlockProps) {
  const { data: cities = [] } = useCities();
  const [pickerOpen, setPickerOpen] = useState(false);

  const label = client.city.trim();
  const labelColor =
    cities.find((c) => c.name === label)?.color ?? getAvatarColor(label);

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
            setPickerOpen(true);
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
        <FieldRow
          label="Email"
          value={client.email}
          placeholder="email@example.com"
          separated
          stacked
          keyboardType="email-address"
          live={draft}
          onSave={(v) => update({ email: v })}
        />
      </RowGroup>

      <LabelPickerSheet
        visible={pickerOpen}
        current={client.city}
        onSelect={(name) => update({ city: name, city_manual: true })}
        onClear={() => update({ city: "", city_manual: false })}
        onClose={() => setPickerOpen(false)}
      />
    </>
  );
}

export default PersonalBlock;

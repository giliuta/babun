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
import type {
  AcquisitionSource,
  Client,
  ClientTag,
} from "@babun/shared/local/clients";
import { ACQUISITION_LABELS } from "@babun/shared/local/clients";
import { getAvatarColor } from "@babun/shared/common/utils/avatar-color";
import {
  Circle,
  Footprints,
  Globe,
  Instagram,
  MapPin,
  MessageCircle,
  RotateCcw,
  Users,
  type LucideIcon,
} from "lucide-react-native";
import { NavRow, RowGroup } from "@/features/clients/card-rows";
import { PickerSheet } from "@/components/ui/PickerSheet";
import { DateWheelSheet } from "@/components/ui/DateWheelSheet";
import { formatShortDateRu } from "@/features/clients/format";
import { ClientPickerSheet } from "@/features/clients/ClientPickerSheet";
import { LabelPickerSheet } from "@/features/clients/LabelPickerSheet";
import { TagPickerSheet } from "@/features/clients/TagPickerSheet";
import { normalizeYMD } from "@/features/clients/OptionalDateField";
import { useJsonArrayWriter } from "@/features/clients/use-json-writer";
import { useCities } from "@/features/reference/queries";
import { useClients } from "@/features/clients/queries";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

interface PersonalBlockProps {
  client: Client;
  update: (patch: Partial<Client>) => Promise<boolean> | void;
  /** Каталог тегов тенанта (настройки клиентов → «Теги клиентов»). */
  tags?: ClientTag[];
}

/** Значок источника: откуда пришёл клиент, узнаётся с одного взгляда. */
const SOURCE_ICONS: Partial<Record<AcquisitionSource, LucideIcon>> = {
  referral: Users,
  instagram: Instagram,
  whatsapp: MessageCircle,
  google_maps: MapPin,
  website: Globe,
  repeat: RotateCcw,
  walk_in: Footprints,
  other: Circle,
};

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
  const t = useThemeColors();
  const { data: cities = [] } = useCities();
  const [labelOpen, setLabelOpen] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [birthdayOpen, setBirthdayOpen] = useState(false);
  const birthday = normalizeYMD(client.birthday);

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
    const before = shownTags;
    setShownTags((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id],
    );
    void tagWriter
      .apply((all) =>
        all.includes(id) ? all.filter((x) => x !== id) : [...all, id],
      )
      // Не сохранилось — возвращаем галку. Иначе строка показывала «1 тег»,
      // в листе стояла отметка, а в базе тега не было.
      .then((ok) => {
        if (!ok) setShownTags(before);
      })
      .catch(() => setShownTags(before));
  };

  // «Откуда пришёл» переехал сюда со страницы «Ещё» (владелец 2026-08-02:
  // «чтобы внизу уменьшить»). Это такое же справочное свойство человека, как
  // метка или день рождения, — а мессенджеры уехали к номерам.
  const source =
    client.acquisition_source && client.acquisition_source !== "unknown"
      ? ACQUISITION_LABELS[client.acquisition_source]
      : null;
  const [sourceOpen, setSourceOpen] = useState(false);

  // «Кто привёл»: список — сами клиенты тенанта, поэтому берём тот же кеш,
  // что список и дедуп, и никого не грузим отдельно.
  const [referrerOpen, setReferrerOpen] = useState(false);
  const { data: allClients = [] } = useClients();
  const referrerName =
    allClients.find((x: Client) => x.id === client.referred_by_client_id)
      ?.full_name ??
    null;

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
        {/* Тот же вид, что «Метка», «Теги», «Источник» (владелец 2026-08-06):
            значение справа + шеврон. Синяя кнопка «Указать» была единственным
            цветным словом в блоке и кричала громче содержания строки; убрать
            дату можно в самом листе колеса. */}
        <NavRow
          label="День рождения"
          value={birthday ? formatShortDateRu(birthday) : null}
          placeholder="не указан"
          separated
          onPress={() => {
            haptics.tap();
            setBirthdayOpen(true);
          }}
        />
        <NavRow
          label="Источник"
          value={source}
          placeholder="неизвестен"
          separated
          onPress={() => {
            haptics.tap();
            setSourceOpen(true);
          }}
        />
        {/* КТО ПРИВЁЛ — второй вопрос, который сам собой следует за
            «Рекомендацией»: источник говорит «сарафан», но не говорит, кому
            за это спасибо. Поле было в модели с самого начала и не имело ни
            одного экрана. Строка появляется только при источнике
            «Рекомендация» — остальным она пустой шум. */}
        {client.acquisition_source === "referral" ? (
          <NavRow
            label="Кто привёл"
            value={referrerName}
            placeholder="не указан"
            separated
            onPress={() => {
              haptics.tap();
              setReferrerOpen(true);
            }}
          />
        ) : null}
      </RowGroup>

      {/* Источник — тот же лист со значками, что «Добавить» и «Как связаться».
          Раньше это был безликий системный выбор, стоявший вплотную к «Метке»
          и «Тегам», которые открывали лист другого вида. */}
      <PickerSheet
        visible={sourceOpen}
        title="Источник обращения"
        items={(Object.keys(ACQUISITION_LABELS) as AcquisitionSource[])
          .filter((k) => k !== "unknown")
          .map((k) => ({
            id: k,
            label: ACQUISITION_LABELS[k],
            icon: SOURCE_ICONS[k] ?? Circle,
            color: t.accent,
            onPress: () => update({ acquisition_source: k }),
          }))}
        onClose={() => setSourceOpen(false)}
      />

      <DateWheelSheet
        visible={birthdayOpen}
        title="День рождения"
        value={birthday || null}
        // Колесо открывается не на сегодня: у дня рождения сегодняшняя дата —
        // бессмысленная отправная точка.
        seed="1990-01-01"
        clearLabel={birthday ? "Убрать дату" : undefined}
        onApply={(ymd) => {
          update({ birthday: ymd });
          setBirthdayOpen(false);
        }}
        onClear={() => {
          update({ birthday: "" });
          setBirthdayOpen(false);
        }}
        onClose={() => setBirthdayOpen(false)}
      />
      {/* Кто привёл — тот же список клиентов, что и везде, с поиском. */}
      <ClientPickerSheet
        visible={referrerOpen}
        title="Кто привёл"
        selectedId={client.referred_by_client_id}
        excludeId={client.id}
        clearLabel="Убрать"
        onSelect={(c) => update({ referred_by_client_id: c.id })}
        onClear={() => update({ referred_by_client_id: null })}
        onClose={() => setReferrerOpen(false)}
      />

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

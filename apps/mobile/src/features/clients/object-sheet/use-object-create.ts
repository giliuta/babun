import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, type TextInput } from "react-native";
import type { LocationWriter } from "@/features/clients/use-location-writer";
import type { ObjectFieldsValue } from "@/features/clients/ObjectFields";
import { isPlaceReady, objectPlacePatch } from "@/features/clients/object-address";
import { snapObjectType } from "@/features/clients/object-types";
import { haptics } from "@/lib/haptics";

// РЕЖИМ «НОВЫЙ ОБЪЕКТ» ЛИСТА `ObjectSheet`: черновик и то, как он уезжает
// в базу одной кнопкой. Правка того же объекта пишет сразу, на уходе с
// каждого поля (`use-object-edit.ts`), — законная разница СПОСОБА ЗАПИСИ, а
// не повод рисовать вторую форму.
//
// В ЧЕРНОВИКЕ КЛИЕНТА лист работает так же: писатель `locations` кладёт объекты
// в черновик, а `locations` проходит белый список create_client_with_tags — то
// есть уедет в базу вместе с «Готово».

const EMPTY_DRAFT: ObjectFieldsValue = {
  type: "",
  target: "",
  parts: {},
  partsOpen: false,
  pin: "",
  note: "",
};

export interface AddedObject {
  id: string;
  label: string;
  address: string;
  mapUrl?: string;
  note?: string;
}

export function useObjectCreate({
  visible,
  writer,
  initialTarget,
  typeOptions,
  onAdded,
  onClose,
}: {
  visible: boolean;
  writer: LocationWriter;
  initialTarget?: string;
  typeOptions: string[];
  onAdded?: (added: AddedObject) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<ObjectFieldsValue>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  /** Идёт запись — синхронно, в отличие от `saving`. */
  const busy = useRef(false);

  // Предзаполнение — РОВНО ОДИН РАЗ на открытие и только в пустой черновик:
  // лист остаётся смонтированным, и без засова подстановка перетирала бы то,
  // что человек уже набрал.
  const seeded = useRef(false);
  // КУРСОР СРАЗУ В АДРЕС: лист открыли, чтобы вписать адрес, —
  // тап по полю был лишним шагом самого частого действия. Ждём, пока лист
  // доедет: фокус на уезжающем вверх окне клавиатура не поднимает.
  const addressRef = useRef<TextInput>(null);
  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => addressRef.current?.focus(), 350);
    return () => clearTimeout(timer);
  }, [visible]);
  useEffect(() => {
    if (!visible) {
      seeded.current = false;
      return;
    }
    if (seeded.current) return;
    seeded.current = true;
    const start = initialTarget?.trim();
    if (start) setDraft((d) => (d.target.trim() ? d : { ...d, target: start }));
  }, [visible, initialTarget]);

  // ТИП НЕ ПОДСТАВЛЯЕТСЯ: в большинстве заказов не известно, дом это, вилла
  // или квартира, — не сразу «Дом», а «добавить». Новый
  // объект открывается с пустым типом — дверью «Выбрать тип объекта»; выбрать
  // можно, но не обязательно, и объект без типа записывается одним адресом.
  // Если подставлять тип основного объекта клиента или первый тип словаря,
  // почти каждый объект молча станет «Домом». Пустой тип
  // продукт уже умеет: списки печатают такой объект как «Объект».

  // Объект существует, когда есть адрес, части с «где» ИЛИ отмеченная точка:
  // по пину команда доедет даже без единого слова адреса — на кипрских виллах
  // это обычное дело.
  const ready = isPlaceReady(draft);

  const add = async (): Promise<boolean> => {
    // Засов СИНХРОННЫЙ: между тапом и появлением `saving` есть кадр, в который
    // второй тап успевал влезть в ту же очередь.
    if (!ready || busy.current) return false;
    busy.current = true;
    setSaving(true);
    try {
      // Главная строка + уточнение → одно место: строка-ссылка станет пином,
      // строка-текст — «улица и дом» (см. objectPlacePatch).
      const { address, mapUrl, addressParts } = objectPlacePatch(
        draft.target,
        draft.parts,
        draft.pin,
      );
      const label = snapObjectType(draft.type, typeOptions);
      const note = draft.note.trim() || undefined;
      const id = await writer.addLocation({
        label,
        address,
        mapUrl,
        addressParts,
        note,
      });
      if (!id) {
        // Причину показал useUpdateClient — набранное НЕ выбрасываем.
        haptics.error();
        return false;
      }
      haptics.success();
      onAdded?.({ id, label, address, mapUrl, note });
      // Форма пустеет ТОЛЬКО после подтверждённой записи (выше — ранний
      // выход по !id): иначе набранный адрес исчезал вместе с неудавшимся
      // PATCH-ем. Тип остаётся: три виллы подряд заводят одним типом.
      setDraft((d) => ({ ...EMPTY_DRAFT, type: d.type }));
      // Анонс — не в тот же кадр: форма в этот момент пустеет (а на записи
      // лист ещё и уходит), и VoiceOver перебивал бы сам себя (тот же приём,
      // что в листе фильтров).
      setTimeout(
        () =>
          AccessibilityInfo.announceForAccessibility(
            `Объект добавлен: ${address || mapUrl || ""}`,
          ),
        350,
      );
      // ДОБАВИЛИ — ЛИСТ УХОДИТ, ВСЕГДА. У записи объект уезжает в саму запись
      // (`onAdded` выбирает его). Лист, оставшийся открытым с пустой формой
      // ради трёх вилл подряд, выглядит так, будто ничего не сохранилось:
      // нажал «Добавить объект», а перед глазами та же пустая форма. Объект встаёт в блок
      // за листом; следующий — одним тапом по той же двери.
      onClose();
      return true;
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  return {
    value: draft,
    onChange: (patch: Partial<ObjectFieldsValue>) => setDraft((d) => ({ ...d, ...patch })),
    addressRef,
    ready,
    saving,
    add,
  };
}

import { useEffect, useMemo, useRef, useState } from "react";
import type { Client, Location } from "@babun/shared/local/clients";
import { useLastNonNull } from "@/lib/use-last-non-null";
import type { LocationWriter } from "@/features/clients/use-location-writer";
import type { ObjectFieldsValue } from "@/features/clients/ObjectFields";
import { objectTarget, primaryLine } from "@/features/clients/object-address";
import { useAddressPartsEdit } from "@/features/clients/use-address-parts-edit";
import { snapObjectType } from "@/features/clients/object-types";
import { haptics } from "@/lib/haptics";
import { confirmAction } from "@/lib/confirm";
import { useClientAppointments } from "@/features/clients/appointments";
import { objectDeleteTitle, visitsOnObject } from "@/features/clients/object-delete";

// РЕЖИМ «ПРАВКА» ЛИСТА `ObjectSheet`: правки пишутся в объект СРАЗУ, на уходе
// с каждого поля, — так ведут себя все строки карточки.
//
// Удаление живёт ЗДЕСЬ (и свайпом по строке на карточке) — с подтверждением:
// объект с историей стирается насовсем.

const EMPTY_LOCATIONS: Location[] = [];

export function useObjectEdit({
  visible,
  client,
  locationId,
  writer,
  askDelete,
  typeOptions,
  onDeleted,
  onClose,
  afterExit,
}: {
  visible: boolean;
  client: Client;
  locationId: string | null;
  writer: LocationWriter;
  askDelete?: boolean;
  typeOptions: string[];
  onDeleted?: (id: string) => void;
  onClose: () => void;
  /** Что сделать, когда лист полностью уйдёт (`onExited` листа). */
  afterExit: { current: (() => void) | null };
}) {
  const locations = client.locations ?? EMPTY_LOCATIONS;
  // Последний правившийся объект держим до конца анимации закрытия: иначе
  // лист размонтируется в том же кадре и не уезжает вниз, а пропадает.
  const loc = useLastNonNull(
    useMemo(
      () => locations.find((l) => l.id === locationId) ?? null,
      [locations, locationId],
    ),
  );

  // Визиты клиента — для числа в вопросе «Удалить» (`object-delete.ts`).
  const clientVisits = useClientAppointments(client.id);

  const asked = useRef(false);
  const confirmDeleteRef = useRef<() => void>(() => {});
  // Черновик главной строки и заметки. Заполняем ТОЛЬКО на открытии листа (по
  // locationId, а не по самому объекту): `loc` — новая ссылка после каждого
  // ответа сервера, и эффект по нему перезаписывал набранное под курсором.
  const [target, setTarget] = useState("");
  const [note, setNote] = useState("");
  useEffect(() => {
    if (!visible || !locationId) return;
    const current = locations.find((l) => l.id === locationId);
    setTarget(current ? primaryLine(current) : "");
    setNote(current?.note ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- только на открытии
  }, [visible, locationId]);
  // Уточнение адреса «как на доставке» — см. useAddressPartsEdit.
  const address = useAddressPartsEdit(visible, locationId, locations, loc, (id, p) =>
    void writer.patchLocation(id, p),
  );

  // Свайп «Удалить»: спрашиваем один раз на открытие. Вопрос живёт в эффекте —
  // из render его звать нельзя (он выполняется и при повторных рендерах).
  useEffect(() => {
    if (!visible || !askDelete) {
      asked.current = false;
      return;
    }
    if (asked.current || !loc) return;
    asked.current = true;
    confirmDeleteRef.current();
  }, [visible, askDelete, loc]);

  const patch = (p: Partial<Location>) => {
    if (loc) void writer.patchLocation(loc.id, p);
  };

  /** Заметка пишется на уходе с поля и на закрытии листа — как строки
   *  карточки. Пустая стирает прежнюю. */
  const commitNote = () => {
    if (!loc) return;
    const value = note.trim();
    if ((loc.note ?? "") === value) return;
    patch({ note: value || undefined });
  };

  /** Всё, что могло не успеть записаться, — одной точкой. Место пишется
   *  целиком — главная строка + уточнение (см. хук). */
  const commitAll = () => {
    address.commit(target);
    commitNote();
  };

  const confirmDelete = () => {
    if (!loc) return;
    const victim = loc;
    const ask = () =>
      confirmAction(objectDeleteTitle(visitsOnObject(clientVisits.data, victim.id)), {
        message: objectTarget(victim) || victim.label || "Объект",
        confirmLabel: "Удалить",
        destructive: true,
      }).then((ok) => {
        if (ok) {
          haptics.warning();
          void writer.removeLocation(victim.id);
          onDeleted?.(victim.id);
        } else {
          // Без этого отказ оставлял лист открытым (askDelete рисует null —
          // экран выглядел обычным), а `asked` — взведённым: красная кнопка
          // «Удалить» на ВСЕХ объектах после одного отказа молчала.
          asked.current = false;
        }
      });
    // Со свайпа лист не нарисован (`askDelete` → null): спрашиваем сразу и
    // закрываем по ответу, как было.
    if (askDelete) {
      void ask().then(() => onClose());
      return;
    }
    // ИЗ ОТКРЫТОГО ЛИСТА СПРОСИТЬ НЕЛЬЗЯ (DS): вопрос
    // рисует хост приложения, а лист — отдельное окно `Modal`, и вопрос
    // честно появлялся ПОД ним. Сперва уезжаем — с набранным, как при любом
    // закрытии, — и спрашиваем, когда окно листа СНЯТО (`onExited`).
    afterExit.current = () => void ask();
    commitAll();
    onClose();
  };
  confirmDeleteRef.current = confirmDelete;

  const value: ObjectFieldsValue = {
    type: loc?.label ?? "",
    target,
    parts: address.details,
    partsOpen: address.open,
    pin: address.pin,
    note,
  };

  return {
    loc,
    value,
    onChange: (p: Partial<ObjectFieldsValue>) => {
      if (p.type !== undefined) patch({ label: snapObjectType(p.type, typeOptions) });
      if (p.target !== undefined) setTarget(p.target);
      if (p.parts !== undefined) address.setDetails(p.parts);
      if (p.pin !== undefined) address.setPin(p.pin);
      if (p.partsOpen !== undefined) address.setOpen(p.partsOpen);
      if (p.note !== undefined) setNote(p.note);
    },
    commitAll,
    makePrimary: () => {
      if (!loc) return;
      haptics.tap();
      void writer.makePrimary(loc.id);
    },
  };
}

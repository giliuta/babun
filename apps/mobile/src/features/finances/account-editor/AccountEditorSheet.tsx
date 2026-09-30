import { useEffect, useState } from "react";
import { SHEET_EXIT_MS } from "@/components/ui/BottomSheet";
import { CreateAccountSheet } from "./CreateAccountSheet";
import { EditAccountSheet } from "./EditAccountSheet";

// ЛИСТ СЧЁТА — ОДИН НА СОЗДАНИЕ И ПРАВКУ (владелец 2026-09-15).
//
// «Когда я нажимаю „Добавить счёт“ — … ещё лучше не полноценная страница, а
// шторка: подымается шторка на 50%, и там можно полностью всё редактировать. Я
// могу также тапнуть на тот же созданный и то же самое редактировать уже
// созданный счёт». Страница настроек счёта снесена; её адреса ведут на
// «Счета» с этим листом (`accountEditHref`).
//
// Одна дверь на все места: «Счета», футер «Финансов», оплата записи, инвойс.
// Лист грузит своё сам (счета с остатками, включая закрытые; команды, включая
// архивные) — и ТОЛЬКО пока открыт: у записи и инвойса он смонтирован
// всегда, и подсчёт остатков на каждом открытии записи был бы лишним.
//
// Права: создание и правка счёта — владелец (RLS `accounts_owner_all`);
// `account_balances` другим ролям отвечает ошибкой, и лист её называет.

/** Тело снимается после ухода листа: анимация закрытия к этому времени кончилась,
 *  а черновик имени успел дописаться уходом строки. */
const UNMOUNT_AFTER_MS = SHEET_EXIT_MS + 100;

export function AccountEditorSheet({
  visible,
  accountId,
  presetTeamId,
  onClose,
  onCreated,
}: {
  visible: boolean;
  /** null — новый счёт; id — правка существующего (в том числе закрытого). */
  accountId: string | null;
  /** Команда по умолчанию для нового счёта (чип «Финансов»). */
  presetTeamId?: string | null;
  onClose: () => void;
  /** Новый счёт создан. */
  onCreated?: (id: string) => void;
}) {
  const [alive, setAlive] = useState(visible);
  // ЗАКРЫВАЯСЬ, ЛИСТ ДОИГРЫВАЕТ ТОТ РЕЖИМ, В КОТОРОМ БЫЛ: вызывающий вправе
  // сбросить `accountId` вместе с `visible`, и без этой памяти правка уезжала бы
  // вниз уже формой нового счёта.
  const [shownId, setShownId] = useState(accountId);
  if (visible && shownId !== accountId) setShownId(accountId);

  useEffect(() => {
    if (visible) {
      setAlive(true);
      return;
    }
    const timer = setTimeout(() => setAlive(false), UNMOUNT_AFTER_MS);
    return () => clearTimeout(timer);
  }, [visible]);

  if (!visible && !alive) return null;
  const id = visible ? accountId : shownId;
  return id === null ? (
    <CreateAccountSheet
      visible={visible}
      presetTeamId={presetTeamId ?? null}
      onClose={onClose}
      onCreated={onCreated}
    />
  ) : (
    <EditAccountSheet
      key={id}
      visible={visible}
      accountId={id}
      onClose={onClose}
    />
  );
}

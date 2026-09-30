import { useEffect, useRef, useState } from "react";
import { RowGroup } from "@/components/ui/card-rows";
import { NameColorField } from "@/components/ui/picker-fields";
import { notify } from "@/lib/notify";
import type { AccountWithBalance } from "../accounts";
import { accountIcon } from "../account-ui";
import { iconChange } from "../account-kind";
import {
  ACCOUNT_NAME_MAX,
  nameToCommit,
  nameToSend,
  shownName,
  type SentName,
} from "./name-commit";
import type { SaveAccount } from "./types";

const RENAME_FAILED = "Не удалось переименовать счёт";

// ИМЯ, ЦВЕТ И ЗНАЧОК СЧЁТА — ОДНА СТРОКА (владелец 2026-09-15: «названия, цвет
// и иконка — это всё одна строчка»). Тот же блок, что у календаря команды:
// плитка слева открывает цвет и значок, имя правится прямо в строке и
// сохраняется, когда из него уходят. Строка не замерзает никогда — ни одно из
// трёх не трогает историю денег.
export function AccountNameCard({
  account,
  save,
}: {
  account: AccountWithBalance;
  save: SaveAccount;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [sent, setSent] = useState<SentName | null>(null);
  const name = shownName(draft, sent, account.name);

  // ЛИСТ ЗАКРЫЛИ, НЕ ПОКИНУВ ПОЛЯ (свайп вниз, тап по затемнению, уход листа
  // на время вопроса о закрытии) — поле может не отдать `onBlur` вовсе, и
  // набранное пропадало молча. Лист снимает строку, когда уехал, и уход
  // дописывает черновик сам. Коробка держит последние значения рендера, а
  // заодно помнит, что уже в пути и что только что отказало: второй раз то же
  // имя не шлём.
  const box = useRef({
    draft,
    current: account.name,
    save,
    inFlight: null as string | null,
    failed: null as string | null,
  });
  useEffect(() => {
    box.current.draft = draft;
    // Имя В СТРОКЕ, а не в списке: до перечитывания это отправленное имя.
    box.current.current = shownName(null, sent, account.name);
    box.current.save = save;
  });
  useEffect(() => {
    const live = box.current;
    return () => {
      const next = nameToSend(live.draft, live.current);
      if (next === null || next === live.inFlight || next === live.failed) return;
      void live.save({ name: next }, RENAME_FAILED);
    };
  }, []);

  const commitName = () => {
    const value = draft;
    const from = account.name;
    const next = nameToCommit(value, sent, from);
    if (next === null) {
      // Пустое или то, что уже стоит в строке, не пишем — молча возвращаем.
      setDraft(null);
      return;
    }
    if (next === box.current.inFlight) return;
    box.current.inFlight = next;
    // Набранное остаётся в строке до ответа: при отказе оно не пропадает, а
    // после успеха строка держит новое имя, пока список не перечитается.
    void save({ name: next }, RENAME_FAILED).then((ok) => {
      box.current.inFlight = null;
      box.current.failed = ok ? null : next;
      if (!ok) return;
      setSent({ sent: next, from });
      setDraft((current) => (current === value ? null : current));
    });
  };

  return (
    <RowGroup>
      <NameColorField
        bare
        label={null}
        name={name}
        maxLength={ACCOUNT_NAME_MAX}
        onNameChange={setDraft}
        onBlur={commitName}
        color={account.color}
        // Цвет не снимается повторным тапом: он держит заливку строки.
        onColorChange={(hex) => void save({ color: hex }, "Не удалось изменить цвет")}
        icon={account.icon}
        onIconChange={(slug) => {
          // Тип едет за денежным значком, пока операций нет; после первой
          // операции значок другого типа не пишется (`iconChange`).
          const change = iconChange(account, slug);
          if (change.ok) {
            void save(change.patch, "Не удалось изменить значок");
            return;
          }
          // Шторка вида от выбора значка НЕ закрывается (решётка только
          // отмечает плитку), значит ждать её отъезда нечего: системный алерт
          // встаёт поверх любого окна, а тапнутая плитка остаётся
          // неотмеченной.
          notify(change.title, change.message);
        }}
        // Без своего значка (или со старым эмодзи) плитка рисует глиф типа.
        fallback={accountIcon(account)}
      />
    </RowGroup>
  );
}

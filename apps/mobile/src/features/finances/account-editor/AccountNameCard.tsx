import { SectionCard } from "@/components/ui/SectionCard";
import { NameColorField } from "@/components/ui/picker-fields";
import { notify } from "@/lib/notify";
import type { AccountWithBalance } from "../accounts";
import { accountIcon } from "../account-ui";
import { iconChange } from "../account-kind";
import { ACCOUNT_NAME_MAX } from "./name-commit";
import type { StageAccount } from "./types";

// ИМЯ, ЦВЕТ И ЗНАЧОК СЧЁТА — ОДНА СТРОКА (владелец 2026-09-15: «названия, цвет
// и иконка — это всё одна строчка»), первым блоком шторки (вариант 1, 03.10):
// плитка слева открывает цвет и значок, имя правится прямо в строке. Всё
// ложится в черновик листа и уходит на сервер по «Применить» (владелец 03.10).
export function AccountNameCard({
  account,
  stage,
}: {
  /** Счёт с черновиком листа поверх. */
  account: AccountWithBalance;
  stage: StageAccount;
}) {
  return (
    <SectionCard dense>
      <NameColorField
        bare
        label={null}
        name={account.name}
        maxLength={ACCOUNT_NAME_MAX}
        onNameChange={(name) => stage({ name })}
        color={account.color}
        // Цвет не снимается повторным тапом: он держит заливку строки.
        onColorChange={(hex) => stage({ color: hex })}
        icon={account.icon}
        onIconChange={(slug) => {
          // Тип едет за денежным значком, пока операций нет; после первой
          // операции значок другого типа не пишется (`iconChange`).
          const change = iconChange(account, slug);
          if (change.ok) {
            stage(change.patch);
            return;
          }
          // Шторка вида от выбора значка НЕ закрывается: системный алерт
          // встаёт поверх любого окна, а тапнутая плитка остаётся неотмеченной.
          notify(change.title, change.message);
        }}
        // Без своего значка (или со старым эмодзи) плитка рисует глиф типа.
        fallback={accountIcon(account)}
      />
    </SectionCard>
  );
}

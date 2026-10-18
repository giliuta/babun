import { Text, View } from "react-native";
import { ArrowLeftRight, Banknote, FileSpreadsheet, Wallet } from "lucide-react-native";
import { money, moneySign } from "@babun/shared/common/utils/money";
import { SectionCard } from "@/components/ui/SectionCard";
import { SelectRow } from "@/components/ui/select-rows";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { SwitchControl } from "@/components/ui/SwitchControl";
import { useThemeColors } from "@/theme/colors";
import { balanceText, type AccountWithBalance } from "../accounts";
import { useAccountVatDue } from "../vat-queries";
import type { StageAccount } from "./types";

const noop = () => {};
/** Колонка суммы счёта: «€12 345,67» жирным 15pt. */
const SUM_COL_W = 92;
/** Колонка VAT левее суммы: «VAT €1 234,56» серым 13pt. */
const VAT_COL_W = 104;

// ШТОРКА СЧЁТА — КАЖДОЕ ДЕЛО СВОИМ БЛОКОМ, блоки раздельны:
//   • «На счёте» — плашка со значком, справа серым «VAT …» и общая сумма:
//     сумма одна, VAT лежит внутри неё;
//   • «Перевести», «В оплате записи», «Выписка» — каждый своим блоком.
// Строки «Команда» нет: шторку открывают со страницы счетов этой команды.
// «Остатка на начало» тоже нет: его задают при создании счёта.
// Подписей под строками нет.
export function AccountMoneyGroup({
  account,
  accounts,
  stage,
  busy,
  onTransfer,
  onStatement,
}: {
  account: AccountWithBalance;
  accounts: readonly AccountWithBalance[];
  /** Правка в черновик листа: на сервер — по «Применить». */
  stage: StageAccount;
  /** Идёт другая правка счёта — переключатель ждёт её ответа. */
  busy: boolean;
  /** Открыть перевод с этого счёта (или на него, если денег нет). */
  onTransfer: () => void;
  /** Открыть страницу выписки: лист с операциями, потом файл. */
  onStatement: () => void;
}) {
  const t = useThemeColors();
  // ПЕРЕВОДИТЬ ЕСТЬ КУДА, только если рядом есть другой открытый счёт; у
  // закрытого счёта денег в оборотах нет вовсе.
  const canTransfer =
    account.is_active
    && accounts.some((other) => other.is_active && other.id !== account.id);
  // СКОЛЬКО VAT НА СЧЁТЕ К УПЛАТЕ — сколько VAT мы должны будем заплатить.
  // Остаток не назван сервером — прочерк, и VAT рядом с ним не рисуется.
  const vatDueQuery = useAccountVatDue(account.id, account.balance_known);
  const vatDue = account.balance_known ? (vatDueQuery.data ?? 0) : 0;
  const balance = balanceText(account, money);
  const blockBody = { paddingHorizontal: 2, paddingVertical: 2 } as const;

  return (
    <>
      {/* «НА СЧЁТЕ» — ОДНА ОБЩАЯ СУММА, VAT ЛЕЖИТ ВНУТРИ НЕЁ: в эти 320 входит VAT,
          а не отдельно VAT и отдельно сумма без VAT.
          Плашка — та же, что у соседних блоков:
          значок, слово, справа серым «VAT …» и жирная сумма.
          Нет налога — нет и VAT. На счёте — факт, а не
          поле: остаток меняют операции. */}
      <SectionCard dense>
        <View style={blockBody}>
          <SelectRow
            icon={Wallet}
            color={SETTINGS_TILE.green}
            plain
            title="На счёте"
            onPress={noop}
            accessibilityLabel={
              moneySign(vatDue) !== 0
                ? `На счёте ${balance}, в том числе VAT ${money(vatDue)}`
                : `На счёте ${balance}`
            }
            trailing={
              // ДВЕ КОЛОНКИ ПОСТОЯННОЙ ШИРИНЫ: «VAT …» серым перед суммой, чётким рядом
              // для суммы VAT, чтобы не дёргалось слева направо: «VAT …» всегда начинается с
              // одного места, сумма счёта всегда прижата к правому краю, у
              // какого счёта лист ни открой.
              <View style={{ flexDirection: "row", alignItems: "baseline" }}>
                {moneySign(vatDue) !== 0 ? (
                  <Text
                    maxFontSizeMultiplier={1.15}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    style={{ width: VAT_COL_W, fontSize: 13, color: t.sub, fontVariant: ["tabular-nums"] }}
                  >
                    {`VAT ${money(vatDue)}`}
                  </Text>
                ) : null}
                <Text
                  maxFontSizeMultiplier={1.15}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  style={{
                    width: SUM_COL_W,
                    textAlign: "right",
                    fontSize: 15,
                    fontWeight: "700",
                    color: account.balance_known && moneySign(account.balance) < 0 ? t.danger : t.ink,
                    fontVariant: ["tabular-nums"],
                  }}
                >
                  {balance}
                </Text>
              </View>
            }
          />
        </View>
      </SectionCard>

      {canTransfer ? (
        <SectionCard dense>
          <View style={blockBody}>
            <SelectRow icon={ArrowLeftRight} color={t.accent} plain title="Перевести" onPress={onTransfer} />
          </View>
        </SectionCard>
      ) : null}

      <SectionCard dense>
        <View style={blockBody}>
          {/* ПРИНИМАЕТ ЛИ СЧЁТ ДЕНЬГИ ЗАПИСИ — вся плашка тумблер (как
              «Присылать SMS»). Выключенный счёт остаётся на «Финансах», в
              переводах и операциях; он только не стоит плиткой в «Оплате»
              записи (сервер читает тот же флаг). */}
          <SelectRow
            icon={Banknote}
            color={account.show_in_payments ? t.accent : t.faint}
            plain
            title="В оплате записи"
            // Скрытый счёт деньги записи не принимает (база держит это
            // ограничением) — переключатель гаснет, пока счёт скрыт.
            disabled={!account.is_active || !!account.is_hidden}
            accessibilityLabel={`В оплате записи: ${account.show_in_payments ? "да" : "нет"}`}
            accessibilityHint="Ставит счёт плиткой в блок «Оплата» записи"
            onPress={() => {
              if (!account.is_active || account.is_hidden || busy) return;
              stage({ show_in_payments: !account.show_in_payments });
            }}
            trailing={
              <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                <SwitchControl
                  value={account.show_in_payments}
                  disabled={!account.is_active || !!account.is_hidden}
                />
              </View>
            }
          />
        </View>
      </SectionCard>

      <SectionCard dense>
        <View style={blockBody}>
          <SelectRow
            icon={FileSpreadsheet}
            color={SETTINGS_TILE.green}
            plain
            title="Выписка"
            accessibilityHint="Лист с операциями счёта, потом — файл"
            onPress={onStatement}
          />
        </View>
      </SectionCard>
    </>
  );
}

import { Text, View } from "react-native";
import {
  ArrowLeftRight,
  Banknote,
  FileSpreadsheet,
  Wallet,
} from "lucide-react-native";
import { money, moneySign } from "@babun/shared/common/utils/money";
import { SectionCard } from "@/components/ui/SectionCard";
import { SelectRow } from "@/components/ui/select-rows";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { SwitchControl } from "@/components/ui/SwitchControl";
import { useThemeColors } from "@/theme/colors";
import type { AccountWithBalance } from "../accounts";
import { useAccountVatDue } from "../vat-queries";
import type { StageAccount } from "./types";

const noop = () => {};

// ШТОРКА СЧЁТА БЛОКАМИ, КАК «НОВЫЙ ОБЪЕКТ» (владелец 03.10, вариант 1), со
// второго захода того же дня:
//   • «Деньги» — «На счёте», под ним две плитки «Свои | VAT» и «Перевести»:
//     действие с деньгами стоит у денег;
//   • «Счёт» — «В оплате записи» и «Выписка» внизу («выписку надо вниз
//     поставить»).
// Строки «Команда» нет: шторку открывают со страницы счетов этой команды,
// и «Команда · Команда 1» повторяло то, что уже сказано («зачем писать
// команда команда один»). «Остатка на начало» тоже нет («что значит остаток
// на начало — это лишнее»): его задают при создании счёта, а дальше остаток
// живёт операциями. Каждая строка — плашка со значком, подписей под
// строками нет (вкус владельца 02–03.10).
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
  /** Правка в черновик листа: на сервер — по «Применить» (03.10). */
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
  // СКОЛЬКО VAT НА СЧЁТЕ К УПЛАТЕ (владелец 2026-09-23: «сколько VAT мы
  // должны будем заплатить»; 03.10 — своей строкой в «Деньгах»).
  const vatDue = useAccountVatDue(account.id, true).data ?? 0;

  const amount = (text: string, color: string = t.ink) => (
    <Text
      maxFontSizeMultiplier={1.3}
      numberOfLines={1}
      style={{ fontSize: 15, fontWeight: "700", color, fontVariant: ["tabular-nums"] }}
    >
      {text}
    </Text>
  );
  const blockBody = { paddingHorizontal: 2, paddingTop: 2, paddingBottom: 4, gap: 2 } as const;

  return (
    <>
      <SectionCard dense title="Деньги">
        <View style={blockBody}>
          {/* На счёте — факт, а не поле: остаток меняют операции и переводы. */}
          <SelectRow
            icon={Wallet}
            color={SETTINGS_TILE.green}
            plain
            title="На счёте"
            onPress={noop}
            accessibilityLabel={`На счёте ${money(account.balance)}`}
            trailing={amount(money(account.balance), moneySign(account.balance) < 0 ? t.danger : t.ink)}
          />
          {/* «НА СЧЁТЕ» = СВОИ + VAT (владелец 03.10 выбрал вариант 2 из трёх:
              «оно должно быть общая сумма — VAT плюс счёт»). Строка «VAT к
              уплате» стояла рядом с остатком и читалась как вторые деньги;
              плитки показывают, что это части одной суммы. Нет налога — нет и
              плиток. */}
          {moneySign(vatDue) !== 0 ? (
            <View
              accessible
              accessibilityLabel={`Из них свои ${money(account.balance - vatDue)}, VAT ${money(vatDue)}`}
              style={{ flexDirection: "row", gap: 8, paddingHorizontal: 10, paddingBottom: 8 }}
            >
              <MoneyTile word="Свои" value={account.balance - vatDue} tint={SETTINGS_TILE.green} />
              <MoneyTile word="VAT" value={vatDue} tint={SETTINGS_TILE.orange} />
            </View>
          ) : null}
          {canTransfer ? (
            <SelectRow icon={ArrowLeftRight} color={t.accent} plain title="Перевести" onPress={onTransfer} />
          ) : null}
        </View>
      </SectionCard>

      <SectionCard dense title="Счёт">
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
            disabled={!account.is_active}
            accessibilityLabel={`В оплате записи: ${account.show_in_payments ? "да" : "нет"}`}
            accessibilityHint="Ставит счёт плиткой в блок «Оплата» записи"
            onPress={() => {
              if (!account.is_active || busy) return;
              stage({ show_in_payments: !account.show_in_payments });
            }}
            trailing={
              <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                <SwitchControl value={account.show_in_payments} disabled={!account.is_active} />
              </View>
            }
          />
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

/** Плитка части остатка: слово сверху, сумма крупно; заливка — цвет части. */
function MoneyTile({ word, value, tint }: { word: string; value: number; tint: string }) {
  const t = useThemeColors();
  return (
    <View
      style={{
        flex: 1,
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: t.radius.input,
        borderCurve: "continuous",
        backgroundColor: `${tint}1A`,
      }}
    >
      <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 13, color: t.sub }}>
        {word}
      </Text>
      <Text
        maxFontSizeMultiplier={1.3}
        numberOfLines={1}
        style={{
          marginTop: 2,
          fontSize: 17,
          fontWeight: "700",
          color: moneySign(value) < 0 ? t.danger : t.ink,
          fontVariant: ["tabular-nums"],
        }}
      >
        {money(value)}
      </Text>
    </View>
  );
}

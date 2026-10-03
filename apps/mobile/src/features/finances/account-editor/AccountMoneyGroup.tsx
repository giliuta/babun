import { useEffect, useState } from "react";
import { Text, TextInput, View } from "react-native";
import {
  ArrowLeftRight,
  Banknote,
  FileSpreadsheet,
  Flag,
  ReceiptText,
  Users,
  Wallet,
} from "lucide-react-native";
import {
  formatMoneyForInput,
  money,
  moneySign,
  parseMoneyInputToCents,
} from "@babun/shared/common/utils/money";
import { SectionCard } from "@/components/ui/SectionCard";
import { SelectRow } from "@/components/ui/select-rows";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { SwitchControl } from "@/components/ui/SwitchControl";
import { notify } from "@/lib/notify";
import { useThemeColors } from "@/theme/colors";
import type { Team } from "@/features/reference/queries";
import type { AccountWithBalance } from "../accounts";
import { useAccountVatDue } from "../vat-queries";
import { teamControl } from "./editor-logic";
import { TeamChips } from "./TeamChips";
import type { AlertError, StageAccount } from "./types";
import { useAccountStatement } from "./use-account-statement";

const noop = () => {};

// ШТОРКА СЧЁТА БЛОКАМИ, КАК «НОВЫЙ ОБЪЕКТ» (владелец 03.10 выбрал вариант 1):
//   • «Деньги» — «На счёте», «VAT к уплате» и «Остаток на начало» строками
//     (владелец: «сумма и VAT — просто вторым блоком», не плитками);
//   • «Действия» — «Перевести» и «Выписка»;
//   • «Счёт» — команда и «В оплате записи».
// Каждая строка — плашка со значком, как блок «SMS» карточки клиента.
// Строки «Тип счёта» нет (владелец 2026-09-15: «тип вообще убираем») — тип
// задаёт значок в первой строке листа. Подписей-объяснений под строками нет
// (вкус владельца 02–03.10): закрытое просто не правится.
export function AccountMoneyGroup({
  account,
  accounts,
  activeTeams,
  teamById,
  stage,
  busy,
  alertError,
  onTransfer,
}: {
  account: AccountWithBalance;
  accounts: readonly AccountWithBalance[];
  /** Живые команды — кому можно отдать счёт. */
  activeTeams: readonly Team[];
  /** Все команды, включая архивные: у счёта может остаться имя распущенной. */
  teamById: Map<string, Team>;
  /** Правка в черновик листа: на сервер — по «Применить» (03.10). */
  stage: StageAccount;
  /** Идёт другая правка счёта — переключатели ждут её ответа. */
  busy: boolean;
  alertError: AlertError;
  /** Открыть перевод с этого счёта (или на него, если денег нет). */
  onTransfer: () => void;
}) {
  // ПЕРЕВОДИТЬ ЕСТЬ КУДА, только если рядом есть другой открытый счёт; у
  // закрытого счёта денег в оборотах нет вовсе.
  const canTransfer =
    account.is_active
    && accounts.some((other) => other.is_active && other.id !== account.id);
  // СКОЛЬКО VAT НА СЧЁТЕ К УПЛАТЕ (владелец 2026-09-23: «сколько VAT мы
  // должны будем заплатить»; 03.10 — своей строкой в «Деньгах»).
  const vatDue = useAccountVatDue(account.id, true).data ?? 0;

  // Ответ на «можно ли ещё править» приезжает ВМЕСТЕ со счётом
  // (`account_balances.has_history`) и зеркалит серверный
  // `guard_account_financial_history`: лист глушит правку старта и команды
  // заранее, а не отказом после сохранения.
  const hasHistory = account.has_history;
  // ДВЕ РАЗНЫЕ ПРИЧИНЫ ЗАМОРОЗИТЬ ОСТАТОК НА НАЧАЛО, и обе кончаются одним:
  // поле показывается, но не правится. У счёта С ОПЕРАЦИЯМИ правка ломает
  // сходимость истории; у ЗАКРЫТОГО счёта заданный после закрытия остаток не
  // попадает ни в «Всего денег», ни в один подытог (§9.7). Тот же запрет стоит
  // на сервере, в `guard_account_financial_history`.
  const openingFrozen = hasHistory || !account.is_active;
  const control = teamControl(
    account,
    activeTeams.map((team) => team.id),
  );
  // ГРУППЫ «КОМАНДА» НЕТ, КОГДА ВЫБИРАТЬ НЕ ИЗ ЧЕГО (прогон 2026-09-23): у
  // компании с одной командой строка «Команда · Y&D» — единственная в своей
  // группе и ничего не решает. Тот же закон, что у листа создания: «у тенанта
  // с одной командой вопрос не задаётся вовсе». Счёт удалённой или архивной
  // команды и счёт «Без команды» группу держат — там она и есть новость.
  const showTeam = !(
    control === "fixed"
    && account.brigade_id !== null
    && activeTeams.length <= 1
    && activeTeams.some((team) => team.id === account.brigade_id)
  );

  const t = useThemeColors();
  const statement = useAccountStatement(account);
  const amount = (text: string, color: string = t.ink) => (
    <Text
      maxFontSizeMultiplier={1.3}
      numberOfLines={1}
      style={{ fontSize: 15, fontWeight: "700", color, fontVariant: ["tabular-nums"] }}
    >
      {text}
    </Text>
  );
  const teamName = account.brigade_id
    ? (teamById.get(account.brigade_id)?.name ?? "Команда удалена")
    : "Без команды";
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
          {/* VAT СТРОКОЙ, А НЕ СКОБКОЙ (владелец 03.10: «VAT к уплате — просто
              вторым блоком»). Нет налога — нет и строки. */}
          {moneySign(vatDue) !== 0 ? (
            <SelectRow
              icon={ReceiptText}
              color={SETTINGS_TILE.orange}
              plain
              title="VAT к уплате"
              onPress={noop}
              accessibilityLabel={`VAT к уплате ${money(vatDue)}`}
              trailing={amount(money(vatDue))}
            />
          ) : null}
          {/* С ЧЕГО СЧЁТ НАЧАЛСЯ. Правится, пока по счёту нет операций и он
              открыт (тот же запрет — на сервере,
              `guard_account_financial_history`); потом — просто число. */}
          <SelectRow
            icon={Flag}
            color={openingFrozen ? t.faint : t.accent}
            plain
            title="Остаток на начало"
            onPress={noop}
            accessibilityLabel={`Остаток на начало ${money(account.opening_balance)}`}
            trailing={
              openingFrozen ? (
                amount(money(account.opening_balance), t.sub)
              ) : (
                <OpeningField
                  value={account.opening_balance}
                  onSave={(num) => stage({ opening_balance: num })}
                />
              )
            }
          />
        </View>
      </SectionCard>

      <SectionCard dense title="Действия">
        <View style={blockBody}>
          {canTransfer ? (
            // ДЕЙСТВИЕ С ДЕНЬГАМИ СТОИТ У ДЕНЕГ, а не второй кнопкой в футере:
            // действие листа одно, а это — операция над суммой выше.
            <SelectRow icon={ArrowLeftRight} color={t.accent} plain title="Перевести" onPress={onTransfer} />
          ) : null}
          <SelectRow
            icon={FileSpreadsheet}
            color={SETTINGS_TILE.green}
            plain
            title="Выписка"
            subtitle={statement.busy ? "Готовим файл…" : undefined}
            accessibilityHint="Все операции счёта одним файлом"
            onPress={() => void statement.run()}
          />
        </View>
      </SectionCard>

      <SectionCard dense title="Счёт">
        <View style={blockBody}>
          {showTeam ? (
            // ЧЕЙ ЭТО СЧЁТ. Пустая команда — не «команду удалили», а счёт
            // старой схемы: его отдают команде целиком (`scope` и
            // `brigade_id` одной правкой) даже с историей.
            <SelectRow
              icon={Users}
              color={control === "fixed" ? t.faint : t.accent}
              plain
              title="Команда"
              onPress={noop}
              accessibilityLabel={`Команда ${teamName}`}
              trailing={control === "fixed" ? amount(teamName, t.sub) : undefined}
            />
          ) : null}
          {showTeam && control !== "fixed" ? (
            <View style={{ paddingHorizontal: 12, paddingBottom: 8 }}>
              <TeamChips
                teams={activeTeams}
                selectedId={account.brigade_id}
                disabled={busy}
                onSelect={(teamId) => {
                  if (teamId === account.brigade_id) return;
                  stage(control === "hand-over" ? { scope: "team", brigade_id: teamId } : { brigade_id: teamId });
                }}
              />
            </View>
          ) : null}
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
        </View>
      </SectionCard>
    </>
  );
}

/** «Остаток на начало», пока он правится: мягкая акцентная плашка с числом,
 *  как «Имя для SMS». Пишется, когда поле отпускают; пустое — не «ноль». */
function OpeningField({ value, onSave }: { value: number; onSave: (num: number) => void }) {
  const t = useThemeColors();
  const [draft, setDraft] = useState<string | null>(null);
  useEffect(() => setDraft(null), [value]);
  return (
    <View
      style={{
        minWidth: 96,
        maxWidth: 160,
        height: 36,
        justifyContent: "center",
        paddingHorizontal: 12,
        borderRadius: t.radius.input,
        backgroundColor: `${t.accent}14`,
      }}
    >
      <TextInput
        value={draft ?? formatMoneyForInput(value)}
        onChangeText={setDraft}
        placeholder="0"
        placeholderTextColor={t.placeholder}
        keyboardType="numbers-and-punctuation"
        returnKeyType="done"
        selectionColor={t.accent}
        accessibilityLabel="Остаток на начало"
        maxFontSizeMultiplier={1.3}
        style={{ fontSize: 15, fontWeight: "600", color: t.accent, textAlign: "right", padding: 0, fontVariant: ["tabular-nums"] }}
        onBlur={() => {
          const next = draft;
          if (next === null || !next.trim()) {
            setDraft(null);
            return;
          }
          const cents = parseMoneyInputToCents(next, { allowNegative: true, allowZero: true });
          if (cents == null) {
            notify("Проверьте сумму", "Остаток на начало — число, максимум два знака после запятой. Например: 1250,50");
            setDraft(null);
            return;
          }
          const num = cents / 100;
          if (num !== value) onSave(num);
        }}
      />
    </View>
  );
}

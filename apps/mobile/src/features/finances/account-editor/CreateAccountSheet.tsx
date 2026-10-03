import { useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { Banknote, Users, Wallet } from "lucide-react-native";
import { parseMoneyInputToCents } from "@babun/shared/common/utils/money";
import { isOnline, useIsOnline } from "@babun/shared/sync";
import { BottomSheet, SHEET_EXIT_MS } from "@/components/ui/BottomSheet";
import { EmptyState } from "@/components/ui/EmptyState";
import { GradientButton } from "@/components/ui/GradientButton";
import { NameColorField } from "@/components/ui/picker-fields";
import { SectionCard } from "@/components/ui/SectionCard";
import { SelectRow } from "@/components/ui/select-rows";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { SwitchControl } from "@/components/ui/SwitchControl";
import { GUTTER } from "@/components/ui/tokens";
import { useGuardedClose } from "@/components/ui/use-guarded-close";
import { notify } from "@/lib/notify";
import { useThemeColors } from "@/theme/colors";
import { useTeams } from "@/features/reference/queries";
import { haptics } from "@/lib/haptics";
import { useAccountsWithBalances, useInsertAccount } from "../accounts";
import { OFFLINE_ACCOUNT_CREATE } from "../account-alerts";
import { kindForIcon } from "../account-kind";
import { accountIcon } from "../account-ui";
import { duplicateNameNote, findDuplicateName } from "./account-names";
import { ACCOUNT_NAME_MAX } from "./name-commit";
import { TeamChips } from "./TeamChips";
import { ACCOUNT_SHEET_RATIO } from "./types";

const noop = () => {};

// НОВЫЙ СЧЁТ — ТЕМИ ЖЕ БЛОКАМИ, ЧТО «НАСТРОЙКИ СЧЁТА» (владелец 03.10:
// «исправляй и делай всё так же»). Раньше лист был формой старого образца —
// подписи над полями, сумма над именем, «Чей счёт» на странице одной команды
// и «Создать счёт» при «Добавить счёт» на странице.
//
// Порядок — как у правки: имя, цвет и значок одной строкой → «На счёте»
// (сколько лежит сейчас; минус разрешён — счёт заводят и в долге) →
// «Команда» (только если выбирать есть из чего и экран не стоит на команде)
// → «В оплате записи». Каждое — своей плашкой на прохладном фоне.
//
// ТИПА СЧЁТА ФОРМА НЕ СПРАШИВАЕТ (владелец 2026-09-15: «тип вообще убираем»):
// тип выводится из значка (`kindForIcon`), пустой выбор — касса.
// НАЛОГА И ВАЛЮТЫ У СЧЁТА НЕТ: VAT решает «Итого» записи, валюта — компании.
//
// Причины отказа — системным окном по нажатию, как «Применить» у правки, а не
// серой строкой над кнопкой: подписей под строками и над кнопкой в шторках
// нет (вкус владельца 02–03.10).
export function CreateAccountSheet({
  visible,
  presetTeamId,
  teamLocked,
  onClose,
  onCreated,
}: {
  visible: boolean;
  /** Кто отмечен при открытии — команда, выбранная на экране. */
  presetTeamId: string | null;
  /** Экран уже стоит на команде — выбора команды в листе нет (владелец 03.10:
   *  «зашёл на команду один — значит, счёт для команды один»). */
  teamLocked: boolean;
  onClose: () => void;
  onCreated?: (id: string) => void;
}) {
  const t = useThemeColors();
  const router = useRouter();
  const online = useIsOnline();
  const insert = useInsertAccount();
  // Активные команды — из них выбирается владелец счёта.
  const teamsQuery = useTeams();
  const teams = useMemo(() => teamsQuery.data ?? [], [teamsQuery.data]);
  const teamsLoaded = teamsQuery.data !== undefined;
  const accountsQuery = useAccountsWithBalances({ includeInactive: true });

  const [name, setName] = useState("");
  /** Владелец счёта — ровно одна команда. */
  const [teamId, setTeamId] = useState<string | null>(null);
  const [opening, setOpening] = useState("");
  /** Значок и цвет — узнавание счёта в списке. Оба необязательны. */
  const [icon, setIcon] = useState<string | null>(null);
  const [color, setColor] = useState<string | null>(null);
  const [inPayments, setInPayments] = useState(true);

  // Каждое ОТКРЫТИЕ листа начинает с чистой формы. Только по фронту открытия:
  // фоновый рефетч при открытом листе не должен стирать набранное.
  const opened = useRef(false);
  const teamSeeded = useRef(false);
  useEffect(() => {
    if (!visible) {
      opened.current = false;
      return;
    }
    if (opened.current) return;
    opened.current = true;
    teamSeeded.current = false;
    setName("");
    setTeamId(null);
    setOpening("");
    setIcon(null);
    setColor(null);
    setInPayments(true);
  }, [visible]);
  // Команда ставится, когда справочник есть, — один раз на открытие, чтобы
  // поздний ответ не перебил уже сделанный выбор. Пресет перепроверяется по
  // живому справочнику: команду могли заархивировать, пока экран стоял на ней.
  useEffect(() => {
    if (!visible || teamSeeded.current || !teamsLoaded) return;
    teamSeeded.current = true;
    const preset =
      presetTeamId && teams.some((x) => x.id === presetTeamId)
        ? presetTeamId
        : null;
    setTeamId(preset ?? (teams.length === 1 ? teams[0].id : null));
  }, [visible, presetTeamId, teams, teamsLoaded]);

  const openingCents = opening.trim()
    ? parseMoneyInputToCents(opening, { allowNegative: true, allowZero: true })
    : 0;
  const ownerName = teams.find((x) => x.id === teamId)?.name ?? null;
  const duplicate = useMemo(
    () => findDuplicateName(accountsQuery.data ?? [], name, teamId),
    [accountsQuery.data, name, teamId],
  );
  // Выбор команды — только когда выбирать есть из чего и экран не стоит на
  // одной команде (владелец 03.10: «зачем писать команда команда один»).
  const showTeams = teams.length >= 2 && !(teamLocked && teamId);

  const dirty = name.trim() !== "" || opening.trim() !== "" || icon !== null || color !== null;
  const guard = useGuardedClose({
    dirty,
    busy: insert.isPending,
    onClose,
    message: "Новый счёт не сохранится.",
  });

  const submit = async () => {
    // Сеть проверяется В МОМЕНТ нажатия: между кадром и тапом она могла пропасть.
    if (!isOnline()) {
      notify("Нет сети", OFFLINE_ACCOUNT_CREATE);
      return;
    }
    // БРИГАДА ОБЯЗАТЕЛЬНА ВСЕГДА: счёт заводится строго на команду.
    if (!teamId) {
      notify("Выберите команду", "Счёт заводится на одну команду.");
      return;
    }
    if (!name.trim()) {
      notify("Дайте счёту название", "Без названия счёт не узнать в оплате и переводах.");
      return;
    }
    if (openingCents == null) {
      notify("Проверьте сумму", "Сумма на счёте — число, максимум два знака после запятой. Например: 1250,50");
      return;
    }
    if (duplicate) {
      notify("Такое название уже есть", duplicateNameNote(duplicate, ownerName) ?? "Дайте счёту другое название.");
      return;
    }
    try {
      const created = await insert.mutateAsync({
        // ОХВАТ ВСЕГДА «team»: другого в продукте не бывает.
        scope: "team",
        brigade_id: teamId,
        name: name.trim(),
        kind: kindForIcon(icon, "cash"),
        opening_balance: openingCents / 100,
        icon,
        color,
        show_in_payments: inPayments,
      });
      haptics.success();
      onCreated?.(created.id);
      onClose();
    } catch (e) {
      // Лист остаётся открытым — набранное не теряется.
      const message = e instanceof Error ? e.message : "";
      notify(
        "Не удалось добавить счёт",
        isOnline() ? message || "Попробуйте ещё раз." : OFFLINE_ACCOUNT_CREATE,
      );
    }
  };

  // БРИГАД НЕТ — ФОРМЫ НЕТ. Счёт заводится строго на команду: в теле одна
  // строка, кнопка — в футере (владелец 2026-09-15: «никаких кнопок внутри»).
  if (teamsLoaded && teams.length === 0) {
    return (
      <BottomSheet
        padded={false}
        visible={visible}
        onClose={onClose}
        title="Новый счёт"
        maxHeightRatio={ACCOUNT_SHEET_RATIO}
        footer={
          <View style={{ paddingHorizontal: GUTTER, paddingTop: 8 }}>
            <GradientButton
              label="Добавить команду"
              onPress={() => {
                onClose();
                // Экран команд открывается ПОСЛЕ отъезда листа: окно поверх
                // закрывающегося листа не появляется.
                setTimeout(() => router.push("/calendar"), SHEET_EXIT_MS);
              }}
            />
          </View>
        }
      >
        <EmptyState title="Сначала нужна команда" />
      </BottomSheet>
    );
  }

  const blockBody = { paddingHorizontal: 2, paddingVertical: 2 } as const;

  return (
    <BottomSheet
      padded={false}
      visible={visible && !guard.hidden}
      onClose={guard.close}
      onExited={guard.onExited}
      title="Новый счёт"
      avoidKeyboard
      maxHeightRatio={ACCOUNT_SHEET_RATIO}
      footer={
        // Лист без полей (`padded={false}`): отступ у кнопки свой — тот же,
        // что у «Применить» в листе правки.
        <View style={{ paddingHorizontal: GUTTER, paddingTop: 8 }}>
          <GradientButton
            label="Добавить счёт"
            onPress={() => void submit()}
            disabled={!online || !teamsLoaded || insert.isPending}
            loading={insert.isPending}
          />
        </View>
      }
    >
      <ScrollView
        style={{ flexShrink: 1, backgroundColor: t.canvas }}
        contentContainerStyle={{ paddingBottom: 24 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* ИМЯ, ЦВЕТ И ЗНАЧОК — одна строка, как первым блоком правки. */}
        <SectionCard dense>
          <NameColorField
            bare
            label={null}
            placeholder="Название счёта"
            name={name}
            maxLength={ACCOUNT_NAME_MAX}
            onNameChange={setName}
            color={color}
            // Цвет не снимается повторным тапом: он держит заливку строки.
            onColorChange={(hex) => setColor(hex)}
            icon={icon}
            // Снятие делает сама решётка: повторный тап отдаёт `null`.
            onIconChange={(slug) => setIcon(slug)}
            fallback={accountIcon({ icon, kind: kindForIcon(icon, "cash") })}
          />
        </SectionCard>

        {/* СКОЛЬКО ЛЕЖИТ СЕЙЧАС — та же плашка «На счёте», что у правки;
            сумма вводится справа. Пусто — ноль. */}
        <SectionCard dense>
          <View style={blockBody}>
            <SelectRow
              icon={Wallet}
              color={SETTINGS_TILE.green}
              plain
              title="На счёте"
              onPress={noop}
              trailing={
                <AmountInput
                  value={opening}
                  onChange={setOpening}
                  invalid={opening.length > 0 && openingCents == null}
                />
              }
            />
          </View>
        </SectionCard>

        {showTeams ? (
          <SectionCard dense>
            <View style={blockBody}>
              <SelectRow
                icon={Users}
                color={t.accent}
                plain
                title="Команда"
                onPress={noop}
                />
              <View style={{ paddingHorizontal: 12, paddingBottom: 8 }}>
                <TeamChips teams={teams} selectedId={teamId} onSelect={setTeamId} />
              </View>
            </View>
          </SectionCard>
        ) : null}

        {/* ПРИНИМАЕТ ЛИ СЧЁТ ДЕНЬГИ ЗАПИСИ — вся плашка тумблер, как в правке. */}
        <SectionCard dense>
          <View style={blockBody}>
            <SelectRow
              icon={Banknote}
              color={inPayments ? t.accent : t.faint}
              plain
              title="В оплате записи"
              accessibilityLabel={`В оплате записи: ${inPayments ? "да" : "нет"}`}
              accessibilityHint="Ставит счёт плиткой в блок «Оплата» записи"
              onPress={() => setInPayments((on) => !on)}
              trailing={
                <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                  <SwitchControl value={inPayments} />
                </View>
              }
            />
          </View>
        </SectionCard>
      </ScrollView>
    </BottomSheet>
  );
}

/** Сумма в плашке «На счёте»: мягкая акцентная пилюля с числом, как «Имя
 *  для SMS». Ошибка — красным числом, без подписи под строкой. */
function AmountInput({
  value,
  onChange,
  invalid,
}: {
  value: string;
  onChange: (next: string) => void;
  invalid: boolean;
}) {
  const t = useThemeColors();
  return (
    <View
      style={{
        minWidth: 96,
        maxWidth: 160,
        height: 36,
        justifyContent: "center",
        paddingHorizontal: 12,
        borderRadius: t.radius.input,
        backgroundColor: invalid ? `${t.danger}14` : `${t.accent}14`,
      }}
    >
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder="0"
        placeholderTextColor={t.placeholder}
        keyboardType="numbers-and-punctuation"
        returnKeyType="done"
        selectionColor={t.accent}
        accessibilityLabel="Сколько сейчас на счёте"
        maxFontSizeMultiplier={1.3}
        style={{
          fontSize: 15,
          fontWeight: "600",
          color: invalid ? t.danger : t.accent,
          textAlign: "right",
          padding: 0,
          fontVariant: ["tabular-nums"],
        }}
      />
    </View>
  );
}

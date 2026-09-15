import { useEffect, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { useRouter } from "expo-router";
import { parseMoneyInputToCents } from "@babun/shared/common/utils/money";
import { isOnline, useIsOnline } from "@babun/shared/sync";
import { BottomSheet, SHEET_EXIT_MS } from "@/components/ui/BottomSheet";
import { FieldLabel } from "@/components/ui/Field";
import { GradientButton } from "@/components/ui/GradientButton";
import { MoneyField } from "@/components/ui/MoneyField";
import { NameColorField } from "@/components/ui/picker-fields";
import { SwitchRow } from "@/components/ui/SwitchRow";
import { GUTTER } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import { useTenant } from "@/features/settings/tenant";
import { useTeams } from "@/features/reference/queries";
import { haptics } from "@/lib/haptics";
import { useAccountsWithBalances, useInsertAccount } from "../accounts";
import { OFFLINE_ACCOUNT_CREATE } from "../account-alerts";
import { kindForIcon } from "../account-kind";
import { accountIcon } from "../account-ui";
import {
  useTeamVatOverrides,
  useVatSettings,
  vatSummaryLine,
} from "../vat-queries";
import { duplicateNameNote, findDuplicateName } from "./account-names";
import { ACCOUNT_NAME_MAX } from "./name-commit";
import { TeamChips } from "./TeamChips";
import { ACCOUNT_SHEET_RATIO } from "./types";
import { accountVatView } from "./vat-view";

// НОВЫЙ СЧЁТ — режим создания листа счёта (`AccountEditorSheet`).
//
// ПОРЯДОК ВОПРОСОВ ПЕРЕСОБРАН 2026-08-15 по образцу, который показал владелец:
// СНАЧАЛА СУММА — крупно, первой строкой. Раньше она стояла третьей и на
// телефоне уходила под клавиатуру: счёт заводят, чтобы записать уже лежащие
// деньги, и прятать их под сгибом неправильно.
//
// Дальше: название, цвет и значок ОДНОЙ СТРОКОЙ (владелец 2026-09-15: «названия,
// цвет и иконка — это всё одна строчка») → чей счёт → с НДС ли он. Наборы
// значков и цветов ОБЩИЕ НА ПРОДУКТ, первая восьмёрка значков — про деньги.
//
// ВАЛЮТЫ У СЧЁТА НЕТ (владелец 2026-08-15): компания работает в одной валюте
// (`tenants.currency`), и она же подписывает сумму здесь.
//
// СЧЁТ ПРИНАДЛЕЖИТ ОДНОЙ БРИГАДЕ (владелец 2026-08-15: «счёт создаётся чётко на
// каждую команду»). У тенанта с одной командой вопрос не задаётся вовсе.
//
// ТИПА СЧЁТА ФОРМА НЕ СПРАШИВАЕТ (владелец 2026-09-15: «тип вообще убираем»).
// Тип выводится из значка (`kindForIcon`), а пустой выбор — КАССА, не «другое»:
// «Наличные», заведённые без значка, иначе отбивали оплату наличными (разбор
// багов счетов 2026-09-15).
//
// ЛИСТ ГРУЗИТ СВОЁ САМ: команды и счета (дубль имени проверяется и по закрытым).
export function CreateAccountSheet({
  visible,
  presetTeamId,
  onClose,
  onCreated,
}: {
  visible: boolean;
  /** Кто отмечен при открытии — команда, выбранная на экране. */
  presetTeamId: string | null;
  onClose: () => void;
  onCreated?: (id: string) => void;
}) {
  const t = useThemeColors();
  const router = useRouter();
  const online = useIsOnline();
  const insert = useInsertAccount();
  const currency = useTenant().data?.currency;
  const vatSettings = useVatSettings();
  const teamVatOverrides = useTeamVatOverrides();
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
  /** «С НДС» счёта. Новый счёт — БЕЗ НДС (владелец 2026-09-15: «по умолчанию
   *  всегда без НДС»; «С НДС» включают руками у карты или банка компании). До
   *  этого пустое значение наследовало компанию, и у компании «с НДС» лист
   *  открывался с включённым переключателем — каждая касса молча становилась
   *  налоговой. */
  const [vatMode, setVatMode] = useState<"on" | "off">("off");
  /** Отказ сервера печатается НАД кнопкой, а не алертом: набранное остаётся на
   *  экране, и повтор не начинается с чистой формы. */
  const [failure, setFailure] = useState<string | null>(null);

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
    setVatMode("off");
    setFailure(null);
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

  // НДС СПРАШИВАЕТСЯ ТОЛЬКО У ТЕХ, КТО С НИМ РАБОТАЕТ. Переключатель стартует
  // выключенным; подпись под ним — что значит «С НДС» у выбранной команды. Пока
  // настройки не пришли, строки нет — счёт уходит без НДС, это верный ответ.
  const vatView = accountVatView({
    company: { data: vatSettings.data, failed: vatSettings.isError },
    overrides: { data: teamVatOverrides.data, failed: teamVatOverrides.isError },
    teamId,
    accountMode: vatMode,
    summary: vatSummaryLine,
  });

  const duplicate = useMemo(
    () => findDuplicateName(accountsQuery.data ?? [], name, teamId),
    [accountsQuery.data, name, teamId],
  );
  const duplicateNote = duplicateNameNote(duplicate, ownerName);

  // Над погашенной кнопкой всегда стоит причина: молчащая серая кнопка
  // читается как поломка продукта. Офлайн — первой: остальные придирки к форме
  // бессмысленны, пока записать её всё равно некуда.
  const reason = !online
    ? OFFLINE_ACCOUNT_CREATE
    : !teamsLoaded
      ? "Загружаем команды"
      : // БРИГАДА ОБЯЗАТЕЛЬНА ВСЕГДА: `submit` шлёт `scope: "team"`, а
        // клиентский `assertScopeConsistency` отвергает такой счёт без
        // `brigade_id` ещё до сети.
        !teamId
        ? "Выберите, чей это счёт"
        : !name.trim()
          ? "Дайте счёту название"
          : openingCents == null
            ? "Проверьте сумму на счёте"
            : duplicate
              ? duplicate.is_active
                ? "Такое название уже занято"
                : "Название занято закрытым счётом"
              : null;
  const canSave = reason == null && !insert.isPending;
  /** Отказ сервера сильнее придирки к форме, а на время отправки замолкают
   *  обе — там уже говорит вертушка самой кнопки. */
  const footerNote = failure ?? (insert.isPending ? null : reason);

  const submit = async () => {
    if (openingCents == null) return;
    // Сеть проверяется В МОМЕНТ нажатия: между кадром и тапом она могла пропасть.
    if (!isOnline()) {
      setFailure(OFFLINE_ACCOUNT_CREATE);
      return;
    }
    setFailure(null);
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
        vat_mode: vatMode,
      });
      haptics.success();
      onCreated?.(created.id);
      onClose();
    } catch (e) {
      // Лист остаётся открытым — набранное не теряется.
      const message = e instanceof Error ? e.message : "";
      setFailure(
        isOnline() ? message || "Не удалось создать счёт" : OFFLINE_ACCOUNT_CREATE,
      );
    }
  };

  // БРИГАД НЕТ — ФОРМЫ НЕТ. Счёт заводится строго на команду, и вместо тупика
  // лист называет причину и ведёт в создание команды. В теле только слова,
  // кнопка — в футере (владелец 2026-09-15: «никаких кнопок внутри»).
  if (teamsLoaded && teams.length === 0) {
    return (
      <BottomSheet
        padded={false}
        visible={visible}
        onClose={onClose}
        title="Новый счёт"
        maxHeightRatio={ACCOUNT_SHEET_RATIO}
        footer={
          <View style={{ paddingHorizontal: GUTTER }}>
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
        <View style={{ paddingHorizontal: GUTTER, paddingBottom: 8 }}>
          <Text
            maxFontSizeMultiplier={1.3}
            style={{ fontSize: 15, lineHeight: 21, color: t.sub }}
          >
            Команд пока нет, а счёт заводится на команду — сперва добавьте
            команду.
          </Text>
        </View>
      </BottomSheet>
    );
  }

  return (
    // АНАТОМИЯ ДЕНЕЖНОГО ЛИСТА: заголовок в тянущейся зоне → тело в прокрутке
    // → кнопка ВНЕ прокрутки со своим нижним безопасным отступом.
    <BottomSheet
      padded={false}
      visible={visible}
      onClose={onClose}
      title="Новый счёт"
      scroll
      avoidKeyboard
      maxHeightRatio={ACCOUNT_SHEET_RATIO}
      footer={
        <View style={{ paddingHorizontal: GUTTER }}>
          {footerNote ? (
            <Text
              accessibilityLiveRegion="polite"
              className="mb-2 text-center text-[13px]"
              style={{ color: failure ? t.danger : t.sub }}
            >
              {footerNote}
            </Text>
          ) : null}
          <GradientButton
            label="Создать счёт"
            onPress={submit}
            disabled={!canSave}
            loading={insert.isPending}
          />
        </View>
      }
    >
      {/* Снизу 16pt: причина погашенной кнопки стоит в футере прямо под
          последней строкой, и на 8pt она прилипала к подписи «С НДС». */}
      <View style={{ paddingHorizontal: GUTTER, paddingBottom: 16 }}>
        {/* 1. СКОЛЬКО НА СЧЕТУ — первым и крупно. Минус разрешён: счёт заводят
            и в долге. */}
        <MoneyField
          label="Сколько сейчас на счёте"
          value={opening}
          onChangeText={(v) => {
            setOpening(v);
            setFailure(null);
          }}
          currency={currency}
          allowNegative
          autoFocus
          error={
            opening.length > 0 && openingCents == null
              ? "Введите сумму и не больше двух знаков после запятой."
              : null
          }
        />

        {/* 2. НАЗВАНИЕ, ЦВЕТ И ЗНАЧОК — одна строка. Без значка плитка рисует
            глиф того типа, который из значка и выводится. */}
        <NameColorField
          name={name}
          maxLength={ACCOUNT_NAME_MAX}
          onNameChange={(v) => {
            setName(v);
            // Правка — попытка исправить отказ: прошлая жалоба сервера над
            // кнопкой больше не про эту форму.
            setFailure(null);
          }}
          color={color}
          // Цвет не снимается повторным тапом: он держит заливку строки.
          onColorChange={(hex) => setColor(hex)}
          icon={icon}
          // Снятие делает сама решётка: повторный тап отдаёт `null`.
          onIconChange={(slug) => setIcon(slug)}
          fallback={accountIcon({ icon, kind: kindForIcon(icon, "cash") })}
        />
        {duplicateNote ? (
          <Text
            maxFontSizeMultiplier={1.3}
            style={{
              marginBottom: 12,
              fontSize: 13,
              lineHeight: 18,
              color: t.warning,
            }}
          >
            {duplicateNote}
          </Text>
        ) : null}

        {/* 3. ЧЕЙ ЭТО СЧЁТ — ровно ОДНА команда; у тенанта с одной командой
            вопроса нет. */}
        {teams.length >= 2 ? (
          <View className="mb-2">
            <FieldLabel text="Чей счёт" />
            <TeamChips teams={teams} selectedId={teamId} onSelect={setTeamId} />
          </View>
        ) : null}

        {/* 4. С НДС ЛИ СЧЁТ — только у компании, которая с налогом работает. */}
        {vatView.kind === "switch" ? (
          <SwitchRow
            label="С НДС"
            hint={vatView.hint}
            value={vatView.value}
            inset={false}
            onChange={(next) => setVatMode(next ? "on" : "off")}
          />
        ) : null}
      </View>
    </BottomSheet>
  );
}

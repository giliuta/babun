import { useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Users } from "lucide-react-native";
import {
  formatMoneyForInput,
  money,
  moneySign,
  parseMoneyInputToCents,
} from "@babun/shared/common/utils/money";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Divider } from "@/components/ui/Divider";
import { SwitchRow } from "@/components/ui/SwitchRow";
import {
  ActionRow,
  ChoiceRow,
  FieldRow,
  NavRow,
  RowCaption,
  RowGroup,
} from "@/components/ui/card-rows";
import { ColorPicker } from "@/components/ui/ColorPicker";
import { IconPicker } from "@/components/ui/IconPicker";
import { ColorDot, IconGlyph } from "@/components/ui/picker-fields";
import { PickerSheet } from "@/components/ui/PickerSheet";
import { chooseValue } from "@/lib/choose";
import { confirmThen } from "@/lib/confirm";
import { notify } from "@/lib/notify";
import { useThemeColors } from "@/theme/colors";
import { isOnline, useIsOnline } from "@babun/shared/sync";
import { useTeams } from "@/features/reference/queries";
import {
  useAccountsWithBalances,
  useDeleteAccount,
  useReopenAccount,
  useSetPrimaryAccount,
  useSoftCloseAccount,
  useUpdateAccount,
} from "@/features/finances/accounts";
import {
  accountNotEmptyAlert,
  closeAccountAlert,
  deleteAccountAlert,
  ACCOUNT_GONE_SETTINGS,
  CLOSED_ACCOUNT_OPENING_FROZEN,
  FROZEN_FIELDS_CAPTION,
  OFFLINE_ACCOUNT_EDIT,
  ORPHAN_FROZEN_FIELDS_CAPTION,
} from "@/features/finances/account-alerts";
import { KINDS } from "@/features/finances/account-ui";
import { TransferSheet } from "@/features/finances/TransferSheet";
import { effectiveVatSettings, useTeamVatOverrides, useVatSettings } from "@/features/finances/vat-queries";
import type { Account, AccountKind } from "@babun/shared/local/finance/account";

// НДС СЧЁТА ЧЕЛОВЕЧЕСКИМИ СЛОВАМИ (три ключа locked 2026-08-09).
//
// Порядок: три РАБОЧИХ ключа первыми, умолчание последним. Раньше «Как в
// настройках» стояло первым и было залито кобальтом — самой громкой заливкой
// экрана, хотя кобальт по ДС значит «действие», а это значение означает
// «счёт молчит». Плюс оно не говорило, что именно стоит в тех настройках, —
// теперь говорит: «Как в настройках (Плюс НДС)».
const ACCOUNT_VAT_KEYS = ["Без НДС", "НДС включён", "Плюс НДС"] as const;
const VAT_INHERIT = "Как в настройках";

function accountVatLabel(mode: Account["vat_mode"]): string {
  if (mode === "off") return "Без НДС";
  if (mode === "inclusive") return "НДС включён";
  if (mode === "exclusive") return "Плюс НДС";
  return VAT_INHERIT;
}

function accountVatValue(label: string): Account["vat_mode"] {
  if (label === "Без НДС") return "off";
  if (label === "НДС включён") return "inclusive";
  if (label === "Плюс НДС") return "exclusive";
  return null;
}

function AccountSettingsContent() {
  const t = useThemeColors();
  const router = useRouter();
  const online = useIsOnline();
  const { id } = useLocalSearchParams<{ id: string }>();

  const accountsQuery = useAccountsWithBalances({ includeInactive: true });
  const accounts = useMemo(
    () => accountsQuery.data ?? [],
    [accountsQuery.data],
  );
  const account = accounts.find((a) => a.id === id) ?? null;
  const activeAccounts = useMemo(
    () => accounts.filter((a) => a.is_active),
    [accounts],
  );

  const teamsQuery = useTeams();
  const allTeamsQuery = useTeams({ includeInactive: true });
  const teams = useMemo(() => teamsQuery.data ?? [], [teamsQuery.data]);
  const teamById = useMemo(
    () => new Map((allTeamsQuery.data ?? []).map((team) => [team.id, team])),
    [allTeamsQuery.data],
  );

  const update = useUpdateAccount();
  const vatSettings = useVatSettings();
  const teamVatOverrides = useTeamVatOverrides();
  const vatOn =
    (vatSettings.data?.mode ?? "off") !== "off" &&
    (vatSettings.data?.rate ?? 0) > 0;
  const setPrimary = useSetPrimaryAccount();
  const closeAcc = useSoftCloseAccount();
  const reopenAcc = useReopenAccount();
  const deleteAcc = useDeleteAccount();

  const [transferOpen, setTransferOpen] = useState(false);
  const [transferAmount, setTransferAmount] = useState<number | null>(null);
  // Сетки значка и цвета раскрываются под своей строкой (аккордеон, как цвет
  // команды в её настройках) — лист поверх страницы здесь был бы вторым
  // жанром для того же действия.
  const [iconOpen, setIconOpen] = useState(false);
  const [colorOpen, setColorOpen] = useState(false);
  // Лист «Отдать команде» для счёта-наследия без команды.
  const [handOverOpen, setHandOverOpen] = useState(false);

  // ВЕТВЛЕНИЕ ПО «ДАННЫХ НЕТ», А НЕ ПО isPending (§8): без сети запрос стоит
  // в paused и остаётся pending навсегда — экран крутил бы спиннер вечно.
  if (accountsQuery.data === undefined) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Настройки счёта" />
        {accountsQuery.error ? (
          <EmptyState
            state="error"
            fill
            title="Не удалось загрузить счёт"
            subtitle={accountsQuery.error.message}
            action={{
              label: "Повторить",
              onPress: () => void accountsQuery.refetch(),
            }}
          />
        ) : online ? (
          <EmptyState state="loading" fill title="Загружаем счёт" />
        ) : (
          <EmptyState
            fill
            title="Нет сети"
            subtitle="Счёт ещё не загружен на это устройство"
            action={{
              label: "Повторить",
              onPress: () => void accountsQuery.refetch(),
            }}
          />
        )}
      </Screen>
    );
  }
  if (!account) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Настройки счёта" />
        <EmptyState
          fill
          title={ACCOUNT_GONE_SETTINGS.title}
          subtitle={ACCOUNT_GONE_SETTINGS.message}
          action={{ label: "К списку счетов", onPress: () => router.replace("/accounts") }}
        />
      </Screen>
    );
  }

  // ПРИЧИНА ОТКАЗА ОБЯЗАНА БЫТЬ ЧИТАЕМОЙ. Мутации счёта помечены NEVER_PAUSE и
  // офлайн падают сразу — сырое «Network request failed» не отвечает на
  // единственный вопрос: сохранилось или нет.
  const alertError = (title: string) => (e: unknown) =>
    notify(
      title,
      isOnline() ? (e as Error).message : OFFLINE_ACCOUNT_EDIT,
    );
  // Ответ на «можно ли ещё править счёт» приезжает ВМЕСТЕ со счётом
  // (`account_balances.has_history`) и зеркалит серверный
  // `guard_account_financial_history`: экран глушит правку вида, старта и
  // команды заранее, а не отказом после сохранения. Отдельный запрос за тем же
  // фактом здесь был третьим сетевым походом на один экран.
  const hasHistory = account.has_history;
  const kindLabel = KINDS.find((k) => k.value === account.kind)?.label ?? "";
  // ДВЕ РАЗНЫЕ ПРИЧИНЫ ЗАМОРОЗИТЬ ОСТАТОК НА НАЧАЛО, и обе кончаются одним:
  // поле показывается, но не правится. У счёта С ОПЕРАЦИЯМИ правка ломает
  // сходимость истории; у ЗАКРЫТОГО счёта заданный после закрытия остаток не
  // попадает ни в «Всего денег», ни в один подытог — деньги были бы в базе и
  // нигде на экране (§9.7). Тот же запрет стоит на сервере, в
  // `guard_account_financial_history`.
  const openingFrozen = hasHistory || !account.is_active;
  // ВИД СЧЁТА ЗАМОРОЖЕН У СЧЁТА С ОПЕРАЦИЯМИ, и причина не косметическая:
  // `kind` — это определение «наличных компании» на весь продукт. По нему
  // сервер подбирает счёт под способ оплаты заявки
  // (`resolve_appointment_finance_account`), считает наличные при закрытии дня
  // и пускает пересчёт кассы. Переключив кассу в «Карту», человек задним
  // числом переписал бы уже закрытые дни — поэтому смену запрещает и сервер
  // (`guard_account_financial_history`), а экран до 2026-08-15 молча отправлял
  // её и получал отказ.
  const pickKind = async () => {
    const picked = await chooseValue(
      "Вид счёта",
      KINDS.map((k) => ({ value: k.value as AccountKind, label: k.label })),
    );
    if (!picked?.value) return;
    update.mutate(
      { id: account.id, patch: { kind: picked.value } },
      { onError: alertError("Не удалось изменить вид счёта") },
    );
  };

  const pickTeam = async () => {
    const picked = await chooseValue(
      "Команда счёта",
      teams.map((team) => ({ value: team.id, label: team.name })),
    );
    if (!picked?.value) return;
    update.mutate(
      { id: account.id, patch: { brigade_id: picked.value } },
      { onError: alertError("Не удалось сменить команду счёта") },
    );
  };

  // ОСИРОТЕВШИЙ СЧЁТ ОТДАЮТ БРИГАДЕ ЦЕЛИКОМ: «Без команды» — не команда, а
  // наследие снесённой схемы общего счёта, поэтому патчится и `scope`, и
  // `brigade_id` одной мутацией. Сервер (`guard_account_financial_history`)
  // может отказать, пока страж не ослаблен для переноса NULL → команда, —
  // тогда его причина печатается алертом как есть.
  const handOver = (teamId: string) =>
    update.mutate(
      { id: account.id, patch: { scope: "team", brigade_id: teamId } },
      { onError: alertError("Не удалось отдать счёт команде") },
    );

  // Куда можно сдать остаток перед закрытием. Считается ДО тапа — предусловие
  // закрытия обязано быть видно на экране, а не выясняться алертом.
  //
  // Команда получателя роли НЕ играет (владелец 2026-08-15): запрет «между
  // командами только через общий счёт» ушёл вместе с общим счётом, и
  // `transferPairError` знает ровно два отказа — счёт сам с собой и закрытый.
  // Здесь этот запрет пережил снос и запирал последний счёт распущенной
  // команды: перевод свайпом со списка проходил, а из настроек объявлялся
  // невозможным.
  const hasTransferTarget = activeAccounts.some((b) => b.id !== account.id);
  const hasBalance = moneySign(account.balance) !== 0;

  const closeOrDelete = () => {
    if (!hasHistory) {
      const text = deleteAccountAlert(account.name, account.balance);
      confirmThen(
        text.title,
        {
          message: text.message,
          confirmLabel: text.confirm,
          destructive: true,
        },
        () =>
          deleteAcc.mutate(account.id, {
            // dismissTo схлопывает стек до списка: replace оставлял бы
            // деталь удалённого счёта в истории («назад» → «не найден»).
            onSuccess: () => router.dismissTo("/accounts"),
            onError: alertError("Не удалось удалить счёт"),
          }),
      );
      return;
    }
    if (hasBalance) {
      const canTransfer = account.balance > 0 && hasTransferTarget;
      const text = accountNotEmptyAlert(account.name, account.balance, canTransfer);
      if (!canTransfer || !text.confirm) {
        // Увести остаток некуда (минус или единственный счёт) — тогда это не
        // вопрос, а объяснение, почему счёт не закрывается. У такого текста
        // и подписи кнопки нет: `confirm` заполняется только вместе с ней.
        notify(text.title, text.message);
        return;
      }
      confirmThen(
        text.title,
        { message: text.message, confirmLabel: text.confirm },
        () => {
          setTransferAmount(account.balance);
          setTransferOpen(true);
        },
      );
      return;
    }
    const text = closeAccountAlert(account.name);
    confirmThen(
      text.title,
      {
        message: text.message,
        confirmLabel: text.confirm,
        destructive: true,
      },
      () =>
        closeAcc.mutate(account.id, {
          onSuccess: () => router.back(),
          onError: alertError("Не удалось закрыть счёт"),
        }),
    );
  };

  // ─── НДС ─────────────────────────────────────────────────────────────────

  // Умолчание печатается С ЭФФЕКТИВНЫМ ЗНАЧЕНИЕМ: «Как в настройках» само по
  // себе не говорит ни какие настройки, ни что там сейчас стоит.
  const inheritedVat = effectiveVatSettings(
    vatSettings.data,
    account.scope === "team" && account.brigade_id
      ? (teamVatOverrides.data ?? []).find(
          (o) => o.teamId === account.brigade_id,
        )
      : undefined,
    null,
  );
  const inheritLabel = `${VAT_INHERIT} (${accountVatLabel(inheritedVat.mode)})`;
  const vatOptions = [...ACCOUNT_VAT_KEYS, inheritLabel];
  const vatValue =
    account.vat_mode === null ? inheritLabel : accountVatLabel(account.vat_mode);

  // ─── Основной счёт ───────────────────────────────────────────────────────

  // Основной счёт уникален внутри (тенант, команда); у счетов нескольких
  // команд brigade_id равен NULL, и они образуют свою группу — сравнение по
  // одному полю покрывает оба случая.
  const currentPrimary = accounts.find(
    (a) =>
      a.is_primary && a.id !== account.id && a.brigade_id === account.brigade_id,
  );
  const primaryLabel = "Основной счёт команды";
  // Подпись обязана сказать ДВЕ вещи: куда падают деньги и что порядок строк
  // на экране к этому отношения не имеет. Иначе владелец, поднявший «Карту
  // Ани» повыше просто для удобства чтения, молча переадресует оплаты.
  const primaryHint = account.is_primary
    ? "Сюда по умолчанию попадают деньги, если счёт не выбран вручную. Порядок строк на экране этого не меняет."
    : currentPrimary
      ? `Куда по умолчанию попадают деньги. Сейчас это «${currentPrimary.name}».`
      : "Куда по умолчанию попадают деньги, если счёт не выбран вручную. Порядок строк на экране этого не меняет.";

  // ─── Приём денег по заявкам ──────────────────────────────────────────────

  // ПОДПИСЬ ГОВОРИТ ПОСЛЕДСТВИЕ, А НЕ МЕХАНИКУ. Выключенный счёт никуда не
  // девается: он остаётся в списке, в переводах и в отчётах — он только
  // перестаёт принимать деньги заявок. Так тумблер не читается как «закрыть».
  const paymentsHint = account.show_in_payments
    ? "Бригадир видит счёт при оплате заявки и может зачислить деньги сюда."
    : "Счёт остаётся в списке и в переводах, но деньги заявок на него больше не принимаются.";

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Настройки счёта" subtitle={account.name} />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <RowGroup title="Основное">
          <FieldRow
            label="Название"
            value={account.name}
            placeholder="Название счёта"
            onSave={(next: string) => {
              const name = next.trim();
              if (!name || name === account.name) return;
              update.mutate(
                { id: account.id, patch: { name } },
                { onError: alertError("Не удалось переименовать счёт") },
              );
            }}
          />
          {/* Вид ЗАМОРОЖЕН у счёта с операциями — тем же движением, что
              «Остаток на начало» и «Команда»: `NavRow` без обработчика теряет
              шеврон, нажатие и роль кнопки, то есть становится фактом. */}
          <NavRow
            label="Вид"
            value={kindLabel}
            separated
            onPress={hasHistory ? undefined : pickKind}
          />
          {/* ЗНАЧОК И ЦВЕТ — узнавание счёта в списке. Сетка и палитра те же,
              что в листе создания; правятся всегда: сходимость истории от
              них не зависит, и заморозка `hasHistory` им не нужна. Повторный
              тап по выбранному снимает выбор — счёт возвращается к глифу
              вида, как в листе создания. */}
          {/* СПРАВА СТОИТ САМ ОТВЕТ, А НЕ ЕГО ИМЯ (владелец 2026-08-17): глиф и
              точка цвета показывают себя, «Копилка» и «Голубой» словами были
              шумом. Пусто = ничего не нарисовано: счёт рисуется глифом вида. */}
          <NavRow
            label="Значок"
            accessory={<IconGlyph value={account.icon} color={account.color} />}
            separated
            onPress={() => setIconOpen((open) => !open)}
          />
          {iconOpen ? (
            <View style={{ paddingHorizontal: 16, paddingBottom: 4 }}>
              <IconPicker
                label={null}
                value={account.icon}
                tint={account.color}
                onChange={(slug) =>
                  update.mutate(
                    {
                      id: account.id,
                      patch: { icon: account.icon === slug ? null : slug },
                    },
                    { onError: alertError("Не удалось изменить значок") },
                  )
                }
              />
            </View>
          ) : null}
          <NavRow
            label="Цвет"
            accessory={<ColorDot value={account.color} />}
            separated
            onPress={() => setColorOpen((open) => !open)}
          />
          {colorOpen ? (
            <View style={{ paddingHorizontal: 16, paddingBottom: 4 }}>
              <ColorPicker
                label={null}
                value={account.color}
                onChange={(hex) =>
                  update.mutate(
                    {
                      id: account.id,
                      patch: { color: account.color === hex ? null : hex },
                    },
                    { onError: alertError("Не удалось изменить цвет") },
                  )
                }
              />
            </View>
          ) : null}
          {/* ЧЕЙ ЭТО СЧЁТ — здесь, а не отдельной группой «Команды». Группа
              существовала ради общего счёта: в ней подключали и отключали
              команды чек-листом в нижнем листе. Счёт принадлежит ОДНОЙ команде
              (владелец 2026-08-15), и от группы осталась бы одна строка под
              множественным заголовком.
              Пустая команда — не «команду удалили», а счёт старой схемы: у
              него дверь «Отдать команде» ОТКРЫТА ВСЕГДА, даже с историей, —
              иначе деньги навечно оставались бы под чипом «Без команды». */}
          <NavRow
            label="Команда"
            value={
              account.brigade_id
                ? (teamById.get(account.brigade_id)?.name ?? "Команда удалена")
                : "Без команды"
            }
            separated
            onPress={
              account.brigade_id === null
                ? () => setHandOverOpen(true)
                : hasHistory
                  ? undefined
                  : pickTeam
            }
          />
          {openingFrozen ? (
            // ЗАМОРОЖЕННОЕ ПОЛЕ — ФАКТ, А НЕ ДВЕРЬ. `NavRow` без `onPress`
            // теряет шеврон, нажатие и роль кнопки; прозрачности здесь тоже
            // нет — она уводила текст ниже AA и не сообщала причину. Причина
            // живёт одной подписью под группой.
            <NavRow
              label="Остаток на начало"
              value={money(account.opening_balance)}
              separated
            />
          ) : (
            <FieldRow
              label="Остаток на начало"
              value={formatMoneyForInput(account.opening_balance)}
              placeholder="0"
              separated
              tabular
              keyboardType="numbers-and-punctuation"
              onSave={(next: string) => {
                if (!next.trim()) return; // очистили поле — не значит «ноль»
                const cents = parseMoneyInputToCents(next, {
                  allowNegative: true,
                  allowZero: true,
                });
                if (cents == null) {
                  notify(
                    "Проверьте сумму",
                    "Остаток на начало — число, максимум два знака после "
                    + "запятой. Например: 1250,50",
                  );
                  return;
                }
                const num = cents / 100;
                if (num === account.opening_balance) return;
                update.mutate(
                  { id: account.id, patch: { opening_balance: num } },
                  { onError: alertError("Не удалось изменить остаток") },
                );
              }}
            />
          )}
          {/* Куда по умолчанию падают деньги. Развязано с порядком строк:
              поднять «Карту Ани» повыше для удобства чтения и переадресовать
              все карточные оплаты команды — разные решения. */}
          <Divider inset={16} />
          <SwitchRow
            label={primaryLabel}
            hint={primaryHint}
            value={account.is_primary}
            disabled={!account.is_active || setPrimary.isPending}
            onChange={(next) =>
              setPrimary.mutate(
                { account, primary: next },
                { onError: alertError("Не удалось сменить основной счёт") },
              )
            }
          />
          {/* ПРИНИМАЕТ ЛИ ЭТОТ СЧЁТ ДЕНЬГИ ЗАЯВОК. Владелец 2026-08-11: «если
              тумблер включён, бригадир при выполнении заявки может нажать
              "зачислено на этот счёт", и оно автоматически зачисляет». Это
              решает не вид счёта, а сам счёт: накопительный или резервный
              лежит рядом с рабочей кассой, и одного промаха пальцем хватает,
              чтобы выручка ушла туда, откуда её достанут через месяц.
              Обе серверные двери — пикер бригадира и автоподбор — уважают эту
              колонку, поэтому тумблер не декорация. */}
          <Divider inset={16} />
          <SwitchRow
            label="Показывать при оплате заявок"
            hint={paymentsHint}
            value={account.show_in_payments}
            disabled={!account.is_active || update.isPending}
            onChange={(next) =>
              update.mutate(
                { id: account.id, patch: { show_in_payments: next } },
                { onError: alertError("Не удалось изменить приём оплаты") },
              )
            }
          />
        </RowGroup>
        {hasHistory ? (
          // У счёта-наследия «Без команды» общий текст врал бы про
          // единственную живую дверь: команду ему назначить КАК РАЗ можно.
          <RowCaption
            text={
              account.brigade_id === null
                ? ORPHAN_FROZEN_FIELDS_CAPTION
                : FROZEN_FIELDS_CAPTION
            }
          />
        ) : openingFrozen ? (
          <RowCaption text={CLOSED_ACCOUNT_OPENING_FROZEN} />
        ) : null}

        {/* НДС СЧЁТА. Владелец 2026-08-09: «есть счёт с НДС — понятное дело,
            что это счёт плюс НДС; можно устанавливать либо на самом счёте,
            либо в настройках финансов». На расчётный приходят деньги с
            налогом, в кассу от частника — без, и обе кассы у одной команды.
            Показываем только тем, кто с налогом работает. */}
        {vatOn ? (
          <>
            <RowGroup title="НДС">
              {/* Ярлыка у строки нет: в группе она одна, и её уже назвал
                  капс-заголовок группы — два капса на 20pt друг от друга
                  делали раздел вложенным сам в себя. */}
              <ChoiceRow
                options={vatOptions}
                value={vatValue}
                onSelect={(label: string) =>
                  update.mutate(
                    {
                      id: account.id,
                      patch: {
                        vat_mode:
                          label === inheritLabel
                            ? null
                            : accountVatValue(label),
                      },
                    },
                    { onError: alertError("Не удалось изменить НДС счёта") },
                  )
                }
              />
            </RowGroup>
            <RowCaption text="Значение подставляется в новую операцию по этому счёту. В самой операции его всегда можно переключить." />
          </>
        ) : (
          // ГРУППА НДС НЕ ИСЧЕЗАЕТ НИКОГДА (§6). Раньше при выключенном налоге
          // её здесь не было вовсе — и человек, которому налог понадобился,
          // искал его вслепую по кабинету: одиннадцать действий, ни одно из
          // которых продукт не подсказывал. Одна строка-дверь отвечает и
          // «почему тут пусто», и «где это включается».
          <RowGroup title="НДС">
            <NavRow
              label="НДС"
              value="Компания не работает с НДС"
              onPress={() => router.push("/finances/vat")}
            />
          </RowGroup>
        )}

        {/* ЗАКРЫТИЕ И УДАЛЕНИЕ — РАЗНЫЕ ПОСЛЕДСТВИЯ, значит разные подписи.
            Одно место и один красный цвет несли и обратимое закрытие, и
            безвозвратное удаление; предусловие «остаток должен быть нулём»
            человек узнавал, только нарвавшись. */}
        <RowGroup title={account.is_active ? "Закрытие счёта" : undefined}>
          {account.is_active ? (
            <ActionRow
              label={hasHistory ? "Закрыть счёт" : "Удалить счёт"}
              tone="danger"
              onPress={closeOrDelete}
            />
          ) : (
            <ActionRow
              label="Открыть счёт снова"
              onPress={() =>
                reopenAcc.mutate(account.id, {
                  onError: alertError("Не удалось открыть счёт"),
                })
              }
            />
          )}
        </RowGroup>
        {account.is_active ? (
          <RowCaption
            tone={hasBalance ? "warning" : "quiet"}
            text={
              hasBalance
                ? `Сейчас на счёте ${money(account.balance)} — сначала `
                  + "переведите остаток на другой счёт или спишите операцией."
                : hasHistory
                  ? "Счёт исчезнет из списков и форм оплаты. История, отчёты и "
                    + "документы сохранятся — открыть снова можно в «Закрытых "
                    + "счетах»."
                  : "Операций по счёту не было, поэтому он удаляется насовсем. "
                    + "Восстановить будет нельзя."
            }
          />
        ) : null}
      </ScrollView>

      <TransferSheet
        visible={transferOpen}
        onClose={() => setTransferOpen(false)}
        accounts={activeAccounts}
        teamById={teamById}
        presetFromId={account.id}
        presetAmount={transferAmount}
      />

      {/* «Отдать команде» — канонический лист выбора: строка = цветной значок
          команды + имя, тап выбирает и закрывает. */}
      <PickerSheet
        visible={handOverOpen}
        title="Отдать команде"
        items={teams.map((team) => ({
          id: team.id,
          label: team.name,
          icon: Users,
          color: team.color ?? t.accent,
          onPress: () => handOver(team.id),
        }))}
        onClose={() => setHandOverOpen(false)}
      />
    </Screen>
  );
}

export default function AccountSettingsScreen() {
  return <AccountSettingsContent />;
}

import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { ArrowDown, ChevronDown, ChevronLeft } from "lucide-react-native";
import {
  formatMoneyForInput,
  money,
  moneySign,
  parseMoneyInputToCents,
} from "@babun/shared/common/utils/money";
import { isOnline, randomUuid, useIsOnline } from "@babun/shared/sync";
import { transferValidationError } from "@babun/shared/local/finance/integrity";
import { todayYmd } from "@/features/invoices/format";
import { formatYMD, parseYMD } from "@/features/appointments/helpers";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Chip } from "@/components/ui/Chip";
import { EmptyState } from "@/components/ui/EmptyState";
import { GradientButton } from "@/components/ui/GradientButton";
import { ValueOptionList } from "@/components/ui/ValuePickerSheet";
import { FieldRow, NavRow, RowGroupBody } from "@/components/ui/card-rows";
import { useThemeColors } from "@/theme/colors";
import { useCalendarSettings } from "@/features/settings/local-settings";
import { useTenant } from "@/features/settings/tenant";
import { haptics } from "@/lib/haptics";
import type { Team } from "@/features/reference/queries";
import type { AccountWithBalance } from "./accounts";
import { accountDaysOnHand } from "./accounts-sections";
import { dayPhrase } from "./period";
import {
  accountOwnerLabel,
  defaultTransferTarget,
  transferGroups,
} from "./transfer-options";
import { createTransferRequestIds } from "./transfer-intent";
import {
  loadLastTransferTarget,
  rememberTransferTarget,
} from "./transfer-memory";
import { useTransferWithUndo } from "./transfer-undo";

// ЛИСТ ПЕРЕВОДА (ТЗ 2026-08-10 §5.2–5.4).
//
// Было: полный список счетов, напечатанный ДВАЖДЫ чипами — 2N пилюль без
// остатков и в порядке прихода из базы. У живого тенанта это 14 одинаковых
// «Наличные», среди которых нужно вслепую найти свою.
//
// Стало: две СТРОКИ-значения, каждая открывает выбор ВТОРЫМ ШАГОМ ТОГО ЖЕ
// листа. Второй лист поверх первого невозможен: `BottomSheet` — это RN Modal,
// и окно поверх него требует сперва закрыть нижнее, то есть потерять набранное.
//
// Три вещи, ради которых лист переписан:
//   • сумма предзаполнена ВСЕМ остатком и выделена — «сдать всё» это ноль
//     набора, а частичная сумма набирается поверх;
//   • причина погашенной кнопки печатается ВСЕГДА, а не после первого символа;
//   • подтверждения перед переводом НЕТ — есть «Отменить» после (§5.2).
//
// ФОРМА ПЕРЕПИСАНА ПОД REVOLUT 2026-08-15 (владелец показал их «Перевести
// деньги»): две карточки одна над другой, у каждой имя счёта и его остаток, а
// сумма стоит СПРАВА В САМОЙ КАРТОЧКЕ — со знаком. Набираешь в верхней, нижняя
// повторяет ту же цифру плюсом: видно обе стороны сделки, не читая подписей.
// Круглая кнопка разворота — на шве между ними.
//
// ДАТА ТЕПЕРЬ ВЫБИРАЕТСЯ (владелец: «сверху ещё можно самому выставлять дату»)
// и стоит первой строкой. Она — ТРЕТИЙ ШАГ ТОГО ЖЕ ЛИСТА, а не отдельный
// пикер-модал: `BottomSheet` — это RN Modal, и окно поверх него требует сперва
// закрыть нижнее, то есть потерять набранное (та же причина, по которой выбор
// счёта живёт шагом).
//
// Задний день может упереться в серверный `guard_closed_day_finance_write` —
// тогда отказ печатается над кнопкой обычным текстом, как любой другой.
//
// Быстрых сумм «10 / 20 / 50 / 100» здесь нет: у команды перевод — это чаще
// всего вся касса целиком, а не двадцатка. Ту же роль играет чип «Весь остаток».
//
// «СДАЧИ ВЫРУЧКИ» отдельным словом больше нет (владелец 2026-08-15): она
// означала «касса команды → счёт компании», а общего счёта в продукте не
// осталось. Одно событие — одно слово: перевод.

/** Финансы онлайн-only НА ЗАПИСЬ (ТЗ §8): без сети кнопка гасится и говорит
 *  почему. Крутящаяся кнопка на этом месте страшнее ошибки — человек не знает,
 *  ушли деньги или нет. */
const OFFLINE_REASON =
  "Без сети перевод не проводится. "
  + "Передайте деньги и оформите, когда появится связь.";

/** Связь пропала МЕЖДУ нажатием и ответом. Повтор безопасен: `request_id`
 *  привязан к намерению, и сервер отдаст тот же перевод, а не второй. */
const OFFLINE_MID_FLIGHT =
  "Связь пропала. Нажмите ещё раз, когда появится сеть — перевод не задвоится.";

type Step = "form" | "from" | "to" | "date";

export function TransferSheet({
  visible,
  onClose,
  accounts,
  teamById,
  presetFromId,
  presetAmount,
}: {
  visible: boolean;
  onClose: () => void;
  /** Активные счета с балансами (owner-only данные). Фильтр экрана на перевод
   *  не распространяется: деньги ходят между всеми счетами тенанта. */
  accounts: AccountWithBalance[];
  teamById: Map<string, Team>;
  /** Источник, с которого пришли (свайп по строке, карточка счёта). */
  presetFromId?: string | null;
  /** Сумма из вызывающего сценария («Сдать остаток» при закрытии счёта).
   *  Без неё подставляется весь остаток источника. */
  presetAmount?: number | null;
}) {
  const t = useThemeColors();
  const online = useIsOnline();
  const runTransfer = useTransferWithUndo();
  const tenantQuery = useTenant();
  const currency = tenantQuery.data?.currency;
  const calendarSettings = useCalendarSettings();
  const businessToday = todayYmd(calendarSettings.data?.timezone ?? "Europe/Nicosia");

  const [step, setStep] = useState<Step>("form");
  const [fromId, setFromId] = useState<string | null>(null);
  const [toId, setToId] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  /** День перевода. Стартует бизнес-сегодня; вперёд не уходит — деньги нельзя
   *  передать завтра (`rejectFutureLedgerDate` откажет ещё до сети). */
  const [occurredOn, setOccurredOn] = useState(businessToday);
  /** Крутится в барабане, пока шаг открыт. Отдельно от `occurredOn`, чтобы уход
   *  «Назад» не менял дату перевода — как и в любом другом выборе листа. */
  const [dateDraft, setDateDraft] = useState(businessToday);
  /** Пришли со строки счёта — источником ошибиться физически невозможно.
   *  Снимается «Поменять местами»: после разворота источник уже другой. */
  const [sourceLocked, setSourceLocked] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const byId = useMemo(
    () => new Map(accounts.map((a) => [a.id, a])),
    [accounts],
  );
  const from = fromId ? (byId.get(fromId) ?? null) : null;
  const to = toId ? (byId.get(toId) ?? null) : null;

  // Каждое ОТКРЫТИЕ листа начинает заново, но только по фронту: фоновый
  // рефетч счетов при открытом листе не должен стирать набранное.
  const wasVisible = useRef(false);
  useEffect(() => {
    if (!visible) {
      wasVisible.current = false;
      return;
    }
    if (wasVisible.current) return;
    wasVisible.current = true;
    const source = presetFromId ? (accounts.find((a) => a.id === presetFromId) ?? null) : null;
    const target = source
      ? defaultTransferTarget({
          accounts,
          from: source,
          remembered: loadLastTransferTarget(source.id),
        })
      : null;
    const preset = presetAmount ?? source?.balance ?? 0;
    setStep("form");
    setFromId(source?.id ?? null);
    setSourceLocked(!!source);
    setToId(target?.id ?? null);
    setAmount(moneySign(preset) > 0 ? formatMoneyForInput(preset) : "");
    setNote("");
    setOccurredOn(businessToday);
    setFailure(null);
  }, [visible, presetFromId, presetAmount, accounts, businessToday]);

  const teamName = useMemo(
    () => (id: string | null) => (id ? (teamById.get(id)?.name ?? null) : null),
    [teamById],
  );
  // ОДНО ПРАВИЛО ИМЕНИ на весь лист: в карточках счёт называется полностью,
  // «Наличка · Команда 2». Условной дописки команды больше нет — в СПИСКЕ её
  // говорит заголовок группы, и там строка остаётся голым именем.
  const label = useMemo(
    () => (account: AccountWithBalance) => accountOwnerLabel(account, teamName),
    [teamName],
  );
  // Порядок списка по-прежнему считается от команды ИСТОЧНИКА: её счета идут
  // первыми — в них сдают и из них переводят чаще всего.
  const ownTeamId = from?.brigade_id ?? null;
  const amountCents = parseMoneyInputToCents(amount);
  const amountNum = (amountCents ?? 0) / 100;

  const groups = useMemo(
    () =>
      transferGroups({
        accounts,
        // В шаге «Откуда» из списка убирается ПОЛУЧАТЕЛЬ, в шаге «Куда» —
        // источник: счёт сам себе стороной перевода не бывает. Так выбор
        // недопустимой пары просто невозможен, и объяснять постфактум нечего.
        from: step === "from" ? to : from,
        teams: [...teamById.values()],
        ownTeamId,
      }),
    [accounts, from, to, ownTeamId, step, teamById],
  );

  // НИЖНЯЯ ГРАНИЦА БАРАБАНА ДАТЫ: раньше первого движения денег переводить
  // нечего, а у тенанта совсем без истории — начало прошлого месяца. Без пола
  // случайная прокрутка колеса года молча уносила перевод в глубокое прошлое:
  // серверный guard стережёт только дни, закрытые сверкой.
  const dateFloor = useMemo(() => {
    const firstMovement = accounts
      .map((a) => a.first_tx_on)
      .filter((d): d is string => d !== null)
      .sort()[0];
    if (firstMovement && firstMovement <= businessToday) return firstMovement;
    const today = parseYMD(businessToday);
    return formatYMD(new Date(today.getFullYear(), today.getMonth() - 1, 1));
  }, [accounts, businessToday]);

  // ПРИЧИНА ПЕЧАТАЕТСЯ ВСЕГДА, а не после первого символа: серая кнопка без
  // объяснения читается как поломка продукта.
  const reason = !online
    ? OFFLINE_REASON
    : !from
      ? "Выберите, откуда"
      : !to
        ? "Выберите, куда"
        : transferValidationError(from, to, amountNum);
  const canSend = reason === null && !sending;

  /** `request_id` привязан к НАМЕРЕНИЮ, а не к открытию листа: та же пара,
   *  сумма, день и комментарий — тот же ключ и серверный дедуп после
   *  потерянного ответа; правка ЛЮБОГО из полей — уже другое намерение и
   *  другой ключ (почему в ключе даже день — см. transfer-intent.ts). */
  const intent = useRef(createTransferRequestIds(randomUuid)).current;

  // СБРОСА ПОЛУЧАТЕЛЯ БОЛЬШЕ НЕТ. Он был нужен, пока существовал запрет
  // «между командами только через общий счёт»: смена источника могла сделать
  // выбранного получателя недопустимым. Запрета нет (владелец 2026-08-15), а
  // единственную оставшуюся коллизию — выбрать источником текущего получателя
  // — список теперь не допускает вовсе.
  const pickFrom = (id: string | null) => {
    setFromId(id);
    // «Сдать всё — ноль набора» работает из ЛЮБОЙ двери: пока сумму не правили
    // руками (пусто либо ровно остаток прежнего источника), её заполняет весь
    // остаток нового — как при открытии со строки счёта. Набранную руками
    // цифру смена источника не трогает.
    const next = id ? (byId.get(id) ?? null) : null;
    const untouched =
      amountCents === null ||
      (from !== null && amountCents === Math.round(from.balance * 100));
    if (next && untouched) {
      setAmount(
        moneySign(next.balance) > 0 ? formatMoneyForInput(next.balance) : "",
      );
    }
    setStep("form");
    setFailure(null);
  };

  const pickTo = (id: string | null) => {
    setToId(id);
    setStep("form");
    setFailure(null);
  };

  const swap = () => {
    if (!from || !to) return;
    setFromId(to.id);
    setToId(from.id);
    // Источник больше не «тот, со строки которого пришли».
    setSourceLocked(false);
    setFailure(null);
  };

  const send = async () => {
    if (!from || !to || amountCents == null) return;
    // Сеть проверяется В МОМЕНТ нажатия, а не только реактивным `online`:
    // между последним кадром и тапом связь могла пропасть, и мутация ушла бы
    // в paused — кнопка крутилась бы вечно, а свёрнутое приложение унесло бы
    // намерение молча.
    if (!isOnline()) {
      setFailure(OFFLINE_REASON);
      return;
    }
    const requestId = intent.idFor({
      fromAccountId: from.id,
      toAccountId: to.id,
      amountCents,
      occurredOn,
      note,
    });
    setSending(true);
    setFailure(null);
    try {
      await runTransfer({
        requestId,
        fromAccountId: from.id,
        toAccountId: to.id,
        amount: amountNum,
        notes: note.trim() || null,
        // Сегодняшний день не передаём вовсе: сервер сам поставит бизнес-дату
        // тенанта, и она правильнее любой, вычисленной на телефоне.
        occurredOn: occurredOn === businessToday ? null : occurredOn,
        amountText: money(amountNum, currency),
        fromLabel: label(from),
        toLabel: label(to),
      });
      rememberTransferTarget(from.id, to.id);
      intent.done();
      // Деньги ушли — телефон отвечает тем же тактильным «готово», что и
      // отмена перевода, и пересчёт кассы: один продукт подтверждает успех
      // одинаково, чем бы человек ни занимался.
      haptics.success();
      onClose();
    } catch (e) {
      // Лист остаётся открытым — набранное не теряется, а повтор попадёт в
      // тот же серверный дедуп по неизменившемуся `request_id`.
      const message = e instanceof Error ? e.message : "";
      setFailure(
        // Обрыв связи говорит по-человечески: сырое «Network request failed»
        // не отвечает на единственный вопрос — ушли деньги или нет.
        isOnline()
          ? message || "Не удалось сохранить"
          : OFFLINE_MID_FLIGHT,
      );
    } finally {
      setSending(false);
    }
  };

  // «Перевод», а не «Перевод между счетами»: другого перевода в этом листе не
  // бывает, а глоссарий (§7) даёт одно слово на одну сущность. Сдача выручки —
  // отдельное событие для человека, и называется своим словом.
  const title =
    step === "from"
      ? "Откуда"
      : step === "to"
        ? "Куда"
        : step === "date"
          ? "Когда"
          : "Перевод";

  // ВЕТКИ «НЕТ ДОПУСТИМОЙ ПАРЫ» ЗДЕСЬ БОЛЬШЕ НЕТ. Она объясняла запрет
  // «между командами только через общий счёт» и предлагала завести общий счёт;
  // ни запрета, ни общего счёта в продукте не осталось (владелец 2026-08-15).
  // Единственная оставшаяся невозможность — меньше двух активных счетов, и её
  // словами называет пустое состояние шага выбора: двери в лист (иконка ⇄ на
  // экране счетов) не гаснут, и молчаливый пустой список читался бы как
  // поломка.

  // ─── Второй шаг: день перевода ───────────────────────────────────────────

  if (step === "date") {
    return (
      <BottomSheet
      padded={false}
        visible={visible}
        onClose={onClose}
        title={title}
        footer={
          <View style={{ paddingHorizontal: 20 }}>
            <GradientButton
              label="Выбрать день"
              onPress={() => {
                setOccurredOn(dateDraft);
                setStep("form");
                setFailure(null);
              }}
            />
          </View>
        }
      >
        <View style={{ paddingHorizontal: 12, paddingBottom: 12 }}>
          <StepBack onPress={() => setStep("form")} />
          <View style={{ alignItems: "center" }}>
            {/* ПИКЕР РОЖДАЕТСЯ СО ЗНАЧЕНИЕМ. Смонтированный до того, как дата
                известна, компактный DateTimePicker навсегда запоминает
                «1 янв. 1970» — здесь `dateDraft` уже посчитан, а сам шаг
                существует только когда его открыли. */}
            <DateTimePicker
              value={parseYMD(dateDraft)}
              minimumDate={parseYMD(dateFloor)}
              maximumDate={parseYMD(businessToday)}
              mode="date"
              display="spinner"
              locale="ru-RU"
              themeVariant="light"
              onChange={(_, date) => date && setDateDraft(formatYMD(date))}
            />
          </View>
          <Text
            maxFontSizeMultiplier={1.3}
            style={{
              marginHorizontal: 8,
              fontSize: 13,
              lineHeight: 18,
              color: t.faint,
            }}
          >
            Вперёд день не ставится: деньги нельзя передать завтра. Если день уже
            закрыт сверкой, сервер откажет — тогда проведите переводом на сегодня.
          </Text>
        </View>
      </BottomSheet>
    );
  }

  // ─── Второй шаг: выбор счёта ─────────────────────────────────────────────

  if (step === "from" || step === "to") {
    return (
      <BottomSheet
      padded={false}
        visible={visible}
        onClose={onClose}
        title={title}
        scroll
        maxHeightRatio={0.8}
      >
        <View style={{ paddingHorizontal: 12, paddingBottom: 28 }}>
          <StepBack onPress={() => setStep("form")} />
          {/* 0–1 счетов: выбирать нечего, и голый «Назад» без единого слова
              читался бы как поломка. Кнопки «завести счёт» тут нет нарочно:
              создание живёт листом на экране счетов, а второй лист поверх
              этого невозможен (BottomSheet — RN Modal). */}
          {groups.length === 0 ? (
            <EmptyState
              title={
                step === "from" ? "Переводить неоткуда" : "Переводить некуда"
              }
              subtitle={
                "Перевод ходит между двумя активными счетами. "
                + "Заведите ещё один на экране счетов — и список оживёт."
              }
            />
          ) : null}
          {/* СНАЧАЛА НАЗВАНИЕ КОМАНДЫ, ПОТОМ ЕЁ СЧЕТА (владелец 2026-08-15).
              Заголовок называет владельца один раз на группу, поэтому строка
              остаётся голым именем счёта: «Наличка», а не «Наличка · Команда 2».
              Гасить в списке больше нечего — любая пара счетов допустима. */}
          {groups.map((group) => (
            <View key={group.teamId ?? "orphans"} style={{ marginBottom: 12 }}>
              <Text
                maxFontSizeMultiplier={1.3}
                style={{
                  marginBottom: 6,
                  marginHorizontal: 4,
                  fontSize: 12,
                  fontWeight: "700",
                  letterSpacing: 0.6,
                  textTransform: "uppercase",
                  color: t.faint,
                }}
              >
                {group.title}
              </Text>
              <ValueOptionList
                options={group.accounts.map((account) => ({
                  id: account.id,
                  label: account.name,
                  value: money(account.balance, currency),
                }))}
                selectedId={step === "from" ? fromId : toId}
                // «Ничего не выбрано» здесь не значение, а тупик: повторный тап
                // по уже выбранному счёту не должен его снимать.
                clearable={false}
                onPick={step === "from" ? pickFrom : pickTo}
              />
            </View>
          ))}
        </View>
      </BottomSheet>
    );
  }

  // ─── Форма ───────────────────────────────────────────────────────────────

  // «На руках €640 · с 4 августа» — возраст остатка есть только у кассы, и
  // только если движения по ней вообще были. Подпись живёт ВНУТРИ карточки
  // источника, рядом с его именем.
  const onHandSince = from?.last_outflow_on ?? from?.first_tx_on ?? null;
  const onHandDays =
    from && onHandSince ? accountDaysOnHand(from, businessToday) : null;
  const sourceCaption = !from
    ? null
    : from.kind === "cash" && onHandSince && onHandDays !== null && onHandDays > 0
      ? `На руках ${money(from.balance, currency)} · с ${dayPhrase(onHandSince)}`
      : `На счёте ${money(from.balance, currency)}`;

  // «После перевода» показывает ОБЕ стороны: цифра, которую нельзя проверить
  // пальцем, доверия не создаёт.
  const afterLine =
    from && to && amountCents !== null && reason === null
      ? `После перевода: ${label(from)} ${money(
          from.balance - amountNum,
          currency,
        )} · ${label(to)} ${money(to.balance + amountNum, currency)}`
      : null;

  const remainder = from?.balance ?? 0;
  const showRemainderChip =
    moneySign(remainder) > 0 && amountCents !== Math.round(remainder * 100);

  return (
    <BottomSheet
      padded={false}
      visible={visible}
      onClose={onClose}
      title={title}
      scroll
      avoidKeyboard
      footer={
        <View style={{ paddingHorizontal: 20, gap: 8 }}>
          {(failure ?? reason) ? (
            <Text
              accessibilityLiveRegion="polite"
              maxFontSizeMultiplier={1.3}
              style={{
                fontSize: 13,
                lineHeight: 18,
                textAlign: "center",
                color: failure ? t.danger : t.sub,
              }}
            >
              {failure ?? reason}
            </Text>
          ) : null}
          {/* Получателя кнопка НЕ называет: он стоит в карточке «Куда» прямо
              над ней, а «на Наличка · Команда 2» ломала падеж и длинным именем
              выталкивала сумму из единственной строки кнопки. */}
          <GradientButton
            label={
              amountCents
                ? `Перевести ${money(amountNum, currency)}`
                : "Перевести"
            }
            onPress={send}
            disabled={!canSend}
            loading={sending}
          />
        </View>
      }
    >
      <View style={{ paddingBottom: 8 }}>
        {/* 1. КОГДА — первой строкой (владелец 2026-08-15). Обычно это
            «Сегодня», и тогда строка молчит о себе одним словом. */}
        <RowGroupBody>
          <NavRow
            label="Когда"
            value={
              occurredOn === businessToday
                ? `Сегодня, ${dayPhrase(businessToday)}`
                : dayPhrase(occurredOn)
            }
            onPress={() => {
              setDateDraft(occurredOn);
              setStep("date");
            }}
          />
        </RowGroupBody>

        {/* 2. ДВЕ КАРТОЧКИ, сумма справа в каждой. Набираешь в верхней — нижняя
            повторяет ту же цифру плюсом. Кнопка разворота на шве. */}
        <View style={{ marginTop: 12 }}>
          <PartyCard
            eyebrow="Откуда"
            name={from ? label(from) : null}
            caption={sourceCaption}
            // Пришли со строки счёта — источник это показание, а не выбор.
            onPick={sourceLocked ? undefined : () => setStep("from")}
            amount={
              <TextInput
                value={amount}
                onChangeText={(v) => {
                  setAmount(v);
                  setFailure(null);
                }}
                keyboardType="decimal-pad"
                keyboardAppearance="light"
                selectionColor={t.accent}
                placeholder="0"
                placeholderTextColor={t.placeholder}
                autoFocus
                // Предзаполненный остаток ВЫДЕЛЕН: первый же символ заменяет
                // его целиком — частичная сумма набирается поверх, без стирания.
                selectTextOnFocus
                accessibilityLabel="Сумма перевода"
                maxFontSizeMultiplier={1.2}
                // Без className: он вместе со `style`-функцией молча убивает
                // весь стиль, а textAlign NativeWind до TextInput не доносит.
                style={{
                  minWidth: 96,
                  fontSize: 28,
                  fontWeight: "700",
                  textAlign: "right",
                  color: amount ? t.ink : t.placeholder,
                  fontVariant: ["tabular-nums"],
                }}
              />
            }
            sign="−"
            currency={currency}
          />
          <PartyCard
            eyebrow="Куда"
            name={to ? label(to) : null}
            caption={to ? `На счёте ${money(to.balance, currency)}` : null}
            onPick={() => setStep("to")}
            // Зеркало: та же цифра, тот же размер, но плюсом и тише. Считать
                // её нечем — она равна набранной по определению.
            amount={
              <Text
                maxFontSizeMultiplier={1.2}
                style={{
                  fontSize: 28,
                  fontWeight: "700",
                  color: amountCents ? t.sub : t.placeholder,
                  fontVariant: ["tabular-nums"],
                }}
              >
                {amount || "0"}
              </Text>
            }
            sign="+"
            currency={currency}
          />
          {/* Кнопка разворота стоит НА ШВЕ между карточками — там, где её ищет
              палец, и туда же смотрит стрелка. */}
          <View
            pointerEvents="box-none"
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: 0,
              right: 0,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Pressable
              onPress={swap}
              disabled={!from || !to}
              accessibilityRole="button"
              accessibilityLabel="Поменять местами"
              hitSlop={10}
              style={({ pressed }) => ({
                width: 40,
                height: 40,
                borderRadius: 999,
                alignItems: "center",
                justifyContent: "center",
                // Кольцо цветом ЛИСТА, а не карточки: кнопка «прорезает» шов
                // между ними, иначе она просто лежит поверх стыка.
                borderWidth: 4,
                borderColor: t.surface,
                opacity: !from || !to ? 0.4 : 1,
                backgroundColor: pressed ? t.rowFillPressed : t.fill,
              })}
            >
              <ArrowDown color={t.accent} size={18} strokeWidth={2.4} />
            </Pressable>
          </View>
        </View>

        <View style={{ paddingHorizontal: 16, marginTop: 10, gap: 8 }}>
          {showRemainderChip ? (
            <View style={{ flexDirection: "row" }}>
              <Chip
                label={`Весь остаток ${money(remainder, currency)}`}
                variant="tint"
                onPress={() => setAmount(formatMoneyForInput(remainder))}
              />
            </View>
          ) : null}
          {afterLine ? (
            <Text
              maxFontSizeMultiplier={1.3}
              style={{
                fontSize: 13,
                lineHeight: 18,
                color: t.faint,
                fontVariant: ["tabular-nums"],
              }}
            >
              {afterLine}
            </Text>
          ) : null}
        </View>

        <View style={{ marginTop: 12 }}>
          <RowGroupBody>
            <FieldRow
              label="Комментарий"
              value={note}
              placeholder="Необязательно"
              stacked
              // На каждый символ: кнопка листа не снимает фокус с поля, и
              // коммит по blur до неё бы не дошёл — комментарий терялся бы.
              live
              onSave={setNote}
            />
          </RowGroupBody>
        </View>
      </View>
    </BottomSheet>
  );
}

/** Строка «Назад» второго шага — одна на выбор счёта и на выбор дня. */
function StepBack({ onPress }: { onPress: () => void }) {
  const t = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Назад"
      hitSlop={8}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 2,
        alignSelf: "flex-start",
        minHeight: 44,
        paddingRight: 12,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <ChevronLeft color={t.accent} size={20} strokeWidth={2.2} />
      <Text style={{ fontSize: 15, fontWeight: "600", color: t.accent }}>
        Назад
      </Text>
    </Pressable>
  );
}

/** Одна сторона перевода: слева счёт и его остаток, справа сумма со знаком.
 *  Обе карточки собраны ОДНИМ компонентом — иначе «откуда» и «куда» разъедутся
 *  по высоте и типографике на первой же правке. */
function PartyCard({
  eyebrow,
  name,
  caption,
  amount,
  sign,
  currency,
  onPick,
}: {
  eyebrow: string;
  /** null — счёт ещё не выбран: печатаем приглашение, а не пустоту. */
  name: string | null;
  caption: string | null;
  amount: React.ReactNode;
  sign: "−" | "+";
  currency: string | undefined;
  /** Без обработчика счёт становится показанием: ни шеврона, ни нажатия. */
  onPick?: () => void;
}) {
  const t = useThemeColors();
  return (
    <View
      style={{
        marginHorizontal: 12,
        marginBottom: 4,
        paddingHorizontal: 14,
        paddingVertical: 12,
        borderRadius: t.radius.card,
        borderCurve: "continuous",
        // Тело листа белое (`t.surface`), поэтому карточка берёт заливку полей:
        // на белом по белому карточек не видно вовсе.
        backgroundColor: t.fill,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
      }}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          maxFontSizeMultiplier={1.2}
          style={{
            fontSize: 11,
            fontWeight: "700",
            letterSpacing: 0.6,
            textTransform: "uppercase",
            color: t.faint,
          }}
        >
          {eyebrow}
        </Text>
        <Pressable
          onPress={onPick}
          disabled={!onPick}
          accessibilityRole={onPick ? "button" : undefined}
          accessibilityLabel={onPick ? `${eyebrow}: ${name ?? "выберите счёт"}` : undefined}
          hitSlop={6}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 2,
            marginTop: 2,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Text
            maxFontSizeMultiplier={1.2}
            numberOfLines={1}
            style={{
              flexShrink: 1,
              fontSize: 17,
              fontWeight: "600",
              color: name ? t.ink : t.placeholder,
            }}
          >
            {name ?? "Выберите счёт"}
          </Text>
          {onPick ? <ChevronDown color={t.sub} size={16} strokeWidth={2.4} /> : null}
        </Pressable>
        {caption ? (
          <Text
            maxFontSizeMultiplier={1.2}
            numberOfLines={1}
            style={{
              marginTop: 2,
              fontSize: 13,
              color: t.faint,
              fontVariant: ["tabular-nums"],
            }}
          >
            {caption}
          </Text>
        ) : null}
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
        {/* Знак и валюта — вокруг цифры, а не внутри поля: иначе они уезжали бы
            вместе с курсором при наборе. */}
        <Text
          maxFontSizeMultiplier={1.2}
          style={{ fontSize: 28, fontWeight: "700", color: t.faint }}
        >
          {sign}
        </Text>
        {amount}
        <Text
          maxFontSizeMultiplier={1.2}
          style={{ fontSize: 20, fontWeight: "600", color: t.faint }}
        >
          {currencySymbol(currency)}
        </Text>
      </View>
    </View>
  );
}

/** Символ валюты тенанта. Продукт живёт в евро, но пятёрка валют уже описана
 *  в `money()` — берём знак оттуда, а не зашиваем «€». */
function currencySymbol(currency: string | undefined): string {
  return money(0, currency).replace(/[\d\s.,]/g, "") || "€";
}

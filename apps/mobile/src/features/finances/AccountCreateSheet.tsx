import { useEffect, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { useRouter } from "expo-router";
import { parseMoneyInputToCents } from "@babun/shared/common/utils/money";
import { isOnline, useIsOnline } from "@babun/shared/sync";
import type { Account } from "@babun/shared/local/finance/account";
import { BottomSheet, SHEET_EXIT_MS } from "@/components/ui/BottomSheet";
import { Chip } from "@/components/ui/Chip";
import { Field, FieldLabel } from "@/components/ui/Field";
import { GradientButton } from "@/components/ui/GradientButton";
import { MoneyField } from "@/components/ui/MoneyField";
import { ColorField, IconField } from "@/components/ui/picker-fields";
import { GUTTER } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import { useTenant } from "@/features/settings/tenant";
import { haptics } from "@/lib/haptics";
import type { Team } from "@/features/reference/queries";
import { useInsertAccount } from "./accounts";
import { OFFLINE_ACCOUNT_CREATE } from "./account-alerts";

// СОЗДАНИЕ СЧЁТА.
//
// ПОРЯДОК ВОПРОСОВ ПЕРЕСОБРАН 2026-08-15 по образцу, который показал владелец:
// СНАЧАЛА СУММА — крупно, первой строкой. Раньше она стояла
// третьей и на телефоне уходила под клавиатуру: счёт заводят, чтобы записать
// уже лежащие деньги, и прятать их под сгибом неправильно.
//
// Дальше: название → значок и цвет → кто пользуется. Значок и цвет — чтобы
// узнавать счёт в списке пальцем, а не читать; наборы ОБЩИЕ НА ПРОДУКТ и живут
// в дизайн-системе (`IconPicker`/`ICON_PRESETS`, `ColorPicker`/`PRESET_COLORS`),
// а первая восьмёрка значков — про деньги, поэтому счёт видит своё сразу.
//
// ВАЛЮТЫ У СЧЁТА НЕТ (владелец 2026-08-15): «валюта выбирается один раз на
// общие настройки, в настройках финансов». Компания работает в одной валюте
// (`tenants.currency`), и она же подписывает сумму здесь.
//
// СЧЁТ ПРИНАДЛЕЖИТ ОДНОЙ БРИГАДЕ (владелец 2026-08-15: «общий счёт полностью
// убираем, счёт создаётся чётко на каждую команду»). Здесь стоял чек-лист на
// несколько команд, из которого росло понятие «счёт компании» и запрет
// перевода между командами. Не осталось ни того, ни другого. У тенанта с одной
// командой вопрос не задаётся вовсе.
//
// Вида счёта форма тоже не спрашивает (владелец 2026-08-11: «я самостоятельно
// называю»): новый счёт заводится наличными, а поменять вид можно строкой
// «Вид» в настройках самого счёта. Колонка `accounts.kind` в базе жива — по
// ней серверный `resolve_appointment_finance_account` подбирает счёт под
// способ оплаты.
//
// Правка существующего счёта живёт на странице его настроек.

/** Латиница → кириллица по звучанию: в проде у одной команды уже живёт
 *  «Kasa», а рядом заводят «Кассу». */
const TRANSLIT: Record<string, string> = {
  a: "а", b: "б", c: "к", d: "д", e: "е", f: "ф", g: "г", h: "х", i: "и",
  j: "й", k: "к", l: "л", m: "м", n: "н", o: "о", p: "п", q: "к", r: "р",
  s: "с", t: "т", u: "у", v: "в", w: "в", x: "кс", y: "у", z: "з",
};

/** Ключ сравнения имён. Регистр, раскладка и сдвоенные буквы («Kasa» ↔
 *  «Касса») не должны рождать два счёта, которые потом не различить ни в
 *  операции, ни в переводе. */
function nameKey(name: string): string {
  let out = "";
  for (const ch of name.trim().toLowerCase()) out += TRANSLIT[ch] ?? ch;
  return out.replace(/(.)\1+/g, "$1");
}

export function AccountCreateSheet({
  visible,
  onClose,
  teams,
  accounts,
  presetTeamId,
}: {
  visible: boolean;
  onClose: () => void;
  /** Активные команды — из них выбирается владелец счёта. */
  teams: Team[];
  /** Все счета тенанта, включая закрытые — только для проверки дубля имени. */
  accounts: readonly Account[];
  /** Кто отмечен при открытии — команда, выбранная на экране. У тенанта с
   *  одной командой отмечается она: выбирать не из чего, и спрашивать не о
   *  чем. */
  presetTeamId?: string | null;
}) {
  const t = useThemeColors();
  const router = useRouter();
  const online = useIsOnline();
  const insert = useInsertAccount();
  const currency = useTenant().data?.currency;

  const [name, setName] = useState("");
  /** Владелец счёта — ровно одна команда. */
  const [teamId, setTeamId] = useState<string | null>(null);
  const [opening, setOpening] = useState("");
  /** Значок и цвет — узнавание счёта в списке. Оба необязательны: молчащий
   *  счёт рисуется глифом своего вида и без пигмента. */
  const [icon, setIcon] = useState<string | null>(null);
  const [color, setColor] = useState<string | null>(null);
  /** Отказ сервера печатается ПОД кнопкой, а не алертом: набранное остаётся на
   *  экране, и повтор не начинается с чистой формы. */
  const [failure, setFailure] = useState<string | null>(null);

  // Каждое ОТКРЫТИЕ листа начинает с чистой формы. Только по фронту открытия:
  // фоновый рефетч команд при открытом листе не должен стирать набранное.
  const wasVisible = useRef(false);
  useEffect(() => {
    if (!visible) {
      wasVisible.current = false;
      return;
    }
    if (wasVisible.current) return;
    wasVisible.current = true;
    // Пресет перепроверяется по живому справочнику: команду могли
    // заархивировать с другого экрана, пока экран стоял на ней.
    const preset =
      presetTeamId && teams.some((x) => x.id === presetTeamId)
        ? presetTeamId
        : null;
    setName("");
    setTeamId(preset ?? (teams.length === 1 ? teams[0].id : null));
    setOpening("");
    setIcon(null);
    setColor(null);
    setFailure(null);
  }, [visible, presetTeamId, teams]);

  const openingCents = opening.trim()
    ? parseMoneyInputToCents(opening, { allowNegative: true, allowZero: true })
    : 0;

  const ownerName = teams.find((x) => x.id === teamId)?.name ?? null;

  // Дубль имени у ОДНОГО владельца: две «Кассы» у одной команды неразличимы
  // и в списке операций, и в переводе — деньги оседают не на том счёте.
  // Границы совпадают с уникальными индексами базы (`ux_accounts_team_name`,
  // `ux_accounts_company_name`).
  const duplicate = useMemo(() => {
    const key = nameKey(name);
    if (!key) return null;
    return (
      accounts.find(
        (a) => nameKey(a.name) === key && a.brigade_id === teamId,
      ) ?? null
    );
  }, [accounts, name, teamId]);
  const duplicateOwner = ownerName ? `У команды «${ownerName}»` : "У вас";
  const duplicateNote = !duplicate
    ? null
    : duplicate.is_active
      ? `${duplicateOwner} уже есть счёт «${duplicate.name}». Два счёта с одним названием потом не различить — дайте новому другое имя.`
      : `Счёт «${duplicate.name}» с таким названием закрыт, но имя осталось за ним. Откройте его снова или назовите новый иначе.`;

  // Над погашенной кнопкой всегда стоит причина: молчащая серая кнопка
  // читается как поломка продукта. Офлайн — первой: остальные придирки к форме
  // бессмысленны, пока записать её всё равно некуда.
  const reason = !online
    ? OFFLINE_ACCOUNT_CREATE
    : // БРИГАДА ОБЯЗАТЕЛЬНА ВСЕГДА: `submit` шлёт `scope: "team"`, а клиентский
      // `assertScopeConsistency` отвергает такой счёт без `brigade_id` ещё до
      // сети. Тенант без единой команды до формы не доходит вовсе — см.
      // ветку пустого состояния перед основным `return`.
      !teamId
      ? "Выберите, чей это счёт"
      : !name.trim()
        ? "Дайте счёту название"
        : openingCents == null
          ? "Проверьте сумму на счёте"
          : null;
  const canSave = reason == null && !insert.isPending;
  /** Строка над кнопкой: отказ сервера сильнее придирки к форме, а на время
   *  отправки замолкают обе — там уже говорит вертушка самой кнопки. */
  const footerNote = failure ?? (insert.isPending ? null : reason);

  const submit = async () => {
    if (openingCents == null) return;
    // Сеть проверяется В МОМЕНТ нажатия, а не только реактивным `online`:
    // между последним кадром и тапом связь могла пропасть.
    if (!isOnline()) {
      setFailure(OFFLINE_ACCOUNT_CREATE);
      return;
    }
    setFailure(null);
    try {
      await insert.mutateAsync({
        // ОХВАТ ВСЕГДА «team»: другого в продукте не бывает.
        scope: "team",
        brigade_id: teamId,
        name: name.trim(),
        // Вид новому счёту не выбирают (см. шапку файла): заводим наличными,
        // а поменять можно строкой «Вид» в настройках счёта.
        kind: "cash",
        opening_balance: openingCents / 100,
        icon,
        color,
      });
      haptics.success();
      onClose();
    } catch (e) {
      // Лист остаётся открытым — набранное не теряется.
      const message = e instanceof Error ? e.message : "";
      setFailure(
        isOnline() ? message || "Не удалось создать счёт" : OFFLINE_ACCOUNT_CREATE,
      );
    }
  };

  // БРИГАД НЕТ — ФОРМЫ НЕТ. Счёт заводится строго на команду, и раньше форма
  // честно собирала сумму с названием, а отказ «Выберите команду счёта»
  // приходил из формы, в которой вопроса о команде не было вовсе. Вместо
  // тупика — причина и дверь в создание команды (слова те же, что у пустого
  // состояния экрана «Счета»).
  if (teams.length === 0) {
    return (
      <BottomSheet visible={visible} onClose={onClose} title="Новый счёт">
        <View style={{ paddingHorizontal: GUTTER, paddingBottom: 28 }}>
          <Text
            maxFontSizeMultiplier={1.3}
            style={{
              fontSize: 15,
              lineHeight: 21,
              color: t.sub,
              marginBottom: 16,
            }}
          >
            Команд пока нет, а счёт заводится на команду — сперва добавьте
            команду.
          </Text>
          <GradientButton
            label="Добавить команду"
            onPress={() => {
              onClose();
              // Экран команд открывается ПОСЛЕ отъезда листа — то же правило,
              // что в PickerSheet: окно поверх закрывающегося листа не
              // появляется.
              setTimeout(() => router.push("/calendar"), SHEET_EXIT_MS);
            }}
          />
        </View>
      </BottomSheet>
    );
  }

  return (
    // АНАТОМИЯ ДЕНЕЖНОГО ЛИСТА: заголовок в тянущейся зоне → тело в прокрутке
    // → кнопка ВНЕ прокрутки со своим нижним безопасным отступом. С `pb-2`
    // кнопка «Создать счёт» под клавиатурой уезжала за край экрана без
    // возможности доскроллить.
    <BottomSheet
      padded={false}
      visible={visible}
      onClose={onClose}
      title="Новый счёт"
      scroll
      avoidKeyboard
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
          {/* ПОДПИСЬ КНОПКИ — ДЕЙСТВИЕ, А НЕ ПЕРЕСКАЗ ФОРМЫ. «Создать счёт для
              команды „Команда 1"» — 40 символов в погашенной плите, и они
              повторяют то, что стоит галкой двумя строками выше. Кнопка
              называет действие; кому счёт — видно в чек-листе. */}
          <GradientButton
            label="Создать счёт"
            onPress={submit}
            disabled={!canSave}
            loading={insert.isPending}
          />
        </View>
      }
    >
      <View style={{ paddingHorizontal: GUTTER, paddingBottom: 8 }}>
        {/* 1. СКОЛЬКО НА СЧЕТУ — первым и крупно. Счёт заводят, чтобы записать
            уже лежащие деньги; раньше этот вопрос стоял третьим и уходил под
            клавиатуру. Минус разрешён: счёт заводят и в долге. */}
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

        {/* 2. НАЗВАНИЕ — им счёт различают. */}
        <Field
          label="Название"
          value={name}
          onChangeText={(v) => {
            setName(v);
            // Правка — попытка исправить отказ («такое имя уже занято»):
            // прошлая жалоба сервера над кнопкой больше не про эту форму.
            setFailure(null);
          }}
          placeholder="Напр. Касса"
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

        {/* 3. ЗНАЧОК И ЦВЕТ — чтобы узнавать счёт в списке пальцем, а не
            вчитываться. Оба необязательны: молчащий счёт рисуется глифом
            своего вида и без пигмента. */}
        {/* Оба набора ОБЩИЕ НА ПРОДУКТ (`ICON_PRESETS` и `PRESET_COLORS`): те же
            сорок значков и сорок цветов, что у команд, меток, услуг и
            категорий. Своя палитра у счетов была бы четырнадцатым набором
            оттенков в одном приложении. Заголовки — местные `FieldLabel`, чтобы
            подписи листа звучали одним голосом. */}
        <IconField
          value={icon}
          tint={color}
          onChange={(slug) => setIcon(icon === slug ? null : slug)}
        />

        <ColorField
          value={color}
          onChange={(hex) => setColor(color === hex ? null : hex)}
        />

        {/* 4. ЧЕЙ ЭТО СЧЁТ — ровно ОДНА команда (владелец 2026-08-15: «счёт
            создаётся чётко на каждую команду, общий счёт полностью убираем»).
            Здесь стоял чек-лист на несколько команд; из него росло понятие
            общего счёта и запрет перевода между командами. У тенанта с одной
            командой вопрос не задаётся вовсе — выбирать не из чего. */}
        {teams.length >= 2 ? (
          <View className="mb-2">
            <FieldLabel text="Чей счёт" />
            {/* Пилюли команд — тот же контрол, которым команду выбирают во
                всём продукте: свой цвет у каждой, `radio` (выбор один). */}
            <View className="flex-row flex-wrap" style={{ gap: 8 }}>
              {teams.map((team) => (
                <Chip
                  key={team.id}
                  label={team.name}
                  color={team.color ?? undefined}
                  selected={teamId === team.id}
                  radio
                  onPress={() => setTeamId(team.id)}
                />
              ))}
            </View>
          </View>
        ) : null}
      </View>
    </BottomSheet>
  );
}

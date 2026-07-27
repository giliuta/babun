// БЛОК ИДЕНТИЧНОСТИ клиента — одна вёрстка на просмотр и создание
// (решение владельца 2026-07-14 «одна страница», уточнено 2026-07-26:
// «разделить чётко — имя, номер телефона, можно добавить второй номер,
// третья строка объекты и так далее; всё в своём блоке и всегда можно
// редактировать»).
//
// БЫЛО «постер»: имя крупным заголовком, телефон мелкой строкой под ним,
// деньги и доверие — стопкой текста. На экране создания это читалось
// перевёрнуто (заголовок «Имя», а курсор стоит в номере), и было
// неочевидно, где вообще границы полей.
//
// СТАЛО стопка ЯВНЫХ СТРОК одного диалекта с фильтрами: «ярлык слева …
// значение справа», тап = правка на месте. Дополнительные номера
// (`client.phones`) живут ЗДЕСЬ, рядом с основным, а не в дальнем блоке
// «Контакты» — второй номер нужен там же, где первый.
//
// ЗВОНКА/SMS ЗДЕСЬ НЕТ: каждое действие живёт ровно в одном месте —
// hero «Записать» + ряд card-actions.
//
// Presentational. Правки персистит через `update`; телефон сохраняется
// ВМЕСТЕ с производным phone_e164 — иначе ключ дедупа
// (findClientByPhoneE164 + DB unique index) остался бы от старого номера.

import { useRef, useState, type ReactNode } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { Bell, Check, X } from "lucide-react-native";
import type { Client, PhoneEntry } from "@babun/shared/local/clients";
import { randomUuid } from "@babun/shared/sync/uuid";
import type { ClientStats } from "@babun/shared/local/selectors/client-stats";
import { formatEUR } from "@babun/shared/common/utils/money";
import {
  formatShortDateRu,
  reminderBadge,
  visitsWord,
} from "@/features/clients/format";
import { tryToE164 } from "@/features/clients/phone";
import { useDefaultCountry } from "@/features/clients/default-country";
import { AddRow, FieldRow, RowGroup } from "@/features/clients/card-rows";
import { useJsonArrayWriter } from "@/features/clients/use-json-writer";
import { useToast } from "@/components/ui/Toast";
import { chooseOption } from "@/lib/choose";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";
import PhoneChannelButton from "@/features/clients/PhoneChannelButton";

/** Режим создания: то, что знает только композер экрана.
 *
 *  Имя и телефон здесь редактируются ЖИВО (onChangeText), а не по blur как
 *  в карточке: «Готово» читает черновик из замыкания текущего рендера, и
 *  blur-сохранение не успело бы долететь — клиент создавался бы без только
 *  что набранного имени. В карточке blur безопасен: там update = PATCH. */
export interface ClientHeaderDraft {
  /** Номер уже валиден (E.164) — рисуем ✓ у поля. */
  valid: boolean;
  /** Живой ввод имени (см. коммент выше). */
  onNameChange: (v: string) => void;
  /** Живой ввод номера: AsYouType + сброс дедупа (владеет композер). */
  onPhoneChange: (v: string) => void;
  /** Нативный пикер контакта; undefined на билдах без модуля. */
  onPickContacts?: () => void;
  /** Баннер дедупа / ошибка создания — внутри блока, под номером. */
  footer?: ReactNode;
}

interface ClientHeaderProps {
  client: Client;
  stats: ClientStats | undefined;
  /** Возвращает false, если запись не удалась: писатель массива номеров по
   *  этому ответу ОТКАТЫВАЕТ оптимистичное значение. Подменённый `true`
   *  выключал откат, и неудачная правка тихо уезжала в базу со следующей
   *  удачной (найдено аудитом 2026-07-27). */
  update: (patch: Partial<Client>) => Promise<boolean> | void;
  draft?: ClientHeaderDraft;
}

/** Стабильная пустая ссылка: `?? []` давал новый массив на каждый рендер и
 *  дёргал пересинхронизацию писателя. */
const EMPTY_PHONES: PhoneEntry[] = [];

// СТАНДАРТНЫЙ НАБОР ПОДПИСЕЙ, как в контактах iPhone (владелец 2026-07-27:
// «что значит „Второй"? напиши сотовый, рабочий — стандартная, как у iPhone;
// не муж-жена»). Родственные подписи («Супруг(а)») убраны: это про отношения,
// а не про номер, и у бизнес-клиента их не бывает.
const EXTRA_LABELS = ["Мобильный", "Рабочий", "Домашний", "WhatsApp", "Другой"];

function nextExtraLabel(existing: PhoneEntry[]): string {
  const used = new Set(existing.map((p) => p.label));
  return EXTRA_LABELS.find((l) => !used.has(l)) ?? "Другой";
}

export default function ClientHeader({
  client,
  stats,
  update,
  draft,
}: ClientHeaderProps) {
  const t = useThemeColors();
  const toast = useToast();
  const country = useDefaultCountry();

  const extras = client.phones ?? EMPTY_PHONES;
  // Номера — тот же jsonb-массив, что объекты: писать его можно только из
  // свежайшего значения и по очереди, иначе две быстрые правки затирают друг
  // друга (patchPhone из снимка рендера + PATCH на всю колонку).
  const phones = useJsonArrayWriter<PhoneEntry>(extras, (next) =>
    Promise.resolve(update({ phones: next })).then((ok) => ok !== false),
  );

  // Новый номер живёт ЛОКАЛЬНО, пока в нём нет цифр: тап по «+ Добавить
  // номер» раньше сразу писал в базу пустую запись, и у клиента навсегда
  // оставалась строка «WHATSAPP — Номер», в которую никто не дописал номер.
  // Пустое поле не является номером, и в данных его быть не должно.
  // Новый номер: id решается СРАЗУ (на тапе «+ Добавить номер»), но в данные
  // ничего не пишется, пока нет первой цифры. Строка при этом не подменяется
  // другой — иначе набор прерывался бы на середине, а запись создавалась бы
  // на каждый символ.
  const [pending, setPending] = useState<{ label: string; id: string } | null>(
    null,
  );
  // Коммит строки происходит и на РАЗМОНТИРОВАНИИ — там читается замыкание
  // прошлого рендера, поэтому актуальное состояние держим ещё и в ref.
  const pendingRef = useRef(pending);
  const setPendingRow = (next: { label: string; id: string } | null) => {
    pendingRef.current = next;
    setPending(next);
  };

  const addPhone = () => {
    haptics.tap();
    setPendingRow({ label: nextExtraLabel(extras), id: randomUuid() });
  };
  /** Новый номер становится записью, как только в нём появилась ПЕРВАЯ цифра.
   *  Раньше это происходило только по blur — и в черновике «Готово» читало
   *  объект без набранного номера, а на карточке уход по «Назад» терял его.
   *  Пустое поле записью не становится вовсе. */
  const commitPending = (raw: string) => {
    const value = raw.trim();
    const row = pendingRef.current;
    // Уже отменили крестиком или закоммитили — второй раз не пишем.
    if (!row) return;
    const { id, label } = row;
    void phones.apply((all) => {
      const rest = all.filter((p) => p.id !== id);
      // Пустое поле записью не становится, а уже созданную стирает: строки
      // «WHATSAPP — Номер» без номера в данных быть не должно.
      return /\d/.test(value) ? [...rest, { id, number: value, label }] : rest;
    });
  };
  const patchPhone = (id: string, patch: Partial<PhoneEntry>) =>
    void phones.apply((all) =>
      all.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    );
  const removePhone = (id: string) => {
    haptics.tap();
    void phones.apply((all) => all.filter((p) => p.id !== id));
  };
  /** Номер — контакт, а не черновик: удаление СПРАШИВАЕТ. Раньше тап (в том
   *  числе случайный, зона крестика залезала на кнопку связи) сносил номер
   *  молча и без отмены. */
  const confirmRemovePhone = (p: PhoneEntry) => {
    Alert.alert(
      `Убрать номер «${p.label}»?`,
      p.number.trim() || undefined,
      [
        { text: "Отмена", style: "cancel" },
        {
          text: "Убрать",
          style: "destructive",
          onPress: () => removePhone(p.id),
        },
      ],
    );
  };
  /** Подпись выбирается СНИЗУ из стандартного набора: перебор по кругу
   *  требовал до пяти тапов и не давал увидеть, что вообще есть. */
  const pickPhoneLabel = async (p: PhoneEntry) => {
    const i = await chooseOption(
      "Подпись номера",
      EXTRA_LABELS.map((label) => ({ label })),
    );
    if (i !== null) patchPhone(p.id, { label: EXTRA_LABELS[i] });
  };

  const debt = stats && stats.debt > 0 ? formatEUR(stats.debt) : null;
  // «Напомнить» (card-actions) пишет reminder_at — строка делает дату
  // видимой: серая, когда впереди, красная — сегодня/прошло.
  const badge = reminderBadge(client.reminder_at);
  const nextApt = stats?.nextApt ?? null;
  const trustSegments = (
    stats
      ? [
          stats.visits > 0
            ? `${stats.visits} ${visitsWord(stats.visits)}`
            : null,
          stats.totalSpent > 0 ? formatEUR(stats.totalSpent) : null,
          stats.lastVisitDate
            ? `был ${formatShortDateRu(stats.lastVisitDate)}`
            : null,
          // Предстоящая запись — здесь же, а не отдельной строкой: это
          // такой же факт «когда», как «был 27 мая».
          nextApt
            ? `записан ${formatShortDateRu(nextApt.date)} · ${nextApt.time}`
            : null,
        ].filter(Boolean)
      : []
  ) as string[];

  return (
    <>
      <RowGroup>
        {/* Имя — ОБЯЗАТЕЛЬНОЕ (владелец 2026-07-26): безымянного клиента не
          найти ни поиском, ни глазами, и в SMS-шаблон нечего подставить. */}
        <FieldRow
          label="Имя"
          value={client.full_name}
          placeholder="Обязательно"
          big
          stacked
          live={!!draft}
          // Имя обязательно НЕ только при создании: на сохранённой карточке
          // его тоже нельзя стереть в ноль — безымянного клиента не найти ни
          // поиском, ни глазами в списке. Пустое просто не пишем, строка
          // возвращает прежнее значение.
          onSave={(v) => {
            if (draft) {
              draft.onNameChange(v);
              return;
            }
            if (v.trim()) {
              update({ full_name: v.trim() });
              return;
            }
            haptics.warning();
            toast("Имя обязательно", "error");
          }}
          trailing={
            draft && client.full_name.trim() ? (
              <Check color={t.success} size={18} strokeWidth={2.5} />
            ) : null
          }
        />

        {/* Телефон вторым (порядок владельца 2026-07-26: сначала имя).
          Ярлык сверху, значение по левому краю — печатать в правое
          выравнивание неудобно. */}
        <FieldRow
          separated
          label="Телефон"
          value={client.phone}
          placeholder="Обязательно"
          keyboardType="phone-pad"
          tabular
          big
          stacked
          live={!!draft}
          autoFocus={!!draft}
          // Телефон — ключ дедупа (phone_e164 + UNIQUE-индекс). Стирание
          // номера у сохранённого клиента уносило и ключ: клиент становился
          // невидимым для защиты от дублей, и его можно было создать заново.
          // Пустое и неразбираемое значение не пишем.
          onSave={(v) => {
            if (draft) {
              draft.onPhoneChange(v);
              return;
            }
            const next = v.trim();
            // Разбираем номер кодом страны КОМПАНИИ: у греческой фирмы «99…»
            // без «+» — греческий номер, а не кипрский. Номер со своим «+»
            // уважается как есть.
            const e164 = next ? tryToE164(next, country) : null;
            // Молча отклонять нельзя: строка возвращала прежний номер, и
            // человек не понимал, почему правка «не сохранилась».
            if (!e164) {
              haptics.warning();
              toast(
                next
                  ? "Номер не распознан — проверьте код страны"
                  : "Телефон обязателен",
                "error",
              );
              return;
            }
            update({ phone: next, phone_e164: e164 });
          }}
          trailing={
            draft ? (
              draft.valid ? (
                <Check color={t.success} size={18} strokeWidth={2.5} />
              ) : null
            ) : (
              <PhoneChannelButton
                number={client.phone}
                telegramUsername={client.telegram_username}
                label="основной"
              />
            )
          }
        />

        {/* Слот черновика: дедуп «Похоже, такой уже есть» / ошибка создания.
          Стоит сразу под номером — там же, где его причина. */}
        {draft?.footer ? (
          <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
            {draft.footer}
          </View>
        ) : null}

        {/* Дополнительные номера — здесь же, у основного: муж/жена, рабочий,
          WhatsApp на другом номере. Ярлык переключается тапом. */}
        {extras
          .filter((p) => p.id !== pending?.id)
          .map((p) => (
            <FieldRow
              key={p.id}
              label={p.label || "Другой"}
              value={p.number}
              placeholder="Номер"
              separated
              keyboardType="phone-pad"
              tabular
              // Тот же вид, что у основного номера: ярлык сверху, номер по
              // ЛЕВОМУ краю (владелец 2026-07-26: «когда я напишу второй номер,
              // она с правой стороны пишет, хотя номер должен быть с левой»).
              stacked
              // В ЧЕРНОВИКЕ — live: «Готово» читает черновик из замыкания, и
              // коммит по blur до него не долетал — второй номер просто не
              // сохранялся вместе с клиентом.
              live={!!draft}
              onLabelPress={() => void pickPhoneLabel(p)}
              onSave={(v) => patchPhone(p.id, { number: v })}
              trailing={
                <View
                  // 12, а не 4: при зазоре 4 слоп «убрать номер» (10 влево)
                  // залезал НА зелёную кнопку связи, и тап по её правому краю
                  // молча удалял номер (аудит 2026-07-27).
                  style={{ flexDirection: "row", alignItems: "center", gap: 12 }}
                >
                  {/* Кнопка знает ИМЕННО ЭТОТ номер: выбор канала — свойство
                  номера, а не клиента. */}
                  <PhoneChannelButton number={p.number} label={p.label} />
                  <Pressable
                    onPress={() => confirmRemovePhone(p)}
                    accessibilityRole="button"
                    accessibilityLabel={`Убрать номер ${p.label}`}
                    // Слоп только вправо и по высоте: влево нельзя — там
                    // соседняя кнопка.
                    hitSlop={{ top: 14, bottom: 14, left: 2, right: 10 }}
                    style={({ pressed }) => ({
                      width: 28,
                      alignItems: "center",
                      opacity: pressed ? 0.5 : 1,
                    })}
                  >
                    <X color={t.ink} size={16} strokeWidth={2.4} />
                  </Pressable>
                </View>
              }
            />
          ))}

        {/* Новый номер: то же поле, но ещё не в данных. Пустым уйдёт — исчезнет
          без следа, с цифрами — станет обычной строкой номера. */}
        {pending ? (
          <FieldRow
            label={pending.label}
            value=""
            placeholder="Номер"
            separated
            keyboardType="phone-pad"
            tabular
            stacked
            autoFocus
            // БЕЗ live: он писал PATCH на КАЖДЫЙ СИМВОЛ (восемь запросов на
            // восьмизначный номер). Коммит по blur / Return / уходу со строки
            // уже даёт примитив, а «Готово» на карточке снимает клавиатуру
            // перед сохранением — значит черновик успевает получить номер.
            onSave={commitPending}
            // Правка закончилась — номер уже в данных, и строка становится
            // обычной строкой-номером (с переключением подписи).
            onEditEnd={() => setPendingRow(null)}
            trailing={
              <Pressable
                onPress={() => {
                  const id = pending.id;
                  setPendingRow(null);
                  // Записи может ещё не быть — тогда и удалять нечего.
                  if (phones.current().some((x) => x.id === id)) {
                    void phones.apply((all) => all.filter((x) => x.id !== id));
                  }
                }}
                accessibilityRole="button"
                accessibilityLabel="Отменить добавление номера"
                hitSlop={10}
                style={({ pressed }) => ({
                  width: 28,
                  alignItems: "center",
                  opacity: pressed ? 0.5 : 1,
                })}
              >
                <X color={t.faint} size={16} strokeWidth={2.4} />
              </Pressable>
            }
          />
        ) : (
          <AddRow label="+ Добавить номер" separated onPress={addPhone} />
        )}

        {draft?.onPickContacts ? (
          <AddRow
            label="Заполнить из контактов"
            separated
            onPress={draft.onPickContacts}
          />
        ) : null}
      </RowGroup>

      {/* МАЛЕНЬКАЯ КАРТОЧКА ПОД НОМЕРОМ (владелец 2026-07-26). Не строки-
          факты, а сводка: долг первым и янтарём («обрати внимание», не
          авария), напоминание, и одной строкой доверие — визиты, сумма,
          когда был, когда записан. Отдельной карточкой, а не хвостом блока
          идентичности: это ПРОИЗВОДНОЕ, а не поле, которое правят. */}
      {debt || badge || trustSegments.length > 0 ? (
        <View
          style={{
            marginHorizontal: 12,
            marginTop: 8,
            paddingHorizontal: 16,
            paddingVertical: 12,
            gap: 4,
            borderRadius: t.radius.card,
            backgroundColor: t.surface,
          }}
        >
          {debt ? (
            <Text
              maxFontSizeMultiplier={1.3}
              style={{ fontSize: 15, fontWeight: "700", color: t.warning }}
            >
              {`Долг ${debt}`}
            </Text>
          ) : null}
          {badge ? (
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
            >
              <Bell
                color={badge.due ? t.danger : t.sub}
                size={12}
                strokeWidth={2.2}
              />
              <Text
                maxFontSizeMultiplier={1.3}
                style={{
                  fontSize: 13,
                  fontWeight: badge.due ? "600" : "400",
                  color: badge.due ? t.danger : t.sub,
                }}
              >
                {`Напомнить · ${badge.label}`}
              </Text>
            </View>
          ) : null}
          {trustSegments.length > 0 ? (
            <Text
              maxFontSizeMultiplier={1.3}
              style={{ fontSize: 13, color: t.sub }}
            >
              {trustSegments.join(" · ")}
            </Text>
          ) : null}
        </View>
      ) : null}
    </>
  );
}

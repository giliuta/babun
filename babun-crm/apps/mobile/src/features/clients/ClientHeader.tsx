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

import { type ReactNode } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import {
  Bell,
  Check,
  Contact,
  Phone as PhoneIcon,
  X,
} from "lucide-react-native";
import type { Client, PhoneEntry } from "@babun/shared/local/clients";
import type { ClientStats } from "@babun/shared/local/selectors/client-stats";
import { formatEUR } from "@babun/shared/common/utils/money";
import {
  formatShortDateRu,
  reminderBadge,
  visitsWord,
} from "@/features/clients/format";
import { tryToE164 } from "@/features/clients/phone";
import { AddRow, FieldRow, RowGroup } from "@/features/clients/card-rows";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";
import ClientContactRow from "@/features/clients/ClientContactRow";

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
  update: (patch: Partial<Client>) => void;
  draft?: ClientHeaderDraft;
}

const EXTRA_LABELS = ["Второй", "WhatsApp", "Рабочий", "Супруг(а)", "Другой"];

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

  const extras = client.phones ?? [];

  const addPhone = () => {
    haptics.tap();
    update({
      phones: [
        ...extras,
        {
          id: `phone-${Date.now()}`,
          number: "",
          label: nextExtraLabel(extras),
        },
      ],
    });
  };
  const patchPhone = (id: string, patch: Partial<PhoneEntry>) =>
    update({
      phones: extras.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    });
  const removePhone = (id: string) => {
    haptics.tap();
    update({ phones: extras.filter((p) => p.id !== id) });
  };
  // Ярлык переключается по кругу — отдельный пикер на такую мелочь был бы
  // тяжелее самой задачи.
  const cyclePhoneLabel = (p: PhoneEntry) => {
    haptics.tap();
    const i = EXTRA_LABELS.indexOf(p.label);
    patchPhone(p.id, {
      label: EXTRA_LABELS[(i + 1) % EXTRA_LABELS.length],
    });
  };

  const debt = stats && stats.debt > 0 ? formatEUR(stats.debt) : null;
  // «Напомнить» (card-actions) пишет reminder_at — строка делает дату
  // видимой: серая, когда впереди, красная — сегодня/прошло.
  const badge = reminderBadge(client.reminder_at);
  const nextApt = stats?.nextApt ?? null;
  const trustSegments = (
    stats
      ? [
          stats.visits > 0 ? `${stats.visits} ${visitsWord(stats.visits)}` : null,
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
        onSave={(v) =>
          draft ? draft.onNameChange(v) : update({ full_name: v })
        }
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
        onSave={(v) =>
          draft
            ? draft.onPhoneChange(v)
            : update({ phone: v, phone_e164: tryToE164(v) })
        }
        trailing={
          draft?.valid ? (
            <Check color={t.success} size={18} strokeWidth={2.5} />
          ) : null
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
      {extras.map((p) => (
        <FieldRow
          key={p.id}
          label={p.label || "Другой"}
          value={p.number}
          placeholder="Номер"
          separated
          keyboardType="phone-pad"
          tabular
          onLabelPress={() => cyclePhoneLabel(p)}
          onSave={(v) => patchPhone(p.id, { number: v })}
          trailing={
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
            >
              {/* Позвонить на ЭТОТ номер: у дополнительного номера звонок —
                  единственный способ им воспользоваться, ряд действий внизу
                  всегда работает с основным. */}
              {p.number.replace(/\D/g, "").length >= 5 ? (
                <Pressable
                  onPress={() => {
                    haptics.tap();
                    void Linking.openURL(
                      `tel:${p.number.replace(/[^\d+]/g, "")}`,
                    );
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Позвонить на номер ${p.label}`}
                  hitSlop={8}
                  style={({ pressed }) => ({
                    width: 32,
                    height: 32,
                    borderRadius: 16,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: `${t.success}1a`,
                    opacity: pressed ? 0.6 : 1,
                  })}
                >
                  <PhoneIcon color={t.success} size={14} strokeWidth={2.2} />
                </Pressable>
              ) : null}
              <Pressable
                onPress={() => removePhone(p.id)}
                accessibilityRole="button"
                accessibilityLabel={`Убрать номер ${p.label}`}
                hitSlop={10}
                style={({ pressed }) => ({
                  width: 28,
                  alignItems: "center",
                  opacity: pressed ? 0.5 : 1,
                })}
              >
                <X color={t.faint} size={16} strokeWidth={2.4} />
              </Pressable>
            </View>
          }
        />
      ))}

      <AddRow label="+ Добавить номер" separated onPress={addPhone} />

      {/* Кнопки идут ПОСЛЕ всех номеров: они и служат границей блока
          идентичности (владелец 2026-07-26 — «+ Добавить номер» должен
          стоять при телефоне, а не за кнопками). В черновике их нет:
          звонить и записывать ещё некому. */}
      {!draft ? (
        <ClientContactRow client={client} stats={stats} separated />
      ) : null}

      {draft?.onPickContacts ? (
        <AddRow
          label="Заполнить из контактов"
          separated
          onPress={draft.onPickContacts}
        />
      ) : null}

      {/* Производное — не строки-факты, а тихая сводка: долг (янтарь —
          «обрати внимание», не авария), напоминание и строка доверия. */}
      {debt || badge || trustSegments.length > 0 ? (
        <View
          style={{
            paddingHorizontal: 16,
            paddingVertical: 10,
            gap: 4,
            borderTopWidth: 1,
            borderTopColor: t.separator,
          }}
        >
          {debt ? (
            <Text
              maxFontSizeMultiplier={1.3}
              style={{ fontSize: 14, fontWeight: "600", color: t.warning }}
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
    </RowGroup>
  );
}

/** Контакт-иконка нужна экрану создания как аффорданс «взять из телефона»
 *  — оставлена экспортом, чтобы композер не тянул lucide напрямую. */
export { Contact as ContactsIcon };

import { useState } from "react";
import {
  ActionSheetIOS,
  Alert,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { ACType, ACUnit, Client } from "@babun/shared/local/clients";
import {
  AC_TYPE_LABELS,
  AC_TYPE_ORDER,
} from "@babun/shared/local/clients";
import { serviceDueState } from "@babun/shared/local/equipment-sla";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import {
  ActionRow,
  ControlRow,
  FieldRow,
  NavRow,
  RowCaption,
  RowGroup,
} from "@/features/clients/card-rows";
import {
  normalizeYMD,
  OptionalDateField,
} from "@/features/clients/OptionalDateField";
import { useLocationWriter } from "@/features/clients/use-location-writer";
import { formatShortDateRu } from "@/features/clients/format";
import { useClient, useUpdateClient } from "@/features/clients/queries";
import { useThemeColors } from "@/theme/colors";

// СТРАНИЦА КОНДИЦИОНЕРА. Раньше эти шесть полей жили инлайн-редактором
// внутри строки списка внутри карточки объекта внутри карточки клиента —
// три уровня вложенности и 180 строк вёрстки на одну единицу техники.
//
// Порядок: где стоит → что это → когда обслуживали. График ТО кормит блок
// «Обслуживание» на карточке, поэтому «Последнее ТО» и «Интервал» — не
// справка, а рабочие поля.
//
// Интервал — выбор из готовых сроков, а не ввод числа: диспетчер выбирает
// «раз в год», а не печатает «12». Нестандартное легаси-значение печатается
// как есть и не теряется.

/** Готовые сроки. Легаси-значения (18 мес) остаются в данных и печатаются. */
const INTERVALS = [6, 12, 24];

const EMPTY: ACUnit = {
  id: "",
  room: "",
  ac_type: "split",
  has_indoor: true,
  has_outdoor: true,
};

export default function ClientUnitScreen() {
  const t = useThemeColors();
  const router = useRouter();
  const { clientId, locId, unitId } = useLocalSearchParams<{
    clientId: string;
    locId: string;
    unitId: string;
  }>();
  const isNew = unitId === "new";

  const { data: client, isLoading } = useClient(clientId ?? "");
  const updateClient = useUpdateClient(clientId ?? "");
  const update = async (patch: Partial<Client>) => {
    try {
      await updateClient.mutateAsync(patch);
      return true;
    } catch {
      return false;
    }
  };
  const writer = useLocationWriter(client?.locations ?? [], update);

  const loc = client?.locations?.find((l) => l.id === locId) ?? null;
  const unit = loc?.equipment?.find((u) => u.id === unitId) ?? null;

  const [draft, setDraft] = useState<ACUnit>(EMPTY);
  const [saving, setSaving] = useState(false);

  const shown = isNew ? draft : (unit ?? EMPTY);
  // Комната — единственное обязательное: без неё в списке объекта строка не
  // отличается от соседней.
  const canSave = !!draft.room.trim();
  const draftDirty =
    isNew &&
    (!!draft.room.trim() ||
      !!draft.model?.trim() ||
      !!draft.last_service_at ||
      !!draft.installed_at ||
      !!draft.service_interval_months);

  const patch = (p: Partial<ACUnit>) => {
    if (isNew) {
      setDraft((d) => ({ ...d, ...p }));
      return;
    }
    if (!unit || !loc) return;
    void writer.saveUnit(loc.id, { ...unit, ...p });
  };

  const saveDraft = async () => {
    if (!canSave || saving || !loc) return;
    setSaving(true);
    try {
      const ok = await writer.saveUnit(loc.id, {
        ...draft,
        id: writer.newId(),
        room: draft.room.trim(),
        model: draft.model?.trim() || undefined,
      });
      if (ok) router.back();
    } finally {
      setSaving(false);
    }
  };

  const pickType = () => {
    const options = [...AC_TYPE_ORDER.map((k) => AC_TYPE_LABELS[k]), "Отмена"];
    ActionSheetIOS.showActionSheetWithOptions(
      { title: "Тип кондиционера", options, cancelButtonIndex: options.length - 1 },
      (i) => {
        const chosen = AC_TYPE_ORDER[i];
        if (chosen) patch({ ac_type: chosen as ACType });
      },
    );
  };

  const pickInterval = () => {
    const options = [
      ...INTERVALS.map((m) => `Раз в ${m} мес`),
      "Без графика",
      "Отмена",
    ];
    ActionSheetIOS.showActionSheetWithOptions(
      { title: "Интервал обслуживания", options, cancelButtonIndex: options.length - 1 },
      (i) => {
        if (i < INTERVALS.length) {
          patch({ service_interval_months: INTERVALS[i] });
          return;
        }
        if (i === INTERVALS.length) patch({ service_interval_months: undefined });
      },
    );
  };

  const confirmDelete = () => {
    if (!unit || !loc) return;
    Alert.alert(
      `Удалить кондиционер «${unit.room || "без комнаты"}»?`,
      "Даты обслуживания будут удалены.",
      [
        { text: "Отмена", style: "cancel" },
        {
          text: "Удалить",
          style: "destructive",
          onPress: async () => {
            const ok = await writer.removeUnit(loc.id, unit.id);
            if (ok) router.back();
          },
        },
      ],
    );
  };

  const onBack = () => {
    if (!draftDirty) {
      router.back();
      return;
    }
    Alert.alert(
      "Удалить черновик кондиционера?",
      "Комната не заполнена, поэтому кондиционер ещё не добавлен.",
      [
        { text: "Продолжить заполнение", style: "cancel" },
        { text: "Удалить", style: "destructive", onPress: () => router.back() },
      ],
    );
  };

  // Объект или юнит могли исчезнуть, пока страница открыта.
  if (!loc || (!isNew && !unit)) {
    return (
      <Screen>
        <ScreenHeader title="Кондиционер" />
        <View className="flex-1 items-center justify-center px-8">
          <Text
            accessibilityRole="header"
            className="text-center text-[15px]"
            style={{ color: t.sub }}
          >
            {isLoading ? "Загрузка…" : "Кондиционер удалён"}
          </Text>
        </View>
      </Screen>
    );
  }

  const due = serviceDueState(shown);
  const interval = shown.service_interval_months;

  return (
    <Screen>
      <ScreenHeader
        title={isNew ? "Новый кондиционер" : shown.room || "Кондиционер"}
        subtitle={loc.label || "Объект"}
        onBack={onBack}
        right={
          isNew ? (
            <Pressable
              onPress={() => void saveDraft()}
              disabled={!canSave || saving}
              accessibilityRole="button"
              accessibilityLabel="Готово"
              accessibilityState={{ disabled: !canSave || saving, busy: saving }}
              hitSlop={8}
              style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 8 }}
            >
              <Text
                maxFontSizeMultiplier={1.2}
                style={{
                  fontSize: 17,
                  fontWeight: "600",
                  color: canSave && !saving ? t.accent : t.faint,
                }}
              >
                {saving ? "Сохраняю…" : "Готово"}
              </Text>
            </Pressable>
          ) : undefined
        }
      />

      <ScrollView
        contentContainerStyle={{ paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
      >
        <RowGroup>
          <FieldRow
            label="Комната"
            value={shown.room}
            placeholder="Спальня / Гостиная"
            stacked
            live={isNew}
            autoFocus={isNew}
            onSave={(v) => patch({ room: v })}
          />
          <FieldRow
            label="Марка и модель"
            // Одно поле вместо двух: «Daikin FTXS35» диспетчер и так пишет
            // одной строкой, а разделение бренда и модели никто не заполнял.
            // Старая запись схлопывается при первой правке.
            value={[shown.brand, shown.model].filter(Boolean).join(" ")}
            placeholder="Daikin FTXS35"
            stacked
            separated
            live={isNew}
            onSave={(v) => patch({ brand: undefined, model: v || undefined })}
          />
          <NavRow
            label="Тип"
            value={AC_TYPE_LABELS[shown.ac_type]}
            separated
            onPress={pickType}
          />
        </RowGroup>

        <RowGroup title="Обслуживание">
          <ControlRow label="Последнее ТО">
            <OptionalDateField
              align="end"
              label="Последнее ТО"
              value={normalizeYMD(shown.last_service_at)}
              onChange={(v) => patch({ last_service_at: v || undefined })}
            />
          </ControlRow>
          {/* «Установлен» остаётся: пока ТО ни разу не делали, это
              единственная база графика — без неё serviceDueState считает от
              сегодня и обещает ТО через год после открытия карточки. */}
          <ControlRow label="Установлен" separated>
            <OptionalDateField
              align="end"
              label="Установлен"
              value={normalizeYMD(shown.installed_at)}
              onChange={(v) => patch({ installed_at: v || undefined })}
            />
          </ControlRow>
          <NavRow
            label="Интервал ТО"
            value={interval ? `Раз в ${interval} мес` : null}
            placeholder="без графика"
            separated
            onPress={pickInterval}
          />
        </RowGroup>
        {due ? (
          <RowCaption
            tone={due.overdue ? "danger" : due.soon ? "warning" : "quiet"}
            text={
              due.overdue
                ? `ТО просрочено на ${Math.abs(due.daysUntil)} дн · план ${formatShortDateRu(due.nextDate)}`
                : `Следующее ТО ${formatShortDateRu(due.nextDate)} · через ${due.daysUntil} дн`
            }
          />
        ) : null}

        {!isNew ? (
          <RowGroup>
            <ActionRow
              label="Удалить кондиционер"
              tone="danger"
              onPress={confirmDelete}
            />
          </RowGroup>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

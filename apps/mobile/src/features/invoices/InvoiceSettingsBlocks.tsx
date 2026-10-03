import { Text, View } from "react-native";
import { FieldRow } from "@/components/ui/card-rows";
import { SectionCard } from "@/components/ui/SectionCard";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { SwitchRow } from "@/components/ui/SwitchRow";
import { useToast } from "@/components/ui/Toast";
import { useThemeColors } from "@/theme/colors";
import { useTenant, useUpdateTenant } from "@/features/settings/tenant";
import { notify } from "@/lib/notify";
import { dueDayOptions } from "./due-days";

// «ИНВОЙСЫ» — ЧТО ПОДСТАВЛЯТЬ В НОВЫЙ СЧЁТ. Одно на весь аккаунт: строки,
// срок оплаты, приписка. Номер и буквы серии — у каждого набора реквизитов
// (их карточка, блок «Номер»).
//
// ВИД 03.10 (владелец: «переделай полностью с нашим новым дизайном — чтоб всё
// было чётко по стилю»): блоки с шапкой внутри, как в карточке реквизитов, —
// «Строки», «Оплата», «Приписка». Подписей под строками, примера в пустой
// приписке и сноски под блоком больше нет (его же законы: подсказка называет
// поле; никаких объяснений под строками). Два положения — тумблер, срок —
// клавишами, ответ виден сразу.
//
// ЭТО ТОЛЬКО ДЕФОЛТЫ. Выставленный счёт хранит свои строки, свой срок и свою
// приписку: поменяли настройку — старые документы не переписываются. Каждая
// правка пишется сразу, как тумблеры остальных настроек.

export function InvoiceSettingsBlocks({
  readOnly = false,
}: {
  /** Партнёр с «Инвойсы: Только видит» (03.10): те же блоки без правки —
   *  менять бланк может только владелец (`tenants_update_owner`). */
  readOnly?: boolean;
} = {}) {
  const t = useThemeColors();
  const toast = useToast();
  const tenant = useTenant();
  const update = useUpdateTenant();

  if (!tenant.data) return null;

  const data = tenant.data;
  const byServices = data.invoice_line_source !== "total";
  const dueDays = data.invoice_due_days ?? 7;
  const lineTitle = data.invoice_default_line_title || "Услуги";
  const save = (patch: Parameters<typeof update.mutate>[0]) =>
    update.mutate(patch, {
      onSuccess: () => toast("Сохранено", "success"),
      onError: (e) => notify("Не удалось сохранить", (e as Error).message),
    });

  return (
    <>
      <SectionCard dense title="Строки">
        {/* Вкл — каждая услуга визита своей строкой с количеством и ценой;
            выкл — весь визит одной позицией под названием ниже. */}
        <SwitchRow
          label="Услуги строками"
          value={byServices}
          disabled={readOnly}
          onChange={(next) => save({ invoice_line_source: next ? "services" : "total" })}
        />
        {/* Название позиции, когда у записи нет услуг или тумблер выключен.
            Пустое не сохраняется: документ остался бы без предмета — сумма
            есть, а за что, не сказано. Поле вернёт прежнее само. */}
        <FieldRow
          label="Название строки"
          value={lineTitle}
          placeholder="Название строки"
          stacked
          separated
          readOnly={readOnly}
          onSave={(v) => {
            const clean = v.trim();
            if (!clean || clean === data.invoice_default_line_title) return;
            save({ invoice_default_line_title: clean });
          }}
        />
      </SectionCard>

      <SectionCard dense title="Оплата">
        {/* Строка — как «Цифр в номере» в карточке реквизитов. */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            minHeight: 60,
            paddingHorizontal: 16,
            paddingVertical: 8,
          }}
        >
          <Text
            maxFontSizeMultiplier={1.2}
            numberOfLines={1}
            style={{ flex: 1, fontSize: 15, color: t.ink }}
          >
            Срок, дней
          </Text>
          <SegmentedControl
            compact
            options={dueDayOptions(dueDays)}
            value={String(dueDays)}
            disabled={readOnly}
            onChange={(value) => {
              const next = Number(value);
              if (next !== dueDays) save({ invoice_due_days: next });
            }}
            style={{ width: 260 }}
          />
        </View>
      </SectionCard>

      <SectionCard dense title="Приписка">
        <FieldRow
          label="Приписка внизу"
          value={data.invoice_footer_note ?? ""}
          placeholder="Приписка внизу"
          addLabel={readOnly ? undefined : "Добавить"}
          stacked
          multiline
          readOnly={readOnly}
          onSave={(v) => {
            const clean = v.trim();
            if (clean === (data.invoice_footer_note ?? "")) return;
            save({ invoice_footer_note: clean || null });
          }}
        />
      </SectionCard>
    </>
  );
}

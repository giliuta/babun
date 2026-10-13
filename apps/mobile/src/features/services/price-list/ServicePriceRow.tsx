import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { EyeOff, RotateCcw, Trash2 } from "lucide-react-native";
import { formatEURExact } from "@babun/shared/common/utils/money";
import { SwipeRow } from "@/components/ui/SwipeRow";
import { useThemeColors } from "@/theme/colors";
import {
  AppearanceTile,
  appearanceRowFill,
} from "@/components/ui/AppearanceSheet";
import type { Service } from "@/features/services/queries";
import { priceRowSub } from "./price-list-rules";
import type { ServicesListState } from "./use-services-list";

/** Высота строки фиксирована: по ней перетаскивание считает, через сколько
 *  соседей перелетел палец. Две строки текста + воздух. */
export const ROW_H = 60;

/** One price-list row: swipe edges, appearance tile, name, time and price. */
export function ServicePriceRow({
  svc,
  handle,
  list,
}: {
  svc: Service;
  handle: ReactNode;
  list: ServicesListState;
}) {
  const t = useThemeColors();
  const { readOnly, handlePurge, handleDelete, update, toast, alertError, setEditing } = list;
  // Владельца в строке не печатаем: весь список принадлежит
  // одной команде, и её имя стоит лентой над списком.
  const sub = priceRowSub(svc);
  // ЦЕНА С КОПЕЙКАМИ. `formatEUR` округляет до целых евро
  // (`money(Math.round(...))`), и услуга за 49,50 печаталась в
  // прайсе как «€50» — прайс обязан говорить ровно ту цену,
  // которая уедет в запись и в счёт.
  const price = formatEURExact(Number(svc.price));
  const off = !svc.is_active;
  return (
    <SwipeRow
      // СПРАВА — УДАЛИТЬ, СЛЕВА — СКРЫТЬ (владелец 2026-08-29:
      // «удалить справа, скрыть слева, а не наоборот»).
      //
      // Стороны, а не направления: правая кромка у SwipeRow —
      // главная (`label`), левая — вторая (`leading`). Прошлый
      // заход развесил их наоборот, потому что я прочитал
      // «влево/вправо» как СВАЙП, а сказано было про сторону,
      // где появляется кнопка.
      //
      // Правая всегда одна и та же — «Удалить»; левая меняется
      // вместе со строкой: скрытая предлагает показать. Так
      // разрушительное действие живёт на постоянном месте и не
      // подменяется под пальцем.
      label={readOnly ? undefined : "Удалить"}
      color={t.danger}
      icon={Trash2}
      accessibilityLabel={`Удалить услугу ${svc.name} навсегда`}
      onAction={readOnly ? undefined : () => void handlePurge(svc)}
      // `fullSwipe` НЕ включён и включён не будет: закон канона —
      // размашистый свайп не носит разрушительного, а здесь оно
      // необратимо.
      leading={readOnly ? undefined : {
        label: off ? "Показать" : "Скрыть",
        color: off ? t.success : t.warning,
        icon: off ? RotateCcw : EyeOff,
        accessibilityLabel: off
          ? `Показать услугу ${svc.name}`
          : `Скрыть услугу ${svc.name}`,
        onAction: () =>
          off
            ? update.mutate(
                { id: svc.id, patch: { is_active: true } },
                {
                  onSuccess: () => toast("Услуга показана"),
                  onError: alertError,
                },
              )
            : handleDelete(svc),
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          // Выключенная не исчезает и не кричит — она просто
          // тише живых. Полупрозрачность гасит и заливку услуги,
          // и цену: строка целиком уходит на второй план.
          opacity: off ? 0.45 : 1,
          backgroundColor: appearanceRowFill(svc.color, false, {
            rest: t.surface,
            pressed: t.pressed,
          }),
        }}
      >
        <Pressable
          disabled={readOnly}
          onPress={() =>
            setEditing({ mode: "edit", service: svc })
          }
          accessibilityRole={readOnly ? "text" : "button"}
          accessibilityLabel={`${svc.name}, ${price}, ${sub}`}
          accessibilityHint={readOnly ? undefined : "Открыть редактор услуги"}
          style={({ pressed }) => ({
            flex: 1,
            height: ROW_H,
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            paddingLeft: 16,
            // ЗАЛИВКУ ДЕРЖИТ ВСЯ СТРОКА, А НЕ ЕЁ ПОЛОВИНА: цвет
            // стоит на внешней строке, здесь остаётся только
            // отклик на палец. Иначе две заливки складывались, и
            // колонка ручки выходила светлее остального.
            backgroundColor: pressed ? t.pressed : "transparent",
          })}
        >
          {/* ПЛИТКА ВИДА — как у тега, метки и типа объекта:
              услуга узнаётся в прайсе тем же способом. */}
          <AppearanceTile
            color={svc.color || null}
            icon={svc.icon}
            size={28}
          />
          <View
            style={{ flex: 1, paddingRight: 12 }}
          >
            <Text
              maxFontSizeMultiplier={1.3}
              numberOfLines={1}
              style={{
                fontSize: 16,
                fontWeight: "600",
                color: t.ink,
              }}
            >
              {svc.name}
            </Text>
            <Text
              maxFontSizeMultiplier={1.3}
              numberOfLines={1}
              style={{ fontSize: 13, color: t.sub }}
            >
              {sub}
            </Text>
          </View>
          <Text
            maxFontSizeMultiplier={1.3}
            numberOfLines={1}
            // Столбец цен обязан быть моноширинным. Класс
            // `tabular-nums` в NativeWind — no-op (ДС §2):
            // работает только это свойство.
            style={{
              fontSize: 16,
              fontWeight: "600",
              color: t.ink,
              fontVariant: ["tabular-nums"],
            }}
          >
            {price}
          </Text>
        </Pressable>
        {/* Ручка — СНАРУЖИ нажимаемой области: вложенная внутрь,
            она отдавала бы короткий тап строке. */}
        {handle}
      </View>
    </SwipeRow>
  );
}

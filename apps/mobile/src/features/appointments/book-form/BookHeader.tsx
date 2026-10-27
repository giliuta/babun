import { Pressable, View } from "react-native";
import { Bell, BellRing, ChevronLeft, MoreHorizontal } from "lucide-react-native";
import { ICON, TYPE } from "@/components/ui/tokens";
import { Halo } from "@/components/ui/Halo";
import { colorName } from "@babun/shared/common/utils/colors";
import { selfReminderLabel } from "@/lib/reminder-time";
import { haptics } from "@/lib/haptics";
import { Text } from "./book-text";
import type { BookModel } from "./use-book-form";

/** Header: back · title · bell (remind myself) · record colour swatch · «⋯». */
export function BookHeader({ form }: { form: BookModel }) {
  const {
    t,
    headerBg,
    headerBorder,
    identityC,
    requestClose,
    title,
    setReminderSheetOpen,
    selfReminder,
    can,
    setColorSheetOpen,
    kind,
    hasColor,
    hasRecordMenu,
    openRecordMenu,
  } = form;
  // Заголовок держится посередине: левая сторона шириной с правую.
  const sideW = hasRecordMenu ? 116 : 72;
  return (
    // шапка: назад · заголовок · Цвет записи — на identity-подложке;
    // выбор цвета живо подсвечивает шапку (halo), фон и CTA.
    <View
      style={{
        backgroundColor: headerBg,
        borderBottomWidth: 1,
        borderBottomColor: headerBorder,
      }}
    >
      <Halo color={identityC} intensity={0.16} />
      <View className="flex-row items-center px-3" style={{ height: 48 }}>
        {/* СТРЕЛКА «НАЗАД», КАК У ВСЕХ СТРАНИЦ, а не «Отмена»: запись —
            страница, открытая поверх, и уходят с неё назад. Ничего не
            меняли — уход молча; меняли — вопрос «Сохранить?». */}
        <Pressable
          onPress={requestClose}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Назад"
          style={({ pressed }) => ({
            minWidth: sideW,
            minHeight: 44,
            justifyContent: "center",
            opacity: pressed ? 0.5 : 1,
          })}
        >
          <ChevronLeft color={t.body} size={ICON.md} />
        </Pressable>
        <Text
          className="flex-1 text-center"
          style={{ ...TYPE.headline, color: t.ink }}
        >
          {title}
        </Text>
        <View
          style={{
            minWidth: sideW,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 2,
          }}
        >
          {/* КОЛОКОЛЬЧИК — НАПОМНИТЬ СЕБЕ (вверху справа рядом с выбором цвета, и на
              клиенте, и на событии). Стоит
              напоминание — звонящий колокольчик акцентом. */}
          <Pressable
            onPress={() => {
              haptics.tap();
              setReminderSheetOpen(true);
            }}
            hitSlop={6}
            style={{ minWidth: 40, minHeight: 44, alignItems: "center", justifyContent: "center" }}
            accessibilityRole="button"
            accessibilityLabel={
              selfReminder
                ? `Напоминание: ${selfReminderLabel(selfReminder)}`
                : "Напомнить себе"
            }
          >
            {selfReminder ? (
              <BellRing size={22} strokeWidth={2.2} color={t.accent} />
            ) : (
              <Bell size={22} strokeWidth={2} color={t.body} />
            )}
          </Pressable>
          {/* Подписанный контрол цвета (не Done-слот): swatch + «Цвет» —
              самоочевидная кнопка, единственный коммит — градиент снизу. */}
          <Pressable
            onPress={
              can.editColor
                ? () => {
                    setColorSheetOpen(true);
                    haptics.tap();
                  }
                : undefined
            }
            disabled={!can.editColor}
            hitSlop={8}
            className="items-center justify-center rounded-[10px] px-1.5"
            style={{ minHeight: 44 }}
            accessibilityRole="button"
            accessibilityLabel={`${
              kind === "event" ? "Цвет события" : "Цвет записи"
            }: ${colorName(identityC)}${hasColor ? "" : ", автоматически"}`}
            accessibilityHint="Открывает выбор цвета — им подсвечивается вся запись"
          >
            {/* ОБРАЗЕЦ ПОКАЗЫВАЕТ ДЕЙСТВУЮЩИЙ ЦВЕТ, А НЕ ФАКТ ВЫБОРА. Здесь
                рисовалась иконка палитры, пока цвет не выбран руками, — то
                есть кнопка «Цвет» молчала именно тогда, когда цвет было
                интереснее всего увидеть: у записи без клиента он серый, у
                выезда без объекта — оранжевый, и это и есть ответ. */}
            {/* БЕЗ ПОДПИСИ «Цвет»: единственная подписанная
                кнопка шапки во всём продукте спорила с «Отмена» и заголовком.
                Образец крупнее — 28pt, — чтобы читаться как кнопка; имя для
                VoiceOver — в accessibilityLabel. */}
            <View
              style={{
                width: 28,
                height: 28,
                borderRadius: t.radius.card,
                borderCurve: "continuous",
                backgroundColor: identityC,
                borderWidth: 2,
                borderColor: t.surface,
                boxShadow: `0px 1px 4px ${identityC}66`,
              }}
            />
          </Pressable>
          {/* «⋯» — ТО ЖЕ МЕНЮ, ЧТО ДОЛГОЕ НАЖАТИЕ ПО ЗАПИСИ В КАЛЕНДАРЕ:
              отменить визит, вернуть, скопировать, удалить — не уходя со
              страницы. Пунктов нет (новая запись, нет прав) — нет кнопки. */}
          {hasRecordMenu ? (
            <Pressable
              onPress={openRecordMenu}
              hitSlop={6}
              style={({ pressed }) => ({
                minWidth: 40,
                minHeight: 44,
                alignItems: "center",
                justifyContent: "center",
                opacity: pressed ? 0.5 : 1,
              })}
              accessibilityRole="button"
              accessibilityLabel={kind === "event" ? "Действия с событием" : "Действия с записью"}
            >
              <MoreHorizontal size={22} strokeWidth={2} color={t.body} />
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

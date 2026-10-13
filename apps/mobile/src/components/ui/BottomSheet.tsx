import {
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  View,
  useWindowDimensions,
} from "react-native";
import { KeyboardLift } from "@/components/ui/KeyboardLift";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";
import { GUTTER } from "@/components/ui/tokens";
import { useReduceMotion } from "@/lib/reduce-motion";
import {
  SheetOverlayOutlet,
  clearOverlay,
  isSheetOpen,
  newSheetId,
  pushSheet,
  removeSheet,
  topSheet,
  useSheetStackVersion,
} from "@/components/ui/sheet-overlay";
import { OverlayLayers } from "@/components/ui/bottom-sheet/OverlayLayers";
import { SheetFooter } from "@/components/ui/bottom-sheet/SheetFooter";
import { SheetHeader } from "@/components/ui/bottom-sheet/SheetHeader";
import { useSheetMotion } from "@/components/ui/bottom-sheet/use-sheet-motion";

// ─── Канонический нижний лист приложения ───────────────────────────────
// ЕДИНСТВЕННЫЙ способ показать выезжающую снизу панель. Заменяет собой
// самописные `Modal animationType="slide"`, которые тянули вверх ВЕСЬ модал
// вместе со скримом (серое затемнение «наползало» снизу — дёшево).
//
// Здесь скрим проявляется opacity-ом НА МЕСТЕ, а лист отдельно выезжает
// пружиной снизу и так же уезжает вниз. Всё гейтится на Reduce Motion.
// Правило: любой новый нижний лист = <BottomSheet>. См. DESIGN-SYSTEM.md.
//
// Parts live in `bottom-sheet/`: motion and drag gesture (`use-sheet-motion`),
// header, footer and the overlay portal. The stack logic stays here.

/** Сколько лист уезжает вниз. Экспортируется, потому что действие, которое
 *  открывает СВОЁ окно поверх (второй лист, Alert, «Поделиться»), обязано
 *  дождаться конца этой анимации — иначе оно не появится вовсе. */
export const SHEET_EXIT_MS = 260;

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function BottomSheet({
  visible,
  onClose,
  children,
  /** Заголовок листа — под грабером и ВНУТРИ его жеста. Помечен как
   *  `header`: без этого ротор VoiceOver внутри листа пуст. */
  title,
  /** Вторая строка шапки, под именем: чей это лист — дата дня, имя клиента.
   *  Самодельные шапки из-за её отсутствия и заводились (метка дня рисовала
   *  свою строку 44│центр│44 с датой). */
  subtitle,
  /** Кнопка листа. Живёт ВНЕ прокрутки тела и платит нижний безопасный
   *  отступ — иначе «Перевести» стоит на полосе home-индикатора и вместо
   *  перевода даёт системный свайп на домашний экран. */
  footer,
  /** Тело листа прокручивается. Нужно всем листам, где содержимое зависит от
   *  данных (8 счетов, 20 категорий): с поднятой клавиатурой лист упирается в
   *  свой потолок, и без прокрутки нижние строки просто недостижимы. Листы со
   *  своим списком внутри оставляют это выключенным. */
  scroll = false,
  scrollRef,
  /** Доля высоты экрана — потолок листа (контент выше скроллится внутри). */
  maxHeightRatio = 0.9,
  /** Показать «язычок» вверху (аффорданс листа). */
  grabber = true,
  /** ПЛАШКА ПОВЕРХ ЛИСТА, У ВЕРХНЕЙ КРОМКИ ЭКРАНА. Тост здесь бесполезен:
   *  он живёт в провайдере приложения, а лист — отдельное окно `Modal`, и
   *  плашка честно всплывала ПОД ним. Всё, что лист хочет сказать поверх
   *  себя, он передаёт сюда (см. `NoticeBar`). */
  banner,
  /** Внутри листа есть ввод: поднимать его над клавиатурой (на Android
   *  подъём включён у всех листов, см. ниже). RN Modal —
   *  отдельное окно, и подъём экрана под ним листу не достаётся, поэтому
   *  KeyboardAvoidingView нужен ЗДЕСЬ. flex:1 обязателен: без него лист
   *  вырастает на высоту клавиатуры и уезжает шапкой за верхний край. */
  avoidKeyboard = false,
  padded = true,
  headerAction,
  onExited,
  overlayIfStacked = false,
}: {
  visible: boolean;
  onClose: () => void;
  banner?: ReactNode;
  children: ReactNode;
  title?: string;
  /** Тихая строка под именем листа: чей это лист — команда, счёт, клиент.
   *  Такое подписывают, а не выбирают, и отдельной строкой-полем оно
   *  выглядело нажимаемым, хотя не нажимается (2026-09-09). */
  subtitle?: string;
  footer?: ReactNode;
  scroll?: boolean;
  /** ССЫЛКА НА ПРОКРУТКУ ТЕЛА (2026-08-21). Лист с таблицей обязан САМ
   *  доводить до глаза строку, которую только что добавили: она приезжает
   *  вниз, берёт автофокус, клавиатура поднимается — и строка оказывается ПОД
   *  клавиатурой, а команда «＋» снаружи выглядит не сделавшей ничего. То же с
   *  раскрытым барабаном на последней строке. */
  scrollRef?: RefObject<ScrollView | null>;
  maxHeightRatio?: number;
  grabber?: boolean;
  avoidKeyboard?: boolean;
  /** ЛИСТ САМ ПЛАТИТ БОКОВЫЕ ПОЛЯ. По умолчанию да — иначе каждая новая форма
   *  прилипает к краям листа (владелец 2026-08-17: «какого хуя оно всё слева
   *  слито»), и разработчик обязан помнить про отступ, которого не видно в
   *  коде. `false` — только для листов, которые пришли со своей раскладкой:
   *  списки строк во всю ширину и карточки, уже отбивающие себя сами. */
  padded?: boolean;
  /** ОПАСНОЕ ДЕЙСТВИЕ ЖИВЁТ В ШАПКЕ, А НЕ ВТОРОЙ КНОПКОЙ ВНИЗУ (владелец
   *  2026-08-18: «внизу строчка „удалить“ — там должна быть справа вверху
   *  мусорка, это гораздо лучше, чем сразу две кнопки внизу»). Внизу листа
   *  ровно ОДНА кнопка — та, ради которой лист открыли; «Удалить» под ней
   *  стояло вплотную к большому пальцу и читалось как второй равноправный
   *  выход. */
  headerAction?: ReactNode;
  /** ЛИСТ ПОЛНОСТЬЮ УШЁЛ: анимация закончилась и `Modal` снят. Только ПОСЛЕ
   *  этого можно показывать другое окно — второй лист или вопрос хоста.
   *  Таймер `SHEET_EXIT_MS` мерил анимацию, а не снятие окна, и «Удалить
   *  объект» из листа правки получал от iOS «already presenting» — вопрос не
   *  появлялся (2026-09-04). Кто открывает окно вслед за листом, ждёт этот
   *  сигнал, а не таймер. */
  onExited?: () => void;
  /** Открытый поверх другого листа — рисуется ВНУТРИ его окна, а не вторым
   *  окном (`sheet-overlay.tsx`). Лист выбора и вопроса. */
  overlayIfStacked?: boolean;
}) {
  const t = useThemeColors();
  const insets = useSafeAreaInsets();
  // ВЫСОТА ОКНА — ПРИ ПОКАЗЕ, А НЕ ПРИ ЗАГРУЗКЕ МОДУЛЯ (04.10). В браузере
  // вкладка, открытая «за кадром», грузит код при окне 0×0: константа
  // модуля давала `maxHeight: 0`, лист схлопывался, и строки уходили под
  // нижний край — выбрать язык на входе было нельзя.
  const { height: SCREEN_H } = useWindowDimensions();
  // Эффект входа/выхода читает её через ref: перезапуск анимации на каждый
  // поворот или ресайз окна не нужен.
  const screenH = useRef(SCREEN_H);
  screenH.current = SCREEN_H;
  const reduced = useReduceMotion();
  // Остаётся смонтированным на время анимации закрытия, потом снимается.
  const [mounted, setMounted] = useState(visible);

  // ЛИСТ УЕЗЖАЕТ С ТЕМ, ЧТО ПОКАЗЫВАЛ (краш 2026-10-03 02:22). Почти
  // три десятка листов открываются самим значением (`visible={x !== null}`) и
  // на закрытии получают null в ТОМ ЖЕ коммите, что и `visible=false`: тело
  // перестраивается — строки пропадают, на их место встаёт «пусто» — в
  // панели, которую в этот момент начинает уводить Reanimated. Так у шторки
  // выбора разошёлся порядок детей панели у UIKit и у Fabric, и снятие листа
  // уронило приложение («Attempt to unmount a view which has a different
  // index»). Пока лист уезжает, он показывает последний видимый кадр; живые
  // пропсы вернутся со следующим открытием. `useLastNonNull` делал то же для
  // четырёх листов клиентов — здесь это закон для всех.
  const live = { children, title, subtitle, footer, banner, headerAction };
  const lastShown = useRef(live);
  useLayoutEffect(() => {
    if (visible) lastShown.current = live;
  });
  const shown = visible ? live : lastShown.current;
  const exitedRef = useRef(onExited);
  exitedRef.current = onExited;
  const wasMounted = useRef(mounted);
  useEffect(() => {
    // Эффект идёт ПОСЛЕ коммита, в котором `Modal` уже снят с дерева, —
    // а без анимации UIKit убирает его окно тут же.
    if (wasMounted.current && !mounted) exitedRef.current?.();
    wasMounted.current = mounted;
  }, [mounted]);

  // ОКНО ПОВЕРХ ОКНА (`sheet-overlay.tsx`). Свой лист со своим окном стоит
  // в стопке, пока открыт; лист-накладка, открытый поверх другого, ложится в
  // его окно. Решение — в миг открытия и до закрытия.
  const [sheetId] = useState(newSheetId);
  const target = useRef<string | null>(null);
  const wasVisible = useRef(false);
  if (visible && !wasVisible.current) {
    const top = overlayIfStacked ? topSheet() : null;
    target.current = top && top !== sheetId ? top : null;
  }
  wasVisible.current = visible;
  const stackVersion = useSheetStackVersion();
  const asOverlay = target.current !== null;
  useEffect(() => {
    if (asOverlay || !mounted || !visible) {
      removeSheet(sheetId);
      return;
    }
    pushSheet(sheetId);
  }, [asOverlay, mounted, visible, sheetId]);
  useEffect(() => () => removeSheet(sheetId), [sheetId]);
  // Лист под накладкой закрылся — накладка закрывается «Отменой», а не
  // висит без окна.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const host = target.current;
    if (!host || !visible) return;
    if (!isSheetOpen(host)) closeRef.current();
  }, [stackVersion, visible]);

  useEffect(() => {
    if (visible) setMounted(true);
  }, [visible]);
  useEffect(() => {
    if (mounted) return;
    const host = target.current;
    if (host) clearOverlay(host);
    if (!visible) target.current = null;
  }, [mounted, visible]);

  // Enter/exit animation and the drag gesture; its effect runs after the two
  // above, in the same order as before the split.
  const { sheetH, scrimStyle, sheetStyle, drag } = useSheetMotion({
    mounted,
    visible,
    reduced,
    screenH,
    SCREEN_H,
    setMounted,
    onClose,
  });

  if (!mounted) return null;

  const sheet = (
    <Animated.View
      onLayout={(e) => {
        sheetH.value = e.nativeEvent.layout.height;
      }}
      accessibilityViewIsModal
      // Жест-escape VoiceOver: из попапа одиночного выбора иначе не
      // выйти вообще, не выбрав значение.
      onAccessibilityEscape={onClose}
      style={[
        {
          maxHeight: SCREEN_H * maxHeightRatio,
          // Верхний вырез — не место для листа: под клавиатурой высокий лист
          // дорастал грабером до самых часов. Маргин отдаёт эту полосу
          // обратно, а сжатие ложится на тело листа.
          marginTop: insets.top,
          // СЖИМАЕМАЯ панель: под клавиатурой KeyboardAvoidingView отдаёт
          // меньше высоты, и лист, растущий по контенту, уезжал шапкой и
          // грабером за верхний край. Сжатие ложится на тело листа (у него
          // flexShrink: 1), а шапка и футер остаются на месте.
          flexShrink: 1,
          borderTopLeftRadius: t.radius.card,
          borderTopRightRadius: t.radius.card,
          overflow: "hidden",
          backgroundColor: t.surface,
        },
        sheetStyle,
      ]}
    >
      {/* ШАПКА ЦЕЛИКОМ ТЯНЕТ ЛИСТ. Жест висел на одной полоске 36×5pt — это
          0,2% площади листа, и «свайп вниз» промахивался мимо неё почти
          всегда. Заголовок ничего не нажимает, поэтому конфликта нет, а
          площадь жеста вырастает до нормальной. */}
      {grabber || shown.title ? (
        <SheetHeader
          drag={drag}
          grabber={grabber}
          title={shown.title}
          subtitle={shown.subtitle}
          headerAction={shown.headerAction}
        />
      ) : null}
      {scroll ? (
        <ScrollView
          ref={scrollRef}
          // flexShrink, а не flex: тело сжимается под клавиатурой, но короткий
          // лист не растягивается на весь потолок.
          style={{ flexShrink: 1 }}
          contentContainerStyle={padded ? { paddingHorizontal: GUTTER } : undefined}
          keyboardShouldPersistTaps="handled"
        >
          {shown.children}
        </ScrollView>
      ) : padded ? (
        <View style={{ paddingHorizontal: GUTTER }}>{shown.children}</View>
      ) : (
        shown.children
      )}
      {shown.footer ? <SheetFooter padded={padded}>{shown.footer}</SheetFooter> : null}
    </Animated.View>
  );

  const layers = (
    <>
        <AnimatedPressable
          onPress={() => {
            haptics.tap();
            onClose();
          }}
          accessibilityRole="button"
          accessibilityLabel="Закрыть"
          style={[
            { position: "absolute", top: 0, bottom: 0, left: 0, right: 0 },
            { backgroundColor: t.scrim },
            scrimStyle,
          ]}
        />
        {/* ANDROID — ПОДЪЁМ У КАЖДОГО ЛИСТА (владелец 12.10: «на андроид
            шторка загораживает всё»). Сборка рисует окна во весь экран
            (edge-to-edge), и Android больше не сжимает окно под клавиатурой:
            лист с полями целиком уходил под неё вместе с кнопкой. Подъём
            безвреден листу без ввода — он срабатывает только с клавиатурой.
            На iOS — по флагу, как было. */}
        {avoidKeyboard || Platform.OS === "android" ? (
          <KeyboardLift
            style={{ flex: 1, justifyContent: "flex-end" }}
          >
            {sheet}
          </KeyboardLift>
        ) : (
          sheet
        )}
        {shown.banner ? (
          <View
            pointerEvents="box-none"
            style={{
              position: "absolute",
              top: insets.top + 8,
              left: 16,
              right: 16,
            }}
          >
            {shown.banner}
          </View>
        ) : null}
    </>
  );

  if (asOverlay) {
    return <OverlayLayers target={target.current as string} layers={layers} />;
  }

  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      {/* GestureHandlerRootView внутри Modal обязателен — иначе жест
          перетаскивания грабера не долетает (RN Modal — отдельное окно).
          style, не className: NativeWind v5 не красит компоненты-обёртки. */}
      <GestureHandlerRootView style={{ flex: 1, justifyContent: "flex-end" }}>
        {layers}
        {/* Место для вопроса или выбора поверх этого листа. */}
        <SheetOverlayOutlet id={sheetId} />
      </GestureHandlerRootView>
    </Modal>
  );
}

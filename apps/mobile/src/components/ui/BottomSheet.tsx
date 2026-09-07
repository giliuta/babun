import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import {
  Dimensions,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from "react-native-gesture-handler";
import Animated, {
  Easing,
  ReduceMotion,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { haptics } from "@/lib/haptics";
import { useKeyboardShown } from "@/lib/keyboard";
import { useThemeColors } from "@/theme/colors";
import { GUTTER } from "@/components/ui/tokens";
import { useReduceMotion } from "@/lib/reduce-motion";

// ─── Канонический нижний лист приложения ───────────────────────────────
// ЕДИНСТВЕННЫЙ способ показать выезжающую снизу панель. Заменяет собой
// самописные `Modal animationType="slide"`, которые тянули вверх ВЕСЬ модал
// вместе со скримом (серое затемнение «наползало» снизу — дёшево).
//
// Здесь скрим проявляется opacity-ом НА МЕСТЕ, а лист отдельно выезжает
// пружиной снизу и так же уезжает вниз. Всё гейтится на Reduce Motion.
// Правило: любой новый нижний лист = <BottomSheet>. См. DESIGN-SYSTEM.md.

const SCREEN_H = Dimensions.get("window").height;

// Пружина входа: почти критически задемпфирована — плавный «доводчик» без
// дешёвого пружинения. Выход — короткий ease-in вниз.
const SPRING = { damping: 28, stiffness: 300, mass: 1 } as const;

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
  /** Внутри листа есть ввод: поднимать его над клавиатурой. RN Modal —
   *  отдельное окно, и подъём экрана под ним листу не достаётся, поэтому
   *  KeyboardAvoidingView нужен ЗДЕСЬ. flex:1 обязателен: без него лист
   *  вырастает на высоту клавиатуры и уезжает шапкой за верхний край. */
  avoidKeyboard = false,
  padded = true,
  headerAction,
  onExited,
}: {
  visible: boolean;
  onClose: () => void;
  banner?: ReactNode;
  children: ReactNode;
  title?: string;
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
}) {
  const t = useThemeColors();
  const insets = useSafeAreaInsets();
  const reduced = useReduceMotion();
  // Остаётся смонтированным на время анимации закрытия, потом снимается.
  const [mounted, setMounted] = useState(visible);
  const exitedRef = useRef(onExited);
  exitedRef.current = onExited;
  const wasMounted = useRef(mounted);
  useEffect(() => {
    // Эффект идёт ПОСЛЕ коммита, в котором `Modal` уже снят с дерева, —
    // а без анимации UIKit убирает его окно тут же.
    if (wasMounted.current && !mounted) exitedRef.current?.();
    wasMounted.current = mounted;
  }, [mounted]);

  const ty = useSharedValue(SCREEN_H); // сдвиг листа вниз (0 = на месте)
  const scrim = useSharedValue(0); // прозрачность затемнения (0…1)
  const sheetH = useSharedValue(0); // измеренная высота листа

  useEffect(() => {
    if (visible) setMounted(true);
  }, [visible]);

  useEffect(() => {
    if (!mounted) return;
    if (visible) {
      // Вход: лист пружиной из-за нижнего края. Стартуем с ИЗМЕРЕННОЙ
      // высоты (фолбэк — экран): телепорт на весь экран делал вход и
      // выход несимметричными, вход «прилетал» из-под таб-бара.
      ty.value = sheetH.value > 0 ? sheetH.value : SCREEN_H;
      ty.value = reduced
        ? withTiming(0, { duration: 200, easing: Easing.out(Easing.quad) })
        : withSpring(0, SPRING);
      scrim.value = withTiming(1, {
        duration: reduced ? 200 : 260,
        easing: Easing.out(Easing.quad),
      });
    } else {
      // Выход: лист вниз на свою высоту, скрим гаснет; затем размонтируем.
      const target = sheetH.value > 0 ? sheetH.value : SCREEN_H;
      ty.value = withTiming(target, {
        duration: reduced ? 160 : 240,
        easing: Easing.in(Easing.cubic),
      });
      scrim.value = withTiming(
        0,
        // 240 — в такт листу (было 220, скрим гас раньше панели).
        { duration: reduced ? 160 : 240, easing: Easing.in(Easing.quad) },
        (fin) => {
          if (fin) runOnJS(setMounted)(false);
        },
      );
    }
  }, [mounted, visible, reduced, ty, scrim, sheetH]);

  const scrimStyle = useAnimatedStyle(() => ({ opacity: scrim.value }));
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: ty.value }],
  }));

  // Свайп вниз по граберу закрывает лист (грабер это и обещает). Жест
  // живёт только на верхней зоне — не конфликтует со скроллом тела.
  // Тянем лист за пальцем; отпустили за порогом (или рывком) — закрываем,
  // иначе пружиной возвращаем на место.
  const drag = Gesture.Pan()
    // Тянут лист вниз — клавиатура уходит первой. Иначе панель уползает ПОД
    // клавиатуру (отдельное окно выше приложения), палец идёт, а порог
    // закрытия не достигается: жест читается как сломанный.
    .onStart(() => {
      runOnJS(Keyboard.dismiss)();
    })
    .onChange((e) => {
      ty.value = Math.max(0, ty.value + e.changeY);
      // Скрим следует за пальцем: панель уезжала, а затемнение стояло
      // на месте до самого отпускания.
      const h = sheetH.value > 0 ? sheetH.value : SCREEN_H;
      scrim.value = Math.max(0, 1 - ty.value / h);
    })
    .onEnd((e) => {
      const h = sheetH.value > 0 ? sheetH.value : SCREEN_H;
      if (ty.value > h * 0.3 || e.velocityY > 800) {
        runOnJS(onClose)();
      } else {
        // Возврат за пальцем не должен телепортироваться при Reduce
        // Motion — это прямой отклик на жест, а не декорация.
        ty.value = withSpring(0, {
          ...SPRING,
          reduceMotion: ReduceMotion.Never,
        });
        scrim.value = withTiming(1, { duration: 160 });
      }
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
      {grabber || title ? (
        <GestureDetector gesture={drag}>
          <View>
            {grabber ? (
              <View className="items-center pb-1 pt-2.5">
                <View
                  style={{
                    width: 36,
                    height: 5,
                    borderRadius: 3,
                    // «Чёрное не серое»: separator на surface ~1.1:1 — жест
                    // обещан, а язычка не видно. Ink+alpha, как у системного.
                    backgroundColor: "rgba(11,18,32,0.14)",
                  }}
                />
              </View>
            ) : null}
            {title ? (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  paddingTop: grabber ? 4 : 12,
                  paddingBottom: 12,
                }}
              >
                {/* Заголовок остаётся ПО ЦЕНТРУ ЛИСТА: пустышка слева той же
                    ширины, что действие справа, иначе имя уезжает влево тем
                    сильнее, чем крупнее системный шрифт. */}
                <View style={{ width: 44 }} />
                <Text
                  accessibilityRole="header"
                  maxFontSizeMultiplier={1.2}
                  numberOfLines={1}
                  style={{
                    flex: 1,
                    fontSize: 17,
                    fontWeight: "600",
                    textAlign: "center",
                    color: t.ink,
                  }}
                >
                  {title}
                </Text>
                <View
                  style={{
                    width: 44,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {headerAction}
                </View>
              </View>
            ) : null}
          </View>
        </GestureDetector>
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
          {children}
        </ScrollView>
      ) : padded ? (
        <View style={{ paddingHorizontal: GUTTER }}>{children}</View>
      ) : (
        children
      )}
      {footer ? <SheetFooter padded={padded}>{footer}</SheetFooter> : null}
    </Animated.View>
  );

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
        {avoidKeyboard ? (
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={{ flex: 1, justifyContent: "flex-end" }}
          >
            {sheet}
          </KeyboardAvoidingView>
        ) : (
          sheet
        )}
        {banner ? (
          <View
            pointerEvents="box-none"
            style={{
              position: "absolute",
              top: insets.top + 8,
              left: 16,
              right: 16,
            }}
          >
            {banner}
          </View>
        ) : null}
      </GestureHandlerRootView>
    </Modal>
  );
}

/** Подвал листа — ЕДИНСТВЕННОЕ место, где лист платит нижний безопасный
 *  отступ. Отдельным компонентом, чтобы подписка на клавиатуру жила только у
 *  листов с подвалом: `BottomSheet` смонтирован у экрана всегда (закрытый он
 *  просто рисует null), и общий хук подписал бы на события клавиатуры все
 *  листы экрана разом.
 *
 *  Под клавиатурой отступ меньше: её кадр на iOS уже включает полосу
 *  home-индикатора, и обе высоты вместе давали ~34pt пустоты, которые потолок
 *  листа отбирал у содержимого. */
function SheetFooter({
  children,
  padded,
}: {
  children: ReactNode;
  padded?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const keyboardShown = useKeyboardShown();
  return (
    <View
      style={{
        paddingHorizontal: padded ? GUTTER : 0,
        paddingBottom: keyboardShown ? 12 : Math.max(insets.bottom, 16),
      }}
    >
      {children}
    </View>
  );
}

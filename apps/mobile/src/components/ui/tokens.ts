// Scheme-invariant UI tokens. COLOR lives exclusively in src/theme/colors.ts;
// the old static COLORS mirror was removed so the fixed light palette has one
// runtime source of truth.

// Lucide icon sizes — use these instead of scattered literals.
export const ICON = { lg: 24, md: 22, sm: 18, xs: 14 } as const;

// ГУТТЕР ЭКРАНА — ОДНО ЧИСЛО НА ПРОДУКТ (DS §3: «Screen gutter 16»).
// Жил двумя копиями по 12 — `GROUP_INSET` в card-rows и `mx-3` в SectionCard:
// документ обещал 16, а обе карточные примитивы рисовали 12. Отсюда же и
// «слишком ровный» экран счетов: узкое поле страницы прижимает карточку к
// краям и стирает разницу между полем СТРАНИЦЫ и полем ВНУТРИ карточки.
export const GUTTER = 16;

// ШКАЛА ТЕКСТА — ОДНА НА ПРОДУКТ (DS §2). Владелец 2026-09-10: «хотелось бы,
// чтобы вся CRM была в едином стиле, в едином шрифте, в единых количествах
// пикселей… если в календаре я сделаю что-то, то и в финансах, и в клиентах
// должно быть точно так же».
//
// Шкала была ЗАПИСАНА в `docs/DESIGN-SYSTEM.md` §2 и не соблюдалась: в коде
// жило ЧЕТЫРНАДЦАТЬ кеглей (9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 20, 24, 28,
// 34) в шестистах местах, а в токенах — одна строка, заголовок вкладки. Экраны
// от этого читались как соседи по случайности, а не как один продукт.
//
// Ролей семь, и выбирают их по СМЫСЛУ строки, а не по близости числа:
//
//   display  — заголовок корневого экрана, бренд входа, герой прибыли;
//   title    — заголовок шторки, вторичный герой;
//   headline — заголовок карточки, имя человека, заголовок пустого состояния;
//   callout  — ПЕРВАЯ строка строки-ряда и кнопки: так уже устроена
//              каноническая `SelectRow` (15/600), и её держит тест;
//   body     — поля ввода и вторые строки рядов;
//   subhead  — подписи, пояснения, ошибки под полем;
//   caption  — капс-шапки блоков и заголовки дней.
//
// МЕЖСТРОЧНЫЙ ИНТЕРВАЛ ЛЕЖИТ В РОЛИ НЕ ДЛЯ КРАСОТЫ: без него `TextInput` в
// этом стеке получает строку ниже кегля, и iOS срезает верх глифов — «€ 0»
// выходило как «€ ᴗ» (2026-09-10, держится тестом ловушек nativewind).
export const TYPE = {
  display: {
    fontSize: 34,
    lineHeight: 40,
    fontWeight: "800",
    letterSpacing: -0.6,
  },
  title: { fontSize: 26, lineHeight: 32, fontWeight: "700", letterSpacing: -0.4 },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: "600", letterSpacing: -0.2 },
  callout: { fontSize: 15, lineHeight: 20, fontWeight: "600" },
  body: { fontSize: 15, lineHeight: 20, fontWeight: "400", letterSpacing: -0.1 },
  subhead: { fontSize: 13, lineHeight: 18, fontWeight: "500" },
  caption: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "700",
    letterSpacing: 0.6,
  },
  /** ВОСЬМАЯ РОЛЬ, КОТОРОЙ НЕ БЫЛО В ДОКУМЕНТЕ: крупное число денег — поле
   *  суммы операции, долга и перевода. В продукте оно живёт с самого начала
   *  (28 и 30 в трёх местах), но в шкале его не было, и каждое поле выбирало
   *  свой кегль. Моноширинные цифры обязательны — только `fontVariant`. */
  money: { fontSize: 28, lineHeight: 36, fontWeight: "700" },
} as const;

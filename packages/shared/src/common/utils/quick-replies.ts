// Готовые ответы для переписки: три языка на шаблон (RU / EN / EL), нужный
// подставляется по последним входящим сообщениям.
//
// ТЕКСТ ЗДЕСЬ ОБЩИЙ ДЛЯ ВСЕХ ТЕНАНТОВ — И ПОЭТОМУ НЕ ЗНАЕТ НИ ОДНОГО ИЗ НИХ.
// Раньше знал: в шаблонах стояла подпись «AirFix», прайс на чистку
// кондиционера (€50, от трёх — €45) и список из четырёх кипрских городов. Это
// данные ОДНОЙ компании, а Babun продаётся многим — каждый новый тенант
// открывал переписку и видел чужое имя, чужие цены и чужую географию. Тот же
// урок уже стоил нам сида SMS-шаблонов (см. `local/sms-templates.ts`).
//
// Отсюда правило: в этот список попадает только то, что верно для ЛЮБОЙ
// выездной компании. Цена, зона выезда и название фирмы верны лишь для одной —
// их место в SMS-шаблонах тенанта, где он пишет текст сам.
//
// Порядка-поля у шаблона нет: список статический, порядок задаёт сам массив.

export type Lang = "ru" | "en" | "el";

export interface QuickReply {
  id: string;
  emoji: string;
  title: string;
  variants: { lang: Lang; text: string }[];
}

export function detectLanguage(texts: string[]): Lang {
  const sample = texts.join(" ").slice(0, 200);
  if (/[α-ωά-ώ]/i.test(sample)) return "el";
  if (/[а-яё]/i.test(sample)) return "ru";
  return "en";
}

export const QUICK_REPLIES: QuickReply[] = [
  {
    id: "qr-greeting",
    emoji: "👋",
    title: "Приветствие",
    variants: [
      { lang: "ru", text: "Добрый день! Чем могу помочь?" },
      { lang: "en", text: "Hello! How can I help you?" },
      { lang: "el", text: "Γεια σας! Πώς μπορώ να σας βοηθήσω;" },
    ],
  },
  {
    // Цена и зона выезда у каждой компании свои, поэтому здесь ПРОПУСК, а не
    // число: тап вставляет заготовку в поле ввода, человек дописывает своё и
    // отправляет. Кнопку убирать нельзя — ей пользуются каждый день; убрать
    // надо было только чужой прайс, который тут стоял.
    id: "qr-price",
    emoji: "💰",
    title: "Цена",
    variants: [
      { lang: "ru", text: "Стоимость работы — €…. Точную сумму назову после осмотра." },
      { lang: "en", text: "The cost of the work is €…. I will confirm the exact amount after we take a look." },
      { lang: "el", text: "Το κόστος της εργασίας είναι €…. Θα επιβεβαιώσω το ακριβές ποσό μετά τον έλεγχο." },
    ],
  },
  {
    id: "qr-address",
    emoji: "📍",
    title: "Запрос адреса",
    variants: [
      { lang: "ru", text: "Подскажите, пожалуйста, ваш адрес и удобное время для визита мастера?" },
      { lang: "en", text: "Could you please share your address and a convenient time for our technician to visit?" },
      { lang: "el", text: "Μπορείτε να μας δώσετε τη διεύθυνσή σας και μια βολική ώρα για επίσκεψη του τεχνικού;" },
    ],
  },
  {
    id: "qr-confirm",
    emoji: "✅",
    title: "Подтверждение визита",
    variants: [
      { lang: "ru", text: "Отлично! Мастер будет у вас в назначенное время. Пожалуйста, обеспечьте доступ к объекту." },
      { lang: "en", text: "Great! Our technician will arrive at the scheduled time. Please make sure we can get access on site." },
      { lang: "el", text: "Τέλεια! Ο τεχνικός μας θα φτάσει την προγραμματισμένη ώρα. Παρακαλώ φροντίστε να έχουμε πρόσβαση στον χώρο." },
    ],
  },
  {
    id: "qr-reschedule",
    emoji: "🕐",
    title: "Перенос визита",
    variants: [
      { lang: "ru", text: "К сожалению, нам нужно перенести визит. Какая дата и время вам подойдут?" },
      { lang: "en", text: "Unfortunately, we need to reschedule the visit. What date and time would work for you?" },
      { lang: "el", text: "Δυστυχώς, πρέπει να αναβάλουμε την επίσκεψη. Ποια ημερομηνία και ώρα σας βολεύει;" },
    ],
  },
  {
    // Тот же приём, что у цены: список городов был кипрский, а компания может
    // работать где угодно. Пропуск заполняет тот, кто отвечает.
    id: "qr-areas",
    emoji: "🌍",
    title: "Районы обслуживания",
    variants: [
      { lang: "ru", text: "Мы обслуживаем …. Скажите ваш район — подскажу, выезжаем ли туда." },
      { lang: "en", text: "We cover …. Tell me your area and I will check whether we come out there." },
      { lang: "el", text: "Καλύπτουμε …. Πείτε μου την περιοχή σας και θα ελέγξω αν εξυπηρετούμε εκεί." },
    ],
  },
  {
    id: "qr-review",
    emoji: "⭐",
    title: "Просьба об отзыве",
    variants: [
      { lang: "ru", text: "Спасибо, что выбрали нас! Будем очень благодарны за отзыв на Google Maps — это помогает нам становиться лучше." },
      { lang: "en", text: "Thank you for choosing us! We would really appreciate a review on Google Maps — it helps us improve." },
      { lang: "el", text: "Σας ευχαριστούμε που μας επιλέξατε! Θα εκτιμούσαμε πολύ μια κριτική στο Google Maps — μας βοηθά να βελτιωθούμε." },
    ],
  },
];

// Multilingual quick reply templates. Each template has variants
// for RU, EN, EL (Greek). Auto-detection picks the right tab
// based on the last few inbound messages in the chat.

export type Lang = "ru" | "en" | "el";

export const LANG_LABELS: Record<Lang, string> = {
  ru: "RU",
  en: "EN",
  el: "EL",
};

export interface QuickReply {
  id: string;
  emoji: string;
  title: string;
  variants: { lang: Lang; text: string }[];
  sort_order: number;
}

export function detectLanguage(texts: string[]): Lang {
  const sample = texts.join(" ").slice(0, 200);
  if (/[α-ωά-ώ]/i.test(sample)) return "el";
  if (/[а-яё]/i.test(sample)) return "ru";
  return "en";
}

export const QUICK_REPLIES: QuickReply[] = [
  {
    id: "qr-1",
    emoji: "👋",
    title: "Приветствие",
    variants: [
      { lang: "ru", text: "Добрый день! Чем могу помочь?" },
      { lang: "en", text: "Hello! How can I help you?" },
      { lang: "el", text: "Γεια σας! Πώς μπορώ να σας βοηθήσω;" },
    ],
    sort_order: 1,
  },
  {
    id: "qr-2",
    emoji: "💰",
    title: "Цена чистки",
    variants: [
      { lang: "ru", text: "Стоимость чистки кондиционера: €50 за единицу. При заказе от 3 единиц — €45/шт." },
      { lang: "en", text: "AC cleaning cost: €50 per unit. From 3 units — €45 each." },
      { lang: "el", text: "Κόστος καθαρισμού κλιματιστικού: €50 ανά μονάδα. Από 3 μονάδες — €45 η κάθε μία." },
    ],
    sort_order: 2,
  },
  {
    id: "qr-3",
    emoji: "📍",
    title: "Запрос адреса",
    variants: [
      { lang: "ru", text: "Подскажите, пожалуйста, ваш адрес и удобное время для визита мастера?" },
      { lang: "en", text: "Could you please share your address and a convenient time for our technician to visit?" },
      { lang: "el", text: "Μπορείτε να μας δώσετε τη διεύθυνσή σας και μια βολική ώρα για επίσκεψη του τεχνικού;" },
    ],
    sort_order: 3,
  },
  {
    id: "qr-4",
    emoji: "✅",
    title: "Подтверждение визита",
    variants: [
      { lang: "ru", text: "Отлично! Мастер будет у вас в назначенное время. Пожалуйста, обеспечьте доступ к кондиционерам." },
      { lang: "en", text: "Great! Our technician will arrive at the scheduled time. Please ensure access to the AC units." },
      { lang: "el", text: "Τέλεια! Ο τεχνικός μας θα φτάσει την προγραμματισμένη ώρα. Παρακαλώ εξασφαλίστε πρόσβαση στα κλιματιστικά." },
    ],
    sort_order: 4,
  },
  {
    id: "qr-5",
    emoji: "🕐",
    title: "Перенос визита",
    variants: [
      { lang: "ru", text: "К сожалению, нам нужно перенести визит. Какая дата и время вам подойдут?" },
      { lang: "en", text: "Unfortunately, we need to reschedule the visit. What date and time would work for you?" },
      { lang: "el", text: "Δυστυχώς, πρέπει να αναβάλουμε την επίσκεψη. Ποια ημερομηνία και ώρα σας βολεύει;" },
    ],
    sort_order: 5,
  },
  {
    id: "qr-6",
    emoji: "🌍",
    title: "Районы обслуживания",
    variants: [
      { lang: "ru", text: "Мы обслуживаем Лимассол, Пафос, Ларнаку и Никосию." },
      { lang: "en", text: "We cover Limassol, Paphos, Larnaca, and Nicosia." },
      { lang: "el", text: "Καλύπτουμε Λεμεσό, Πάφο, Λάρνακα και Λευκωσία." },
    ],
    sort_order: 6,
  },
  {
    id: "qr-7",
    emoji: "⭐",
    title: "Просьба об отзыве",
    variants: [
      { lang: "ru", text: "Спасибо что выбрали AirFix! Будем очень благодарны за отзыв на Google Maps — это помогает нам становиться лучше." },
      { lang: "en", text: "Thank you for choosing AirFix! We would really appreciate a review on Google Maps — it helps us improve." },
      { lang: "el", text: "Σας ευχαριστούμε που επιλέξατε την AirFix! Θα εκτιμούσαμε πολύ μια κριτική στο Google Maps — μας βοηθά να βελτιωθούμε." },
    ],
    sort_order: 7,
  },
];

// ЧЕРНИЛА БУМАГИ — ОДНИ НА ВСЕ ДОКУМЕНТЫ.
//
// Документ белый всегда, поэтому палитра у него своя, а не темы экрана. Но
// своя — ОДНА: инвойс печатался серыми Tailwind (#374151/#6b7280/#e5e7eb), а
// чек — сине-серыми (#64748b/#e2e8f0), и два документа одной компании
// выглядели напечатанными в разных типографиях. Отсюда берут цвета все четыре
// рендера: экранные `InvoicePaper` и `ReceiptPaper` и их PDF (`pdf.ts`,
// `receipt-pdf.ts`). Сторож — `paper-palette.test.ts`.
export const PAPER = {
  ink: "#111827",
  body: "#334155",
  muted: "#64748b",
  faint: "#94a3b8",
  border: "#e2e8f0",
  line: "#e8edf3",
  fill: "#f6f8fb",
  ruleStrong: "#cbd5e1",
  ruleDashed: "#d9e0e9",
  green: "#047857",
  red: "#b42318",
  white: "#ffffff",
} as const;

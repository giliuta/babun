// ЯЗЫК БУМАГИ ПИШЕТСЯ ВТОРЫМ ШАГОМ, ПОСЛЕ ДОКУМЕНТА, И НЕ ВАЛИТ ЕГО. Две
// попытки — на случай одного моргания сети; «записан» значит, что
// `setInvoiceLanguage` сверил строку после записи, а не просто не получил
// ошибку. `false` — язык остался прежним, и экран обязан об этом сказать.

const RETRY_PAUSE_MS = 800;

export async function persistInvoiceLanguage(
  write: () => Promise<void>,
  pause: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await write();
      return true;
    } catch {
      if (attempt === 0) await pause(RETRY_PAUSE_MS);
    }
  }
  return false;
}

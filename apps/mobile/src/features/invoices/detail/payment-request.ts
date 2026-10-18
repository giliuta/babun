import { InvoicePaymentAlreadyRecordedError } from "@babun/shared/db/repositories/invoice-payments";

// ОДИН ПЛАТЁЖ — ОДИН ID, ПОКА ОН НЕ ЗАПИСАН. Сервер узнаёт повтор по id
// (`record_invoice_payment`): тот же id с теми же данными отдаёт уже
// записанный платёж, с другими — отказывает «уже использован». Поэтому id
// держится через любые сбои, закрытия листа и правки суммы: если первая
// попытка дошла, сервер это скажет, если нет — запишет эту. Новый id нужен
// только когда прежний точно израсходован: платёж записан или сервер узнал
// его в повторе с другими данными.

/** Отправить платёж текущим id из `holder`; сменить id, когда он израсходован. */
export async function sendPayment(
  holder: { current: string },
  send: (requestId: string) => Promise<void>,
  freshId: () => string,
): Promise<void> {
  try {
    await send(holder.current);
  } catch (error) {
    if (error instanceof InvoicePaymentAlreadyRecordedError) holder.current = freshId();
    throw error;
  }
  holder.current = freshId();
}

import { Share, Text, View } from "react-native";
import { money } from "@babun/shared/common/utils/money";
import { paymentMethodLabel } from "@babun/shared/local/finance/transaction";
import { receiptClientName, type Receipt } from "@babun/shared/local/finance/receipt";
import type { Appointment } from "@babun/shared/local/appointments";
import { BottomSheet, SHEET_EXIT_MS } from "@/components/ui/BottomSheet";
import { GradientButton } from "@/components/ui/GradientButton";
import { NavRow, RowGroupBody } from "@/components/ui/card-rows";
import { useThemeColors } from "@/theme/colors";
import { humanDay } from "@/features/appointments/helpers";
import { buildReceiptShareText } from "./receipt-text";
import { notify } from "@/lib/notify";

// ЧЕК ОТКРЫВАЕТСЯ ЛИСТОМ, А НЕ ЭКРАНОМ (владелец 2026-08-12: «если я нажимаю
// на чек — там полностью вся информация, запись, клиент… напрямую на клиента
// можно выйти»; и там же: «не надо делать лишние страницы»).
//
// Лист — потому что чек ПОКАЗЫВАЮТ, а не правят: документ неизменяем, править
// в нём нечего, и уходить с ленты чеков ради двух строк незачем.
//
// Строки внутри — двери: клиент, запись, инвойс, счёт. Это и есть «вся
// информация»: не пересказ чека, а дорога к тому, за что он выдан.
export function ReceiptSheet({
  receipt,
  appointment,
  accountName,
  onClose,
  onOpen,
}: {
  /** null — листа нет вовсе (он не «пустой», а не открыт). */
  receipt: Receipt | null;
  /** Запись, за которую выдан чек, если она в загруженном срезе. Не нашли —
   *  строка молчит: соврать «записи нет» хуже, чем не сказать ничего. */
  appointment: Appointment | null;
  /** Имя счёта, на который легли деньги. */
  accountName: string | null;
  onClose: () => void;
  /** Уводит с экрана. Лист сначала уезжает — иначе новый экран откроется
   *  ПОД модалом и человек увидит тот же чек. */
  onOpen: (href: string) => void;
}) {
  const t = useThemeColors();
  if (!receipt) return null;

  const r = receipt;
  const dead = r.status === "void";
  const clientName = receiptClientName(r);

  const leave = (href: string) => {
    onClose();
    setTimeout(() => onOpen(href), SHEET_EXIT_MS);
  };

  const send = async () => {
    onClose();
    // Системный шит «Поделиться» — тоже модал: пока наш лист уезжает, он не
    // появится вовсе (та же причина, что у навигации выше).
    setTimeout(() => {
      void Share.share({
        message: buildReceiptShareText({ receipt: r, clientName }),
      }).catch((error: unknown) =>
        notify("Не удалось выслать чек", (error as Error).message),
      );
    }, SHEET_EXIT_MS);
  };

  return (
    <BottomSheet
      padded={false}
      visible
      onClose={onClose}
      title={`Чек ${r.number}`}
      scroll
      footer={
        // «ВЫСЛАТЬ ЧЕК» ЖИВЁТ ЗДЕСЬ, А НЕ НА ЭКРАНЕ. Выслать можно только
        // конкретный чек — кнопка внизу списка не знала бы, какой именно.
        dead ? null : <GradientButton label="Выслать чек" onPress={send} />
      }
    >
      <View className="items-center px-4 pb-3 pt-1">
        <Text
          className="text-[34px] font-bold"
          style={{ color: dead ? t.sub : t.ink, fontVariant: ["tabular-nums"] }}
        >
          {money(r.amount, r.currency)}
        </Text>
        {/* НДС отдельной строкой: это не выручка компании, а чужие деньги
            внутри полученной суммы. */}
        {r.vat_amount ? (
          <Text className="mt-0.5 text-[13px]" style={{ color: t.sub }}>
            в т.ч. НДС {money(r.vat_amount, r.currency)}
          </Text>
        ) : null}
        {dead ? (
          // «Аннулирован», как у инвойса: «погашен» в финансах значит
          // «оплачен» — то есть противоположное случившемуся.
          <Text
            className="mt-2 text-[13px] font-semibold"
            style={{ color: t.danger }}
          >
            Аннулирован — деньги вернули клиенту
          </Text>
        ) : null}
      </View>

      <View className="px-4 pb-2">
        <RowGroupBody first last>
          <NavRow label="Выдан" value={humanDay(r.issued_on)} />
          {r.payment_method ? (
            <NavRow
              label="Оплата"
              value={paymentMethodLabel(r.payment_method)}
              separated
            />
          ) : null}
          {accountName ? (
            <NavRow label="Счёт" value={accountName} separated />
          ) : null}
          <NavRow
            label="Клиент"
            value={clientName}
            separated
            // Дверь только к живой карточке: у чека может не быть client_id
            // (анонимный приём денег), и тогда строка — просто имя из снимка.
            onPress={
              r.client_id ? () => leave(`/clients/${r.client_id}`) : undefined
            }
          />
          {appointment ? (
            <NavRow
              label="Запись"
              value={`${humanDay(appointment.date)}, ${appointment.time_start}`}
              separated
              // Тот же адрес, которым запись открывают из ленты денег:
              // календарь сам встаёт на её день и команду, а `from` — дорога
              // назад: лист живёт во вкладке «Финансы», и закрыв запись,
              // человек возвращается к документам, а не остаётся в календаре
              // (вкладки НЕ стек, владелец 2026-08-15).
              onPress={() =>
                leave(
                  `/(dashboard)?appointmentId=${appointment.id}&date=${appointment.date}` +
                    (appointment.team_id ? `&teamId=${appointment.team_id}` : "") +
                    "&from=finances",
                )
              }
            />
          ) : null}
          {r.invoice_id ? (
            <NavRow
              label="Инвойс"
              value="Открыть"
              separated
              onPress={() => leave(`/invoices/${r.invoice_id}`)}
            />
          ) : null}
        </RowGroupBody>
      </View>
    </BottomSheet>
  );
}

// МЕССЕНДЖЕРЫ — Telegram · Instagram · WhatsApp-номер.
//
// Три поля, которые принадлежат ЧЕЛОВЕКУ, а не номеру: @username в Telegram и
// Instagram и отдельный номер, если WhatsApp у клиента не на основном номере.
// Всё остальное, что раньше жило в «Контактах» — основной телефон и
// дополнительные номера — переехало в блок идентичности, к имени: второй
// номер нужен там же, где первый.
//
// Переведён на ЗАКОН СТРОКИ (2026-07-26): те же строки, что имя и телефон,
// вместо серых пилюль-инпутов со своими иконками и кнопками «Открыть» внутри
// сворачиваемой карточки. Кнопок «Открыть» здесь больше нет: связаться —
// это кнопка в хвосте строки НОМЕРА (PhoneChannelButton), и второй путь к
// тому же действию был лишним шумом.

import type { Client } from "@babun/shared/local/clients";
import { FieldRow, RowGroup } from "@/features/clients/card-rows";

interface ContactsBlockProps {
  client: Client;
  update: (patch: Partial<Client>) => void;
  /** Черновик: пишем на каждый символ — «Готово» читает черновик. */
  draft?: boolean;
}

/** @username хранится без «собачки»: её рисует поле, а не данные. */
const stripAt = (v: string) => v.trim().replace(/^@+/, "");

export default function ContactsBlock({
  client,
  update,
  draft,
}: ContactsBlockProps) {
  const tg = stripAt(client.telegram_username ?? "");
  const ig = stripAt(client.instagram_username ?? "");

  return (
    <RowGroup title="Мессенджеры">
      <FieldRow
        label="Telegram"
        value={tg ? `@${tg}` : ""}
        placeholder="@username"
        stacked
        live={draft}
        onSave={(v) => update({ telegram_username: stripAt(v) })}
      />
      <FieldRow
        label="Instagram"
        value={ig ? `@${ig}` : ""}
        placeholder="@username"
        separated
        stacked
        live={draft}
        onSave={(v) => update({ instagram_username: stripAt(v) })}
      />
      {/* Отдельный номер WhatsApp — только если он ОТЛИЧАЕТСЯ от основного;
          пустое поле означает «WhatsApp на основном номере». */}
      <FieldRow
        label="WhatsApp, если номер другой"
        value={client.whatsapp_phone}
        placeholder="Номер"
        separated
        stacked
        tabular
        keyboardType="phone-pad"
        live={draft}
        onSave={(v) => update({ whatsapp_phone: v })}
      />
    </RowGroup>
  );
}

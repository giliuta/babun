import { useState } from "react";
import type { Appointment } from "@babun/shared/local/appointments";
import type { Client, ClientTag } from "@babun/shared/local/clients";
import type { ClientStats } from "@babun/shared/local/selectors/client-stats";
import ObjectsBlock from "@/features/clients/blocks/ObjectsBlock";
import { ObjectSheet } from "@/features/clients/ObjectSheet";
import VisitsMoneyBlock from "@/features/clients/blocks/VisitsMoneyBlock";
import AttachmentsBlock from "@/features/clients/blocks/AttachmentsBlock";
import NotesBlock from "@/features/clients/blocks/NotesBlock";
import { PersonalBlock } from "@/features/clients/blocks/PersonalBlock";
import { NavRow, RowCaption, RowGroup } from "@/features/clients/card-rows";

/** Что уже заполнено «под капотом» — чтобы строка «Ещё» не была немой. */
function extrasSummary(client: Client): string | null {
  const parts = [
    client.telegram_username?.trim() ? "Telegram" : null,
    client.instagram_username?.trim() ? "Instagram" : null,
    client.whatsapp_phone?.trim() ? "WhatsApp" : null,
    client.email?.trim() ? "почта" : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}

interface ClientProfileBlocksProps {
  client: Client;
  draft: boolean;
  appointments: Appointment[];
  services: readonly { id: string; name: string }[];
  tags: ClientTag[];
  stats: ClientStats | undefined;
  update: (patch: Partial<Client>) => Promise<boolean>;
  /** Открыть страницу объекта. Навигацию держит карточка: в черновике клиента
   *  она сначала сохраняет клиента — pushed-страница не видит несохранённого
   *  черновика. Создание сюда больше не ходит: оно живёт в листе. */
  onOpenObject: (locId: string) => void;
  /** Открыть «Ещё» — мессенджеры, почта, источник. */
  onOpenExtras: () => void;
}

export function ClientProfileBlocks({
  client,
  draft,
  appointments,
  services,
  tags,
  stats,
  update,
  onOpenObject,
  onOpenExtras,
}: ClientProfileBlocksProps) {
  const [objectsOpen, setObjectsOpen] = useState(false);
  return (
    <>
      {/* Владелец 2026-07-25: содержательные заметки принадлежат ЗАЯВКЕ, а
          не клиенту — «что делали/что сказали» относится к конкретному
          выезду. На карточке остаётся только лёгкий признак «что это за
          клиент», поэтому блок уехал со второго места в самый низ, под
          справочные блоки. Сам журнал пока не трогаем: в нём лежат
          реальные записи, и удалять их до появления поля заметки в заявке
          нельзя. */}
      <ObjectsBlock
        client={client}
        onOpen={onOpenObject}
        onAdd={() => setObjectsOpen(true)}
      />
      {/* Добавление объекта — лист снизу (владелец 2026-07-27). Живёт рядом с
          блоком, а не в карточке: кроме открытия у карточки к нему дел нет. */}
      <ObjectSheet
        visible={objectsOpen}
        client={client}
        update={update}
        onClose={() => setObjectsOpen(false)}
      />

      {/* СОЗДАНИЕ ПОКАЗЫВАЕТ ВСЮ СТРАНИЦУ (владелец 2026-07-26: «страница
          должна показываться сразу — добавить клиента открывается чётко вся
          страница, как будет выглядеть в будущем»). Раньше в черновике
          рисовались только объекты и заметка, и человек не видел, куда
          вообще денутся Telegram, метка или день рождения.
          Каждое поле этих блоков проходит белый список create_client_with_tags
          (phones, locations, notes, city, birthday, language, telegram/
          instagram/whatsapp) — то есть в черновике они пишут в тот же объект,
          который уедет в базу по «Готово», а не в пустоту.
          «Визиты и деньги» скрывает себя сам, пока визитов и долга нет: у
          нового клиента их нет по определению, и у сохранённого без визитов
          страница выглядит точно так же. */}
      <VisitsMoneyBlock clientId={client.id} appointments={appointments} />
      {/* Фото — единственное, что физически нельзя приложить до сохранения:
          путь в хранилище строится по id клиента, которого ещё нет. Рисовать
          пригашенную кнопку «нельзя» = мёртвый контрол. */}
      {!draft ? <AttachmentsBlock clientId={client.id} /> : null}
      <PersonalBlock client={client} update={update} tags={tags} />
      <NotesBlock client={client} update={update} />
      {/* «Ещё» — мессенджеры, почта, источник. Владелец 2026-07-26: они
          будут подтягиваться из чата сами, вписывать их каждый день никто не
          будет, поэтому на карточке им не место — но вписать руками можно.
          В черновике страницы ещё нет: она читает клиента по id. */}
      {!draft ? (
        <RowGroup>
          <NavRow
            label="Ещё"
            value={extrasSummary(client)}
            placeholder="мессенджеры, почта, источник"
            onPress={onOpenExtras}
          />
        </RowGroup>
      ) : null}
      {client.blacklisted ? (
        <RowCaption tone="danger" text="Клиент в чёрном списке." />
      ) : null}
    </>
  );
}

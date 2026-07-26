import type { Appointment } from "@babun/shared/local/appointments";
import type { Client, ClientTag } from "@babun/shared/local/clients";
import type { ClientStats } from "@babun/shared/local/selectors/client-stats";
import ObjectsBlock from "@/features/clients/blocks/ObjectsBlock";
import VisitsMoneyBlock from "@/features/clients/blocks/VisitsMoneyBlock";
import AttachmentsBlock from "@/features/clients/blocks/AttachmentsBlock";
import ContactsBlock from "@/features/clients/blocks/ContactsBlock";
import NotesBlock from "@/features/clients/blocks/NotesBlock";
import { PersonalBlock } from "@/features/clients/blocks/PersonalBlock";
import { MetaBlock } from "@/features/clients/blocks/MetaBlock";

interface ClientProfileBlocksProps {
  client: Client;
  draft: boolean;
  appointments: Appointment[];
  services: readonly { id: string; name: string }[];
  tags: ClientTag[];
  stats: ClientStats | undefined;
  update: (patch: Partial<Client>) => Promise<boolean>;
  /** Открыть объект или создать новый ("new"). Навигацию держит карточка:
   *  в черновике клиента она сначала сохраняет клиента — pushed-страница не
   *  видит несохранённого черновика. */
  onOpenObject: (locId: string) => void;
  /** В черновике: клиента уже можно сохранить, значит и объект можно завести. */
  canAddObject?: boolean;
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
  canAddObject,
}: ClientProfileBlocksProps) {
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
        addDimmed={draft && !canAddObject}
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
      <VisitsMoneyBlock
        appointments={appointments}
        services={services}
        stats={stats}
      />
      {/* Фото — единственное, что физически нельзя приложить до сохранения:
          путь в хранилище строится по id клиента, которого ещё нет. Рисовать
          пригашенную кнопку «нельзя» = мёртвый контрол. */}
      {!draft ? <AttachmentsBlock clientId={client.id} /> : null}
      <ContactsBlock client={client} update={update} draft={draft} />
      <PersonalBlock client={client} update={update} draft={draft} />
      {/* draft прокидывается ОБЯЗАТЕЛЬНО: без него блок писал «В базе с …» о
          клиенте, которого ещё нет. */}
      <MetaBlock client={client} update={update} tags={tags} draft={draft} />
      <NotesBlock client={client} update={update} />
    </>
  );
}

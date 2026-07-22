import type { Appointment } from "@babun/shared/local/appointments";
import type { Client, ClientTag } from "@babun/shared/local/clients";
import type { ClientStats } from "@babun/shared/local/selectors/client-stats";
import ObjectsBlock from "@/features/clients/blocks/ObjectsBlock";
import VisitsBlock from "@/features/clients/blocks/VisitsBlock";
import FinanceBlock from "@/features/clients/blocks/FinanceBlock";
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
}

export function ClientProfileBlocks({
  client,
  draft,
  appointments,
  services,
  tags,
  stats,
  update,
}: ClientProfileBlocksProps) {
  return (
    <>
      <ObjectsBlock
        client={client}
        appointments={appointments}
        stats={stats}
        update={update}
      />
      <NotesBlock client={client} update={update} />

      {draft ? (
        <>
          <ContactsBlock client={client} update={update} hidePrimaryPhone />
          <PersonalBlock client={client} update={update} />
          <MetaBlock client={client} update={update} tags={tags} draft />
        </>
      ) : (
        <>
          <VisitsBlock appointments={appointments} services={services} stats={stats} />
          <FinanceBlock clientId={client.id} appointments={appointments} stats={stats} />
          <AttachmentsBlock clientId={client.id} />
          <ContactsBlock client={client} update={update} />
          <PersonalBlock client={client} update={update} />
          <MetaBlock client={client} update={update} tags={tags} />
        </>
      )}
    </>
  );
}

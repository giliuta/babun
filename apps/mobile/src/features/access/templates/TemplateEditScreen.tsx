import { useState } from "react";

import { FieldRow } from "@/components/ui/card-rows";
import { SectionCard } from "@/components/ui/SectionCard";
import { useToast } from "@/components/ui/Toast";
import { haptics } from "@/lib/haptics";

import type { AccessBlock, AccessLevel } from "../access-map";
import { MasterRightsView } from "../master-page/MasterRightsView";
import { RightsPlaceholder } from "../master-page/rights-page-shared";
import { levelChanges } from "../master-page/rights-rows";
import { useAccessBlocks } from "../queries";
import { useAccessTemplates, useUpdateTemplate } from "./queries";
import { templateLevel, withTemplateChanges } from "./templates";

// ШАБЛОН ДОСТУПА — ТА ЖЕ СТРАНИЦА, ЧТО ПРАВА КОМАНДЫ (владелец 29.09;
// AGENTS «одна сущность — одно тело»): «Итог», блоки «Календарь · Запись ·
// Финансы · Клиенты», строка — право и его ступень, тап — шторка с видом
// блока. Сверху — имя шаблона. Ступень пишется сразу, как права человека;
// кнопки «Сохранить» нет.

/** Календарь шаблона: у шаблона его нет, строки команды живут под этим id. */
const TEMPLATE_TEAM = "template";

const noop = () => {};

export function TemplateEditScreen({ id, onBack }: { id: string; onBack: () => void }) {
  const toast = useToast();
  const blocksQuery = useAccessBlocks({ fresh: true });
  const templatesQuery = useAccessTemplates();
  const update = useUpdateTemplate();
  // Шаблон пишется целым набором положений: две записи в полёте могли бы
  // прийти на сервер наоборот, и вторая затёрла бы первую. Пока одна
  // сохраняется, строки и шторка отказывают коротким тиком.
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const template = templatesQuery.data?.find((t) => t.id === id) ?? null;
  const blocks = blocksQuery.data;

  if (blocksQuery.isError || templatesQuery.isError) {
    return (
      <RightsPlaceholder
        onBack={onBack}
        error
        title="Не удалось загрузить шаблон"
        onRetry={() => {
          void blocksQuery.refetch();
          void templatesQuery.refetch();
        }}
      />
    );
  }
  if (!blocks || !templatesQuery.data) return <RightsPlaceholder onBack={onBack} />;
  if (!template) return <RightsPlaceholder onBack={onBack} title="Шаблона больше нет" />;

  const fail = (error: Error) => toast(error.message || "Не удалось сохранить шаблон", "error");

  return (
    <MasterRightsView
      title={template.name}
      subtitle="Шаблон доступа"
      onBack={onBack}
      blocks={blocks}
      teams={[]}
      teamIds={[TEMPLATE_TEAM]}
      activeTeamId={TEMPLATE_TEAM}
      onSelectTeam={noop}
      onlyCalendar
      busyKey={savingKey}
      levelOf={(block: AccessBlock) => templateLevel(template, block)}
      onPick={(block: AccessBlock, level: AccessLevel) => {
        const changes = levelChanges(blocks, block, level, TEMPLATE_TEAM);
        if (!changes) return;
        setSavingKey(block.key);
        update.mutate(
          { id, levels: withTemplateChanges(template, changes) },
          { onError: fail, onSettled: () => setSavingKey(null) },
        );
      }}
      top={
        <SectionCard title="Шаблон" padded={false}>
          <FieldRow
            stacked
            hideLabel
            big
            label="Имя шаблона"
            placeholder="Имя шаблона"
            value={template.name}
            autoCapitalize="sentences"
            onSave={(value) => {
              const name = value.trim();
              if (name === template.name) return;
              if (!name) {
                haptics.warning();
                toast("Имя обязательно", "error");
                return;
              }
              update.mutate({ id, name: name.slice(0, 60) }, { onError: fail });
            }}
          />
        </SectionCard>
      }
    />
  );
}

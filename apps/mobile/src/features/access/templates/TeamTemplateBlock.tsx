import { useRouter, type Href } from "expo-router";

import { NavRow } from "@/components/ui/card-rows";
import { SectionCard } from "@/components/ui/SectionCard";
import { chooseOption } from "@/lib/choose";
import { useThemeColors } from "@/theme/colors";

import type { AccessBlock, AccessLevel } from "../access-map";
import { useAccessTemplates } from "./queries";
import { matchedTemplate, type AccessTemplate } from "./templates";

// СТРОКА «ШАБЛОН» НАД ПРАВАМИ КОМАНДЫ (владелец 29.09: «давать разрешение
// точечно… с шаблонами»). Говорит, по какому шаблону стоят права в этой
// команде, или «Свой» — если хоть одну строку правили руками. Тап — выбрать
// шаблон: положения ложатся КОПИЕЙ, дальше строки ниже правятся как обычно.
// Шаблонов нет — строка ведёт в «Шаблоны доступа».

export function TeamTemplateBlock({
  blocks,
  levelOf,
  onApply,
  busy,
}: {
  blocks: readonly AccessBlock[];
  /** Положение блока в этой команде сейчас. */
  levelOf: (block: AccessBlock) => AccessLevel;
  onApply: (template: AccessTemplate) => void;
  busy?: boolean;
}) {
  const t = useThemeColors();
  const router = useRouter();
  const templates = useAccessTemplates().data ?? [];
  const matched = matchedTemplate(blocks, levelOf, templates);

  const pick = async () => {
    if (templates.length === 0) {
      router.push("/cabinet/people/templates" as Href);
      return;
    }
    const index = await chooseOption("Шаблон прав", templates.map((tpl) => ({ label: tpl.name })), {
      message: "Права в этой команде станут как в шаблоне. Потом любую строку можно поправить.",
    });
    const chosen = index === null ? undefined : templates[index];
    if (chosen) onApply(chosen);
  };

  return (
    <SectionCard title="Шаблон" padded={false}>
      <NavRow
        label="Шаблон"
        value={templates.length === 0 ? "Создать" : (matched?.name ?? "Свой")}
        valueColor={templates.length === 0 ? t.accent : undefined}
        dimmed={busy}
        onPress={busy ? undefined : () => void pick()}
      />
    </SectionCard>
  );
}

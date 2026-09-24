import { Redirect, useLocalSearchParams, type Href } from "expo-router";

// «Статистика» сотрудника слилась со страницей «Записи» (STORY-087): итоги
// периода стоят там же, над записями. Старый порт с веба считал по
// `master_id`, которого у работ нет, — и всегда показывал нули. Адрес живёт,
// чтобы старые ссылки вели куда надо.
export default function MasterStatsRedirect() {
  const { id, teams } = useLocalSearchParams<{ id: string; teams?: string }>();
  return (
    <Redirect href={`/calendar/masters/${id}/visits?teams=${encodeURIComponent(teams ?? "")}` as Href} />
  );
}

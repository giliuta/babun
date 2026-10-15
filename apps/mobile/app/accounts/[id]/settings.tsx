import { Redirect, useLocalSearchParams } from "expo-router";
import { accountEditHref } from "@/features/finances/account-editor/editor-logic";

// СТРАНИЦЫ НАСТРОЕК СЧЁТА БОЛЬШЕ НЕТ (вместо неё шторка). Счёт правится листом на странице «Счета». Старый адрес —
// диплинки, история, соседние экраны — ведёт туда же с открытым листом.
export default function AccountSettingsRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <Redirect href={accountEditHref(id)} />;
}

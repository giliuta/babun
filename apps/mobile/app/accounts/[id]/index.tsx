import { Redirect, useLocalSearchParams } from "expo-router";
import { accountEditHref } from "@/features/finances/account-editor/editor-logic";

// СТРАНИЦЫ СЧЁТА БОЛЬШЕ НЕТ: операции счёта живут на «Финансах» под «Счетами»
// (владелец 2026-09-15), а «зайти в счёт» значит открыть его лист на странице
// «Счета». Старый адрес `/accounts/<id>` ведёт туда же, без промежуточной
// остановки на снесённых настройках.
export default function AccountRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <Redirect href={accountEditHref(id)} />;
}

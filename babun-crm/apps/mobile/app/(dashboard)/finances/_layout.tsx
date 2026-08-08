import { Stack } from "expo-router";

// Раздел «Финансы» — ОДНА вкладка со стеком внутри, как «Клиенты».
//
// Без этого файла expo-router считает каждый файл каталога отдельной
// вкладкой, и внизу вырастают «finances/settings», «finances/vat» рядом с
// «Календарь» и «Клиенты». Стек-раскладка склеивает их в один таб: список
// денег — корень, настройки и НДС — экраны поверх него.
export default function FinancesLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}

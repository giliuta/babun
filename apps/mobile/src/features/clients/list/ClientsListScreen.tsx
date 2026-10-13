import { Screen } from "@/components/ui/Screen";
import { ListBody } from "./ListBody";
import { ListFooter } from "./ListFooter";
import { ListSheets } from "./ListSheets";
import { ListTopBar } from "./ListTopBar";
import { useClientsList } from "./use-clients-list";

// v811 list card (approved web design, apps/web/.../clients/page.tsx
// ClientCard): name row (+pin) · money row (grey expected · green income
// · gold debt) · meta row (посл. запись · команда · город · теги).
// Field visibility is driven by the «Что показывать» prefs (cardFields).
//
// Bulk-mode (web-parity): long-press ENTERS selection mode; in it the avatar
// becomes a checkbox, the contact button hides, and a tap toggles the pick
// instead of opening the card.
//
// СВАЙПЫ (2026-08-06): вправо — «Записать», влево — «Напомнить» и «В архив».
// Телефон для них не нужен; в режиме выбора свайпы отключены целиком.

/** The clients tab: one list of several companies (own first). Wiring is in
 *  `use-clients-list.ts`; this file only stacks the parts. */
export function ClientsListScreen() {
  const list = useClientsList();
  return (
    // edges top-only: экран внутри Tabs — нижний safe-area держит таб-бар,
    // иначе двойной инсет (~34pt зазор над CTA). Паттерн chats/(dashboard).
    <Screen edges={["top"]}>
      <ListTopBar list={list} />
      <ListBody list={list} />
      <ListFooter list={list} />
      <ListSheets list={list} />
    </Screen>
  );
}

import { View } from "react-native";
import { SectionCard } from "@/components/ui/SectionCard";
import { InvitationsRow } from "@/features/access/InvitationsRow";

// «ПРИГЛАШЕНИЯ» В КАБИНЕТЕ — И ТОЛЬКО ОНИ: добавление идёт просто в команды,
// выбирать и переключаться не нужно.
//
// Строк компаний здесь нет: принятое приглашение не заводит «новую
// компанию», которую надо выбрать, — его команды встают в ленту календаря
// (`useAcceptInvitation`). Дверь приглашений стоит на месте всегда, даже без
// приглашений (блок, пропадавший без них, не находили).

export function CompaniesSection() {
  return (
    <View>
      <SectionCard>
        <InvitationsRow />
      </SectionCard>
    </View>
  );
}

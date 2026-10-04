import { View } from "react-native";
import { SectionCard } from "@/components/ui/SectionCard";
import { InvitationsRow } from "@/features/access/InvitationsRow";

// «ПРИГЛАШЕНИЯ» В КАБИНЕТЕ — И ТОЛЬКО ОНИ (владелец 01.10: «сюда приходят
// приглашения, а добавление — просто в команды, и всё; выбирать не надо,
// не должно появляться что-то новое, и переключаться так точно не надо»).
//
// Строк компаний здесь больше нет: принятое приглашение не заводит «новую
// компанию», которую надо выбрать, — его команды встают в ленту календаря
// (`useAcceptInvitation`). Дверь приглашений стоит на месте всегда, даже без
// приглашений (владелец не находил блок, пропадавший без них).

export function CompaniesSection() {
  return (
    <View>
      <SectionCard>
        <InvitationsRow />
      </SectionCard>
    </View>
  );
}

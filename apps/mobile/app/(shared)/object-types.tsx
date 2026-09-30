import { ObjectTypesScreen } from "@/features/reference/screens/ObjectTypesScreen";
import { RoleCapabilityBoundary } from "@/features/settings/RoleCapabilityBoundary";

// ТИПЫ ОБЪЕКТОВ, ОТКРЫТЫЕ ИЗ ЗАПИСИ — ПОВЕРХ ЗАПИСИ (владелец 2026-09-04:
// «нажимаю добавить объект, тип объекта, шестерёнку — перебрасывает на
// страницу; жму назад — и запись закрывается, так не должно быть»).
//
// Тот же экран, что `/clients/object-types`, но маршрутом корневого стека,
// сиблингом записи. Причина навигационная и та же, что у `/book/client`:
// `/clients/*` живёт ВНУТРИ вкладки «Клиенты», и переход туда из записи
// кладёт поверх неё вторую копию табов — «назад» приводит на список клиентов,
// а запись со всем набранным исчезает. Здесь «назад» возвращает ровно в неё.
export default function BookObjectTypesScreen() {
  return (
    <RoleCapabilityBoundary capability="operate-clients" title="Типы объектов">
      <ObjectTypesScreen />
    </RoleCapabilityBoundary>
  );
}

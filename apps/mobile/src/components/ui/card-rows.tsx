// ЕДИНАЯ СТРОКА КАРТОЧКИ КЛИЕНТА — тот же диалект, что у строк фильтров:
// «ярлык слева … значение справа», 48pt, тап = правка на месте. Имя, номер
// телефона, объекты и так далее — каждое чётко в своём блоке и всегда редактируется.
//
// Почему строки, а не «постер»: раньше имя было крупным заголовком, а
// телефон — мелкой строкой под ним, и на экране создания это читалось
// перевёрнуто (заголовок «Имя», а курсор в номере). Строка с ярлыком
// снимает вопрос «что это за поле» в обоих режимах сразу.
//
// The row primitives live one per file in `card-rows/`; this barrel keeps
// the single import path every screen already uses.

export { RowGroup, RowGroupBody, RowGroupHeader } from "./card-rows/RowGroup";
export { FieldRow, type FieldRowProps } from "./card-rows/FieldRow";
export { NavRow } from "./card-rows/NavRow";
export { ColumnDoorRow } from "./card-rows/ColumnDoorRow";
export { RowActionButton } from "./card-rows/RowActionButton";
export { ActionRow } from "./card-rows/ActionRow";
export { ChoiceRow } from "./card-rows/ChoiceRow";
export { ControlRow } from "./card-rows/ControlRow";
export { RowCaption } from "./card-rows/RowCaption";

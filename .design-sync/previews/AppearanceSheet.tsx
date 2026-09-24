import { AppearanceSheet } from '@babun/ui';

const noop = () => {};

// Вид сущности — одна шторка на цвет и значок: переключатель «Значок · Цвет»,
// решётка в восемь столбцов. Выбор не закрывает шторку — закрывает
// «Применить» в футере. Здесь — счёт Revolut на вкладке «Цвет»: сорок цветов,
// выбранный — галка внутри плитки.
export const Color = () => (
  <AppearanceSheet visible onClose={noop} color="#3276FB" onColorChange={noop} icon="card" onIconChange={noop} initial="color" />
);

// Сущность без значка (метка дня, тег): шторка спрашивает только цвет —
// переключателя нет.
export const ColorOnly = () => <AppearanceSheet visible onClose={noop} color="#15A84F" onColorChange={noop} />;

// Та же шторка на вкладке «Значок»: сорок значков, выбранный залит цветом
// сущности; повторный тап по нему снимает значок.
export const Icon = () => (
  <AppearanceSheet visible onClose={noop} color="#3276FB" onColorChange={noop} icon="card" onIconChange={noop} initial="icon" />
);

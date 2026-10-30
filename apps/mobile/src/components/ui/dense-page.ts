import { createContext, useContext } from "react";

/** ПЛОТНАЯ СТРАНИЦА — запись клиента и событие. Блоков на ней до девяти, и
 *  воздух под каждой шапкой, между карточками и в каждой строке складывался в
 *  пустые зазоры: блоки те же, тише только воздух. Лист, открытый со
 *  страницы, — уже не она: `BottomSheet` сбрасывает плотность у своих
 *  слоёв. */
const DensePageContext = createContext(false);

export const DensePage = DensePageContext.Provider;

export function useDensePage(): boolean {
  return useContext(DensePageContext);
}

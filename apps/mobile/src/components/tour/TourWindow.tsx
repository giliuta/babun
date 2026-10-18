import type { ReactNode } from "react";
import { TourLayer } from "./TourLayer";
import { TourHostProvider } from "./TourTarget";

/** Окно, в котором обучение умеет подсвечивать: корень приложения или шторка.
 *  Цели внутри записываются за этим окном, и подсказку для них рисует его
 *  же слой — поверх всего содержимого окна. Родитель обязан быть растянут:
 *  слой ложится на него целиком. */
export function TourWindow({ id, children }: { id: string; children: ReactNode }) {
  return (
    <TourHostProvider value={id}>
      {children}
      <TourLayer host={id} />
    </TourHostProvider>
  );
}

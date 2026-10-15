import type { SocialResult } from "./social-sign-in";

// Кнопка Google Identity Services есть только на сайте (`GoogleWebButton.web.tsx`);
// на телефоне Google входит родным окном через обычную кнопку.
export function GoogleWebButton(_: { onResult: (result: SocialResult) => void }) {
  return null;
}

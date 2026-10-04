import { LegalScreen } from "@/features/legal/LegalScreen";

// babun.app/terms — открывается без входа: ссылка из карточек App Store и
// Google Play, с регистрации и из «Помощи». Текст — features/legal.
export default function Page() {
  return <LegalScreen doc="terms" />;
}

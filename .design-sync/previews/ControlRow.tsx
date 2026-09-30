import { ControlRow, NavRow, SectionCard } from '@babun/ui';

const Phone = ({ children }: { children: React.ReactNode }) => (
  <div style={{ width: 390, display: 'flex', flexDirection: 'column' }}>{children}</div>
);
const noop = () => {};

// Ответ-слово справа: в приложении это `<Text>` 15/600 акцентом. Тот же шрифт,
// что react-native-web ставит своему Text.
const Answer = ({ children }: { children: string }) => (
  <span
    style={{
      fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif',
      fontSize: 15,
      fontWeight: 600,
      color: '#2c5be0',
    }}
  >
    {children}
  </span>
);

// Карточка реквизитов, которые уже основные: ярлык и готовый ответ, без
// шеврона и без нажатия — снять «основные» здесь нельзя.
export const DefaultRequisites = () => (
  <Phone>
    <SectionCard>
      <ControlRow label="Основные реквизиты">
        <Answer>Да</Answer>
      </ControlRow>
    </SectionCard>
  </Phone>
);

// Не первой строкой в карточке — с линией сверху (`separated`). Рядом со
// строкой-дверью видно разницу: у ControlRow нет шеврона.
export const Separated = () => (
  <Phone>
    <SectionCard title="Реквизиты">
      <NavRow label="AirFix LTD" value="Agiou Tychona 5, Limassol" onPress={noop} />
      <ControlRow label="Основные реквизиты" separated>
        <Answer>Да</Answer>
      </ControlRow>
    </SectionCard>
  </Phone>
);

import { SectionCard, TimeWheelPair, ValueRow } from '@babun/ui';

const Phone = ({ children }: { children: React.ReactNode }) => (
  <div style={{ width: 390, display: 'flex', flexDirection: 'column' }}>{children}</div>
);
const noop = () => {};

// Блок «Даты» инвойса: подпись слева, действующее значение справа, шеврон —
// строка открывает лист с барабаном даты. Вторая строка — с линией сверху.
export const DatesBlock = () => (
  <Phone>
    <SectionCard title="Даты">
      <ValueRow label="Выставлен" value="21 сен" onPress={noop} />
      <ValueRow label="Оплатить до" value="5 окт" separated onPress={noop} />
    </SectionCard>
  </Phone>
);

// Своего значения нет — строка всё равно говорит словами, но серым (`muted`):
// срок оплаты не поставлен.
export const NotSet = () => (
  <Phone>
    <SectionCard title="Даты">
      <ValueRow label="Выставлен" value="21 сен" onPress={noop} />
      <ValueRow label="Оплатить до" value="не поставлен" muted separated onPress={noop} />
    </SectionCard>
  </Phone>
);

// Раскрывашка в шторке: подпись уходит в акцент, шеврон вниз, барабан — под
// строкой (двух листов в одном кадре iOS не показывает).
export const Expanded = () => (
  <Phone>
    <SectionCard>
      <ValueRow label="Перерыв после записи" value="00:15" expanded onPress={noop} />
      <div style={{ display: 'flex', justifyContent: 'center', paddingBottom: 12 }}>
        <TimeWheelPair
          hour={0}
          minute={15}
          onChangeHour={noop}
          onChangeMinute={noop}
          labelPrefix="Перерыв после записи"
        />
      </div>
    </SectionCard>
  </Phone>
);

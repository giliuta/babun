import { useState } from 'react';
import { Button, FieldLabel, TimeWheelPair } from '@babun/ui';

// Тело шторки: поля 20, как у шторки свободного слота.
const SheetBody = ({ children }: { children: React.ReactNode }) => (
  <div style={{ width: 390, padding: '8px 20px 16px', display: 'flex', flexDirection: 'column' }}>
    {children}
  </div>
);
const noop = () => {};

// Шапка шторки — дата, выбранная тапом по сетке; время показывает сам барабан.
const SheetDate = ({ children }: { children: React.ReactNode }) => (
  <div style={{ fontSize: 17, fontWeight: 600, color: '#0b1220', textAlign: 'center' }}>{children}</div>
);

// Две дороги создания — одна геометрия, разная заливка.
const SlotButtons = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 6 }}>
    <Button label="Событие" variant="secondary" onPress={noop} />
    <Button label="Клиент" onPress={noop} />
  </div>
);

// Шторка свободного слота: часы и минуты — два закольцованных барабана,
// минуты пятиминутками, между ними немое двоеточие.
export const SlotSheet = () => {
  const [hour, setHour] = useState(10);
  const [minute, setMinute] = useState(0);
  return (
    <SheetBody>
      <SheetDate>Ср, 23 сентября</SheetDate>
      <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0' }}>
        <TimeWheelPair hour={hour} minute={minute} onChangeHour={setHour} onChangeMinute={setMinute} labelPrefix="Время записи" />
      </div>
      <SlotButtons />
    </SheetBody>
  );
};

// Время вне рабочих часов команды: цифры и полоса под срезом — амбером.
// Запись не блокируется, сигнал только цветом (и суффиксом для VoiceOver).
export const OffHours = () => {
  const [hour, setHour] = useState(20);
  const [minute, setMinute] = useState(30);
  return (
    <SheetBody>
      <SheetDate>Ср, 23 сентября</SheetDate>
      <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0' }}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <div
            style={{
              position: 'absolute',
              left: -6,
              right: -6,
              top: 40,
              height: 40,
              borderRadius: 10,
              backgroundColor: '#955f0014',
            }}
          />
          <TimeWheelPair
            hour={hour}
            minute={minute}
            onChangeHour={setHour}
            onChangeMinute={setMinute}
            labelPrefix="Время записи"
            activeColor="#955f00"
            accessibilityValueSuffix=", вне рабочих часов"
          />
        </div>
      </div>
      <SlotButtons />
    </SheetBody>
  );
};

// Длительность типа события: подписи «ч» и «мин» под колонками, иначе
// «01 : 30» читалось бы как половина второго ночи.
export const Duration = () => {
  const [duration, setDuration] = useState(90);
  return (
    <SheetBody>
      <FieldLabel text="Длительность" />
      <TimeWheelPair
        hour={Math.floor(duration / 60)}
        minute={duration % 60}
        onChangeHour={(h) => setDuration(h * 60 + (duration % 60))}
        onChangeMinute={(m) => setDuration(Math.floor(duration / 60) * 60 + m)}
        labelPrefix="Длительность"
        units
      />
    </SheetBody>
  );
};

// Граница-конец окна календаря: час 24 — конец суток, минуты у него всегда 00
// и барабан минут гаснет.
export const EndOfDay = () => {
  const [hour, setHour] = useState(24);
  const [minute, setMinute] = useState(0);
  return (
    <SheetBody>
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <TimeWheelPair hour={hour} minute={minute} onChangeHour={setHour} onChangeMinute={setMinute} labelPrefix="Конец" maxHour={24} />
      </div>
      <div style={{ marginTop: 8, fontSize: 13, lineHeight: '18px', color: '#5b6678', textAlign: 'center' }}>
        24:00 — конец суток, минут у него нет
      </div>
    </SheetBody>
  );
};

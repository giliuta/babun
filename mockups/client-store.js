(function () {
  'use strict';

  const STORAGE_KEY = 'babun.clients.v1';
  const palette = ['#FF3B30', '#FF9500', '#34C759', '#007AFF', '#5E5CE6', '#AF52DE', '#FF2D55', '#30B0C7', '#A2845E'];

  const baseClients = [
    { id:'angela-m', first:'Angela', fullName:'Angela Morris', ini:'AM', color:'#FF2D55', phone:'+357 99 410 208', email:'angela.m@example.com', birthDate:'1992-09-17', brig:'D&K', city:'Лимассол', tag:'', note:'Предпочитает сообщения в WhatsApp. Английский язык.', exp:80, inc:0, debt:0, last:null, appts:[], address:'Mesa Geitonia, Limassol', equipment:'Кондиционер Daikin · 2 шт.' },
    { id:'johannes-w', first:'Johannes', fullName:'Johannes Weber', ini:'JW', color:'#FFCC00', phone:'+357 96 218 445', email:'j.weber@example.com', birthDate:'1988-01-24', brig:'D&K', city:'', tag:'', note:'', exp:0, inc:0, debt:0, last:null, appts:[], address:'', equipment:'' },
    { id:'john-t', first:'John', fullName:'John Taylor', ini:'JT', color:'#FF9500', phone:'+357 97 552 120', email:'john.t@example.com', birthDate:'1985-06-09', brig:'Y&D', city:'Ларнака', tag:'VIP', note:'Ключ у охраны. Звонить за 30 минут до приезда.', exp:120, inc:420, debt:0, last:'2 мар', appts:['2026-01-15','2026-03-02'], address:'Finikoudes, Larnaca', equipment:'Mitsubishi Electric · 3 шт.' },
    { id:'laima-b', first:'Laima', fullName:'Laima Berzina', ini:'LB', color:'#32ADE6', phone:'+357 95 014 778', email:'laima.b@example.com', birthDate:'1990-12-03', brig:'Y&D', city:'Пафос', tag:'', note:'', exp:0, inc:90, debt:0, last:'12 фев', appts:['2026-02-12'], address:'Universal, Paphos', equipment:'Daikin Sensira · 1 шт.' },
    { id:'marina-a', first:'Marina', fullName:'Marina Alexiou', ini:'MA', color:'#AF52DE', phone:'+357 94 330 912', email:'', birthDate:'', brig:null, city:'', tag:'', note:'Новый запрос с сайта.', exp:0, inc:0, debt:0, last:null, appts:[], address:'', equipment:'' },
    { id:'alexander-s', first:'Александр', fullName:'Александр Сергеев', ini:'АС', color:'#A2845E', phone:'+357 99 704 381', email:'a.sergeev@example.com', birthDate:'1979-04-18', brig:'Y&D', city:'Никосия', tag:'Проблемный', note:'Перед работами обязательно согласовать смету письменно.', exp:0, inc:120, debt:0, last:'18 апр', appts:['2025-11-20','2026-04-18'], address:'Strovolos, Nicosia', equipment:'Gree Pular · 2 шт.' },
    { id:'anastasia-p', first:'Анастасия', fullName:'Анастасия Петрова', ini:'АП', color:'#007AFF', phone:'+357 99 123 456', email:'anastasia.p@example.com', birthDate:'1991-08-14', brig:'Y&D', city:'Лимассол', tag:'VIP', note:'Любит утренние записи. Есть собака — предупредить мастера.', exp:160, inc:640, debt:0, last:'30 мая', appts:['2026-01-10','2026-04-09','2026-05-30'], nextAppointment:'2026-07-24T09:30', nextService:'Чистка · 2 кондиционера', address:'Agios Athanasios, Limassol', equipment:'Daikin Perfera · 2 шт.' },
    { id:'nadezhda-v', first:'Надежда', fullName:'Надежда Волкова', ini:'НВ', color:'#34C759', phone:'+357 96 441 705', email:'n.volkova@example.com', birthDate:'1987-02-05', brig:'D&K', city:'Никосия', tag:'', note:'', exp:0, inc:240, debt:0, last:'3 мая', appts:['2026-03-03','2026-05-03'], address:'Engomi, Nicosia', equipment:'Midea Xtreme Save · 2 шт.' },
    { id:'olga-n', first:'Ольга', fullName:'Ольга Николаева', ini:'ОН', color:'#5E5CE6', phone:'+357 97 880 314', email:'o.nikolaeva@example.com', birthDate:'1994-07-21', brig:'Y&D', city:'Пафос', tag:'', note:'', exp:0, inc:270, debt:0, last:'25 мая', appts:['2026-05-25'], address:'Kato Paphos', equipment:'Haier Flexis · 1 шт.' },
    { id:'ruslan-a', first:'Руслан', fullName:'Руслан Алиев', ini:'РА', color:'#00C7BE', phone:'+357 95 224 619', email:'', birthDate:'', brig:'D&K', city:'', tag:'', note:'Связь только по телефону.', exp:0, inc:0, debt:0, last:null, appts:[], address:'', equipment:'' },
    { id:'svetlana-k', first:'Светлана', fullName:'Светлана Коваль', ini:'СК', color:'#30B0C7', phone:'+357 94 608 772', email:'s.koval@example.com', birthDate:'1983-11-10', brig:'Y&D', city:'Айя-Напа', tag:'', note:'', exp:0, inc:180, debt:0, last:'1 июн', appts:['2026-02-01','2026-06-01'], address:'Nissi Avenue, Ayia Napa', equipment:'Toshiba Seiya · 2 шт.' },
    { id:'sergey-m', first:'Сергей', fullName:'Сергей Морозов', ini:'СМ', color:'#FF3B30', phone:'+357 99 515 803', email:'s.morozov@example.com', birthDate:'1981-03-28', brig:'Y&D', city:'Лимассол', tag:'Постоянный', note:'Оплата обычно переводом. Напомнить про долг перед следующей записью.', exp:120, inc:560, debt:135, last:'10 мая', appts:['2026-02-20','2026-05-10'], nextAppointment:'2026-07-26T13:00', nextService:'Диагностика · долг €135', address:'Germasogeia, Limassol', equipment:'Daikin Stylish · 3 шт.' }
  ];

  function readState() {
    try {
      const state = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      return { overrides: state.overrides || {}, custom: Array.isArray(state.custom) ? state.custom : [] };
    } catch (_) {
      return { overrides: {}, custom: [] };
    }
  }

  function writeState(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function initials(name) {
    const words = String(name || '').trim().split(/\s+/).filter(Boolean);
    return words.length ? (words[0][0] + (words[1] ? words[1][0] : '')).toUpperCase() : '?';
  }

  function colorFor(name) {
    let hash = 0;
    for (const char of String(name || '')) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    return palette[hash % palette.length];
  }

  function slug(name) {
    const value = String(name || 'client').toLowerCase().trim()
      .replace(/[^a-zа-яё0-9]+/gi, '-')
      .replace(/^-|-$/g, '');
    return `${value || 'client'}-${Date.now().toString(36)}`;
  }

  function normalize(client) {
    const fullName = String(client.fullName || client.first || '').trim();
    return {
      exp: 0, inc: 0, debt: 0, appts: [], nextAppointment: '', nextService: '', address: '', equipment: '', note: '', email: '', birthDate: '', brig: null, city: '', tag: '', last: null,
      ...client,
      fullName,
      first: fullName.split(/\s+/)[0] || 'Без имени',
      ini: initials(fullName),
      color: client.color || colorFor(fullName)
    };
  }

  function list() {
    const state = readState();
    const seeded = baseClients.map(client => normalize({ ...client, ...(state.overrides[client.id] || {}) }));
    return seeded.concat(state.custom.map(normalize));
  }

  function get(id) {
    return list().find(client => client.id === id) || null;
  }

  function save(client) {
    const state = readState();
    const normalized = normalize({ ...client, id: client.id || slug(client.fullName) });
    const base = baseClients.some(item => item.id === normalized.id);
    if (base) {
      state.overrides[normalized.id] = normalized;
    } else {
      const index = state.custom.findIndex(item => item.id === normalized.id);
      if (index >= 0) state.custom[index] = normalized;
      else state.custom.unshift(normalized);
    }
    writeState(state);
    return normalized;
  }

  window.BabunClients = { list, get, save, initials, colorFor };
}());

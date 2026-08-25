// Chat / Inbox data model — unified messaging across WhatsApp,
// Instagram, Telegram, and SMS. Stored in localStorage for now;
// will migrate to Supabase with real webhook integrations later.

import { generateId } from "./masters";
import { getStorage } from "../storage/provider";

export type ChatChannel = "whatsapp" | "instagram" | "telegram" | "sms";

export const CHANNEL_LABELS: Record<ChatChannel, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  telegram: "Telegram",
  sms: "SMS",
};

export const CHANNEL_COLORS: Record<ChatChannel, string> = {
  whatsapp: "#25D366",
  instagram: "#E1306C",
  telegram: "#229ED9",
  sms: "#6b7280",
};

export type MessageStatus = "sent" | "delivered" | "read";

export interface ChatMessage {
  id: string;
  direction: "in" | "out";
  text: string;
  photo?: string; // base64 data URL
  reply_to_id?: string; // id of message being replied to
  status?: MessageStatus; // only meaningful for outgoing
  is_starred?: boolean;
  content_type?: "text" | "image" | "audio" | "location";
  location_lat?: number;
  location_lng?: number;
  timestamp: string; // ISO
}

export type ConversationStatus = "new" | "active" | "waiting" | "closed" | "archived";

export const STATUS_LABELS_CHAT: Record<ConversationStatus, string> = {
  new: "Новый",
  active: "Активный",
  waiting: "Ожидает",
  closed: "Закрыт",
  archived: "Архив",
};

export interface Chat {
  id: string;
  channel: ChatChannel;
  contact_name: string;
  contact_phone: string;
  contact_handle: string; // @username for IG/TG
  client_id: string | null; // linked Babun client, null = not yet created
  messages: ChatMessage[];
  unread_count: number;
  last_message_at: string; // ISO
  last_seen?: string; // ISO — when the contact was last online
  status: ConversationStatus;
  is_pinned: boolean;
  draft: string;
  created_at: string;
}

const STORAGE_KEY = "babun-chats";

export function loadChats(): Chat[] {
  // Storage seam (STORY-035): WebKVStorage on web, MMKV on RN. Works on
  // both platforms — replaces the prior window.localStorage-only path.
  const parsed = getStorage().get<Chat[]>(STORAGE_KEY);
  return Array.isArray(parsed) ? parsed : [];
}

// STORY-053a follow-up — demo seed kept for on-demand demo data
// loading from Settings → Account → "Загрузить демо-чаты", but it
// MUST NOT auto-fire on empty load. New tenants get an empty inbox.
export function seedDemoChats(): Chat[] {
  return seedChats();
}

export function saveChats(list: Chat[]): void {
  getStorage().set(STORAGE_KEY, list);
}

export function getTotalUnread(chats: Chat[]): number {
  return chats.reduce((sum, c) => sum + c.unread_count, 0);
}

export function createBlankChat(channel: ChatChannel): Chat {
  const now = new Date().toISOString();
  return {
    id: generateId("chat"),
    channel,
    contact_name: "",
    contact_phone: "",
    contact_handle: "",
    client_id: null,
    messages: [],
    unread_count: 0,
    last_message_at: now,
    status: "new",
    is_pinned: false,
    draft: "",
    created_at: now,
  };
}

// Seed data so the page isn't empty on first visit
function seedChats(): Chat[] {
  const now = new Date();
  const ago = (mins: number) => new Date(now.getTime() - mins * 60000).toISOString();

  const chats: Chat[] = [
    {
      id: "chat-1",
      channel: "whatsapp",
      contact_name: "Иванов Алексей",
      contact_phone: "+35799123456",
      contact_handle: "",
      client_id: null,
      messages: [
        { id: "m1", direction: "in", text: "Здравствуйте, хочу записаться на чистку кондиционера", timestamp: ago(120), status: "read" },
        { id: "m2", direction: "out", text: "Добрый день! Какой адрес? Можем на эту неделю", timestamp: ago(115), status: "read" },
        { id: "m3", direction: "in", text: "Лимассол, ул. Макариос 45, квартира 3", timestamp: ago(110), status: "read" },
        { id: "m3b", direction: "in", text: "У нас 4 кондиционера, все нужно почистить", timestamp: ago(100), status: "delivered" },
      ],
      unread_count: 1,
      last_message_at: ago(100),
      last_seen: ago(5),
      status: "active",
      is_pinned: true,
      draft: "",
      created_at: ago(120),
    },
    {
      id: "chat-2",
      channel: "instagram",
      contact_name: "Maria K.",
      contact_phone: "",
      contact_handle: "@maria_k_limassol",
      client_id: null,
      messages: [
        { id: "m4", direction: "in", text: "Hi! Do you service Samsung AC units?", timestamp: ago(300), status: "read" },
        { id: "m5", direction: "out", text: "Hello! Yes, we service all brands. Where are you located?", timestamp: ago(290), status: "delivered" },
      ],
      unread_count: 0,
      last_message_at: ago(290),
      status: "waiting",
      is_pinned: false,
      draft: "",
      created_at: ago(300),
    },
    {
      id: "chat-3",
      channel: "telegram",
      contact_name: "Петрова Елена",
      contact_phone: "+35796554433",
      contact_handle: "@elena_p",
      client_id: null,
      messages: [
        { id: "m6", direction: "in", text: "Нужна установка 2 кондиционеров в новый офис. Можете приехать на замер? Адрес: Лимассол, бизнес-центр Олимпия, 5 этаж", timestamp: ago(45), status: "delivered" },
      ],
      unread_count: 1,
      last_message_at: ago(45),
      last_seen: ago(2),
      status: "new",
      is_pinned: false,
      draft: "",
      created_at: ago(45),
    },
    {
      id: "chat-4",
      channel: "sms",
      contact_name: "Козлов Дмитрий",
      contact_phone: "+35797889900",
      contact_handle: "",
      client_id: null,
      messages: [
        { id: "m7", direction: "in", text: "Перезвоните пожалуйста по поводу ремонта", timestamp: ago(1440), status: "read" },
        { id: "m8", direction: "out", text: "Добрый день! Свяжемся с вами в ближайшее время", timestamp: ago(1400), status: "sent" },
      ],
      unread_count: 0,
      last_message_at: ago(1400),
      status: "closed",
      is_pinned: false,
      draft: "",
      created_at: ago(1440),
    },
  ];

  saveChats(chats);
  return chats;
}

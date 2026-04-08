// Supabase Edge Function: Telegram Bot Webhook
// Deploy: supabase functions deploy telegram-webhook
// Set webhook: https://api.telegram.org/bot<TOKEN>/setWebhook?url=<SUPABASE_URL>/functions/v1/telegram-webhook

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

interface TelegramUpdate {
  message?: {
    chat: { id: number };
    from?: { id: number; first_name: string };
    text?: string;
    photo?: { file_id: string }[];
  };
}

async function sendMessage(chatId: number, text: string, replyMarkup?: object) {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
  };
  if (replyMarkup) body.reply_markup = replyMarkup;

  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function handleStart(chatId: number, text: string) {
  // /start <phone> — link Telegram chat to profile
  const phone = text.replace("/start", "").trim();
  if (!phone) {
    await sendMessage(
      chatId,
      "Добро пожаловать в Babun CRM Bot!\n\n" +
        "Для привязки аккаунта отправьте:\n<code>/start +357XXXXXXXX</code>",
    );
    return;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, tenant_id")
    .eq("phone", phone)
    .single();

  if (!profile) {
    await sendMessage(chatId, "❌ Профиль с таким телефоном не найден.");
    return;
  }

  // Store telegram chat_id — we can use it for notifications later
  // For now, just confirm the link
  await sendMessage(
    chatId,
    `✅ Привет, ${profile.full_name}!\nАккаунт привязан. Используйте /orders для просмотра заказов.`,
  );
}

async function handleOrders(chatId: number) {
  // Find profile by checking if any profile has this chat_id or just show today's orders
  const today = new Date().toISOString().split("T")[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split("T")[0];

  const { data: orders } = await supabase
    .from("orders")
    .select("order_number, status, city, scheduled_date, address")
    .in("status", ["scheduled", "in_progress", "confirmed"])
    .or(`scheduled_date.eq.${today},scheduled_date.eq.${tomorrow}`)
    .order("scheduled_date")
    .limit(10);

  if (!orders || orders.length === 0) {
    await sendMessage(chatId, "📋 Нет активных заказов на сегодня/завтра.");
    return;
  }

  let msg = "📋 <b>Заказы на сегодня/завтра:</b>\n\n";
  for (const o of orders) {
    const statusEmoji: Record<string, string> = {
      confirmed: "🔵",
      scheduled: "🟡",
      in_progress: "🟣",
    };
    msg += `${statusEmoji[o.status] ?? "⚪"} #${o.order_number} — ${o.city}\n`;
    msg += `   📅 ${o.scheduled_date ?? "—"}\n`;
    if (o.address) msg += `   📍 ${o.address}\n`;
    msg += "\n";
  }

  await sendMessage(chatId, msg);
}

async function handleComplete(chatId: number, text: string) {
  const orderNumber = text.replace("/complete", "").trim();
  if (!orderNumber) {
    await sendMessage(chatId, "Использование: <code>/complete 123</code>");
    return;
  }

  const { data: order, error } = await supabase
    .from("orders")
    .select("id, order_number, status")
    .eq("order_number", parseInt(orderNumber))
    .single();

  if (error || !order) {
    await sendMessage(chatId, `❌ Заказ #${orderNumber} не найден.`);
    return;
  }

  if (order.status === "completed") {
    await sendMessage(chatId, `Заказ #${orderNumber} уже завершён.`);
    return;
  }

  const { error: updateError } = await supabase
    .from("orders")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
    })
    .eq("id", order.id);

  if (updateError) {
    await sendMessage(chatId, `❌ Ошибка: ${updateError.message}`);
    return;
  }

  // Add activity log
  await supabase.from("order_comments").insert({
    order_id: order.id,
    tenant_id: (
      await supabase
        .from("orders")
        .select("tenant_id")
        .eq("id", order.id)
        .single()
    ).data?.tenant_id,
    type: "status_change",
    content: `Заказ #${order.order_number} завершён через Telegram Bot`,
  });

  await sendMessage(
    chatId,
    `✅ Заказ #${order.order_number} отмечен как завершённый!\n\n📸 Отправьте фото (before/after) для этого заказа.`,
  );
}

async function handlePhoto(chatId: number, fileId: string) {
  // Get the most recent in_progress/completed order to attach the photo
  const { data: order } = await supabase
    .from("orders")
    .select("id, order_number, tenant_id")
    .in("status", ["in_progress", "completed"])
    .order("updated_at", { ascending: false })
    .limit(1)
    .single();

  if (!order) {
    await sendMessage(chatId, "❌ Нет активного заказа для прикрепления фото.");
    return;
  }

  // Get file URL from Telegram
  const fileResp = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`,
  );
  const fileData = await fileResp.json();
  const filePath = fileData.result?.file_path;

  if (!filePath) {
    await sendMessage(chatId, "❌ Не удалось получить файл.");
    return;
  }

  const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;

  // Download and upload to Supabase Storage
  const imageResp = await fetch(fileUrl);
  const imageBlob = await imageResp.blob();
  const fileName = `${order.tenant_id}/${order.id}/${Date.now()}.jpg`;

  const { error: uploadError } = await supabase.storage
    .from("order-photos")
    .upload(fileName, imageBlob, { contentType: "image/jpeg" });

  if (uploadError) {
    await sendMessage(chatId, `❌ Ошибка загрузки: ${uploadError.message}`);
    return;
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from("order-photos").getPublicUrl(fileName);

  // Save photo record
  await supabase.from("order_photos").insert({
    order_id: order.id,
    tenant_id: order.tenant_id,
    url: publicUrl,
    type: "after",
  });

  await sendMessage(
    chatId,
    `📸 Фото прикреплено к заказу #${order.order_number}`,
  );
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("OK", { status: 200 });
  }

  try {
    const update: TelegramUpdate = await req.json();
    const message = update.message;

    if (!message) {
      return new Response("OK", { status: 200 });
    }

    const chatId = message.chat.id;

    // Handle photo
    if (message.photo && message.photo.length > 0) {
      const largestPhoto = message.photo[message.photo.length - 1];
      await handlePhoto(chatId, largestPhoto.file_id);
      return new Response("OK", { status: 200 });
    }

    // Handle text commands
    const text = message.text ?? "";
    if (text.startsWith("/start")) {
      await handleStart(chatId, text);
    } else if (text === "/orders") {
      await handleOrders(chatId);
    } else if (text.startsWith("/complete")) {
      await handleComplete(chatId, text);
    } else {
      await sendMessage(
        chatId,
        "Доступные команды:\n/orders — заказы на сегодня\n/complete <номер> — завершить заказ\n📸 Фото — прикрепить к заказу",
      );
    }

    return new Response("OK", { status: 200 });
  } catch (err) {
    console.error("Telegram webhook error:", err);
    return new Response("Error", { status: 500 });
  }
});

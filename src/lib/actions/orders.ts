"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/actions/clients";

async function getAuthContext() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", user.id)
    .single();
  return profile ? { userId: user.id, tenantId: profile.tenant_id } : null;
}

export async function createOrderAction(payload: {
  client_id: string;
  city: string;
  address?: string;
  address_details?: string;
  scheduled_date?: string;
  scheduled_time_start?: string;
  scheduled_time_end?: string;
  crew_id?: string;
  source?: string;
  client_notes?: string;
  internal_notes?: string;
  items: {
    service_id?: string;
    equipment_id?: string;
    description?: string;
    quantity: number;
    unit_price: number;
    total: number;
  }[];
}): Promise<ActionResult> {
  const ctx = await getAuthContext();
  if (!ctx) return { error: "Unauthorized" };
  const supabase = await createClient();

  const { items, ...orderData } = payload;
  const subtotal = items.reduce((s, i) => s + i.total, 0);

  const { data: order, error: orderErr } = await supabase
    .from("orders")
    .insert({
      ...orderData,
      tenant_id: ctx.tenantId,
      subtotal,
      total: subtotal,
    })
    .select("id, order_number")
    .single();

  if (orderErr) return { error: orderErr.message };

  if (items.length > 0) {
    const { error: itemsErr } = await supabase.from("order_items").insert(
      items.map((i) => ({
        ...i,
        order_id: order.id,
        tenant_id: ctx.tenantId,
      })),
    );
    if (itemsErr) return { error: itemsErr.message };
  }

  await supabase.from("order_comments").insert({
    order_id: order.id,
    tenant_id: ctx.tenantId,
    author_id: ctx.userId,
    type: "system",
    content: `Заказ #${order.order_number} создан`,
  });

  revalidatePath("/orders");
  return { data: order };
}

export async function changeOrderStatusAction(
  orderId: string,
  status: string,
): Promise<ActionResult> {
  const ctx = await getAuthContext();
  if (!ctx) return { error: "Unauthorized" };
  const supabase = await createClient();

  const updates: Record<string, unknown> = { status };
  if (status === "completed") updates.completed_at = new Date().toISOString();
  if (status === "cancelled") updates.cancelled_at = new Date().toISOString();

  const { error } = await supabase
    .from("orders")
    .update(updates)
    .eq("id", orderId);
  if (error) return { error: error.message };

  await supabase.from("order_comments").insert({
    order_id: orderId,
    tenant_id: ctx.tenantId,
    author_id: ctx.userId,
    type: "status_change",
    content: `Статус изменён на: ${status}`,
    metadata: { new_status: status },
  });

  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
  return {};
}

export async function recordPaymentAction(payload: {
  order_id: string;
  client_id: string;
  amount: number;
  method: string;
  notes?: string;
}): Promise<ActionResult> {
  const ctx = await getAuthContext();
  if (!ctx) return { error: "Unauthorized" };
  const supabase = await createClient();

  const { error } = await supabase.from("payments").insert({
    ...payload,
    tenant_id: ctx.tenantId,
    status: "completed",
  });
  if (error) return { error: error.message };

  // Update order payment status
  const { data: payments } = await supabase
    .from("payments")
    .select("amount")
    .eq("order_id", payload.order_id);
  const totalPaid = (payments ?? []).reduce((s, p) => s + Number(p.amount), 0);

  const { data: order } = await supabase
    .from("orders")
    .select("total")
    .eq("id", payload.order_id)
    .single();

  if (order) {
    const paymentStatus = totalPaid >= Number(order.total) ? "paid" : "partial";
    await supabase
      .from("orders")
      .update({ payment_status: paymentStatus, payment_method: payload.method })
      .eq("id", payload.order_id);
  }

  await supabase.from("order_comments").insert({
    order_id: payload.order_id,
    tenant_id: ctx.tenantId,
    author_id: ctx.userId,
    type: "payment",
    content: `Оплата €${payload.amount.toFixed(2)} (${payload.method})`,
  });

  revalidatePath(`/orders/${payload.order_id}`);
  revalidatePath("/orders");
  return {};
}

export async function addOrderCommentAction(
  orderId: string,
  content: string,
): Promise<ActionResult> {
  const ctx = await getAuthContext();
  if (!ctx) return { error: "Unauthorized" };
  const supabase = await createClient();

  const { error } = await supabase.from("order_comments").insert({
    order_id: orderId,
    tenant_id: ctx.tenantId,
    author_id: ctx.userId,
    type: "comment",
    content,
  });
  if (error) return { error: error.message };

  revalidatePath(`/orders/${orderId}`);
  return {};
}

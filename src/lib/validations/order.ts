import { z } from "zod";

export const orderStatuses = [
  "new",
  "confirmed",
  "scheduled",
  "in_progress",
  "completed",
  "cancelled",
  "no_show",
] as const;

export const kanbanStatuses = [
  "new",
  "confirmed",
  "scheduled",
  "in_progress",
  "completed",
] as const;

export const paymentMethods = ["cash", "card", "transfer", "revolut"] as const;

export const createOrderSchema = z.object({
  client_id: z.string().uuid(),
  city: z.enum(["limassol", "paphos", "larnaca", "nicosia"]),
  address: z.string().optional(),
  address_details: z.string().optional(),
  scheduled_date: z.string().optional(),
  scheduled_time_start: z.string().optional(),
  scheduled_time_end: z.string().optional(),
  crew_id: z.string().uuid().optional(),
  source: z.string().optional(),
  client_notes: z.string().optional(),
  internal_notes: z.string().optional(),
});

export const orderItemSchema = z.object({
  service_id: z.string().uuid().optional(),
  equipment_id: z.string().uuid().optional(),
  description: z.string().optional(),
  quantity: z.number().min(1).default(1),
  unit_price: z.number().min(0),
  total: z.number().min(0),
});

export const recordPaymentSchema = z.object({
  order_id: z.string().uuid(),
  client_id: z.string().uuid(),
  amount: z.number().min(0.01, "Сумма должна быть больше 0"),
  method: z.enum(paymentMethods),
  notes: z.string().optional(),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type OrderItemInput = z.infer<typeof orderItemSchema>;
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;

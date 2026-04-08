import { z } from "zod";

export const cities = ["limassol", "paphos", "larnaca", "nicosia"] as const;
export type City = (typeof cities)[number];

export const clientSources = [
  "manual",
  "facebook",
  "instagram",
  "google",
  "referral",
  "telegram",
  "whatsapp",
  "website",
  "bazaraki",
  "repeat",
] as const;

export const languages = ["ru", "en", "el", "uk"] as const;

export const createClientSchema = z.object({
  full_name: z.string().min(2, "Имя должно содержать минимум 2 символа"),
  phone: z.string().min(5, "Введите номер телефона"),
  phone_secondary: z.string().optional(),
  email: z.string().email("Невалидный email").optional().or(z.literal("")),
  city: z.enum(cities).optional(),
  address: z.string().optional(),
  address_details: z.string().optional(),
  source: z.enum(clientSources).optional(),
  language: z.enum(languages).optional(),
  telegram_chat_id: z.string().optional(),
  whatsapp_number: z.string().optional(),
  notes: z.string().optional(),
});

export const updateClientSchema = createClientSchema.partial();

export type CreateClientInput = z.infer<typeof createClientSchema>;
export type UpdateClientInput = z.infer<typeof updateClientSchema>;

export const equipmentTypes = ["indoor", "outdoor"] as const;

export const createEquipmentSchema = z.object({
  client_id: z.string().uuid(),
  type: z.enum(equipmentTypes),
  brand: z.string().optional(),
  model: z.string().optional(),
  location_in_house: z.string().optional(),
  notes: z.string().optional(),
});

export const updateEquipmentSchema = createEquipmentSchema.partial().omit({
  client_id: true,
});

export type CreateEquipmentInput = z.infer<typeof createEquipmentSchema>;
export type UpdateEquipmentInput = z.infer<typeof updateEquipmentSchema>;

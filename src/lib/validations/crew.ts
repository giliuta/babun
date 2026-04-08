import { z } from "zod";

export const createCrewSchema = z.object({
  name: z.string().min(2, "Название минимум 2 символа"),
  lead_name: z.string().optional(),
  phone: z.string().optional(),
  city: z.enum(["limassol", "paphos", "larnaca", "nicosia"]),
  color: z.string().optional(),
});

export const updateCrewSchema = createCrewSchema.partial();

export type CreateCrewInput = z.infer<typeof createCrewSchema>;

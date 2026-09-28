import { z } from "zod";

// Validates a decision payload both client-side (before it's queued in the
// outbox) and server-side (in the sync push action) - the server never
// trusts a client-supplied shape without this.

const candidateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  cuisine: z.string(),
  tags: z.array(z.string()),
  price: z.string(),
  lat: z.number(),
  lng: z.number(),
  address: z.string(),
  distance_km: z.number(),
  dims: z.object({
    service: z.enum(["fast_food", "sit_down"]),
    spice: z.enum(["hot", "mild"]),
    setting: z.enum(["patio", "indoor"]),
    price: z.enum(["low", "mid", "high"]),
    diet: z.enum(["vegan", "vegetarian", "halal", "gluten_free", "none"]),
  }),
  color: z.string(),
});

export const decisionSchema = z.object({
  clientId: z.uuid(),
  partner1Text: z.string().max(500),
  partner2Text: z.string().max(500),
  engine: z.enum(["laya", "gliner", "clm_8b"]),
  confidence: z.number().min(0).max(1),
  reason: z.string().max(40),
  radiusKm: z.number().min(1).max(50),
  source: z.enum(["osm", "mock"]),
  winner: candidateSchema,
  runnerUps: z.array(z.object({ id: z.string(), name: z.string(), probability: z.number() })).max(10),
  tiebreakers: z.array(z.object({ question_id: z.string(), answer: z.string(), text: z.string() })).max(10),
});

export type DecisionPayload = z.infer<typeof decisionSchema>;

import { z } from "zod";

/// Boundary validation for messages arriving from the host process. The
/// utilityProcess port is a trust boundary: shapes are checked here once so
/// the server logic never touches unvalidated structure. `params` stays
/// unknown — per-method validation is the dispatcher's job.
export const hostMessageSchema = z.union([
  z.object({
    kind: z.literal("request"),
    id: z.string(),
    method: z.string(),
    params: z.unknown(),
  }),
  z.object({
    kind: z.literal("host-response"),
    id: z.string(),
    ok: z.boolean(),
    result: z.object({ data: z.string() }).optional(),
    error: z.string().optional(),
  }),
  z.object({
    kind: z.literal("init"),
    config: z.object({
      credentialsDir: z.string(),
      encryptionAvailable: z.boolean(),
      appVersion: z.string(),
    }),
  }),
]);

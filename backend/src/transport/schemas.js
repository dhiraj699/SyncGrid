import { z } from 'zod';
import { CELL_ID_PATTERN } from '../domain/cellId.js';

export const sheetIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/);

const clockKeySchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
export const vectorClockSchema = z
  .record(clockKeySchema, z.number().int().nonnegative())
  .refine((clock) => Object.keys(clock).length <= 256, 'vector clock too large');

export const cellOpSchema = z.object({
  opId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  cellId: z.string().regex(CELL_ID_PATTERN),
  opType: z.enum(['SET', 'CLEAR']),
  value: z.union([z.string().max(2000), z.number().finite(), z.null()]).default(null),
  vectorClock: vectorClockSchema,
  lamport: z.number().int().nonnegative(),
  clientTimestamp: z.number().int().nonnegative(),
});

export const joinSchema = z.object({
  sheetId: sheetIdSchema,
  lastKnownRevision: z.number().int().nonnegative().optional(),
});

export const submitOpsSchema = z.object({
  sheetId: sheetIdSchema,
  ops: z.array(cellOpSchema).min(1).max(500),
  atomic: z.boolean().default(false),
});

export const presenceSchema = z.object({
  sheetId: sheetIdSchema,
  cellId: z.string().regex(CELL_ID_PATTERN).nullable(),
});

export const loginSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(1).max(200),
});

export const historyQuerySchema = z.object({
  afterSeq: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().min(1).max(10_000).default(5_000),
});

export const columnPatchSchema = z.object({
  confidential: z.boolean().optional(),
  staffEditable: z.boolean().optional(),
}).refine((patch) => Object.keys(patch).length > 0, 'empty patch');

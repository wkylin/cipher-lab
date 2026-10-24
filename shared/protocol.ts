import { z } from 'zod'

/** 此演示协议独立于业务 JSON：业务数据先装箱，再作为 JWE 的明文。 */
export const PROFILE = 'cipher-lab/1'
export const REQUEST_TYP = 'cipher-lab-request+jwe'
export const RESPONSE_TYP = 'cipher-lab-response+jwe'
export const REQUEST_TTL_SECONDS = 120
export const MAX_CLOCK_SKEW_SECONDS = 30
export const MAX_BODY_BYTES = 1024 * 1024
export const MAX_WIRE_BYTES = 2 * 1024 * 1024
export const MAX_CONTEXT_BYTES = 8192
export const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const
export type Method = (typeof METHODS)[number]
export const CONTEXT_METHODS: readonly Method[] = ['GET', 'HEAD', 'OPTIONS']

const textEntry = z.object({ name: z.string().max(256), value: z.string().max(MAX_BODY_BYTES) }).strict()
/** 名称 base64 沿用装箱字段名，内容统一为无填充 Base64URL。 */
const binaryEncoding = z.string().max(MAX_WIRE_BYTES).regex(/^[A-Za-z0-9_-]*$/)
const fileEntry = z.object({
  name: z.string().max(256),
  base64: binaryEncoding,
  filename: z.string().max(256),
  contentType: z.string().max(256),
}).strict()

export const packedBodySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('empty') }).strict(),
  z.object({ kind: z.literal('json'), value: z.unknown().refine((value): boolean => value !== undefined, 'JSON body 必须含有 value') }).strict(),
  z.object({ kind: z.literal('text'), value: z.string().max(MAX_BODY_BYTES), contentType: z.string().max(256) }).strict(),
  z.object({ kind: z.literal('binary'), base64: binaryEncoding, contentType: z.string().max(256), filename: z.string().max(256).optional() }).strict(),
  z.object({ kind: z.literal('form'), entries: z.array(z.union([textEntry, fileEntry])).max(100) }).strict(),
])
export type PackedBody = z.infer<typeof packedBodySchema>

export const requestEnvelopeSchema = z.object({
  v: z.literal(1),
  id: z.string().regex(/^[a-zA-Z0-9_-]{16,96}$/),
  iat: z.number().int().nonnegative(),
  exp: z.number().int().positive(),
  method: z.enum(METHODS),
  path: z.string().startsWith('/api/').max(1024),
  query: z.string().max(65536),
  authHash: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  replyKey: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  body: packedBodySchema,
}).strict()
export type RequestEnvelope = z.infer<typeof requestEnvelopeSchema>

export const responseEnvelopeSchema = z.object({
  v: z.literal(1),
  id: z.string().regex(/^[a-zA-Z0-9_-]{16,96}$/),
  iat: z.number().int().nonnegative(),
  method: z.enum(METHODS),
  path: z.string().startsWith('/api/').max(1024),
  status: z.number().int().min(200).max(599),
  body: packedBodySchema,
  headers: z.record(z.string(), z.string()),
}).strict()
export type ResponseEnvelope = z.infer<typeof responseEnvelopeSchema>

export interface BusinessResponse<T = unknown> { code: number; message: string; data: T }

import { z } from 'zod'

export const deviceSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-zA-Z0-9_-]+$/),
  name: z.string().trim().min(1).max(80),
  host: z
    .string()
    .min(1)
    .max(253)
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9.:%_-]*$|^::[a-fA-F0-9:]+$/),
  port: z.number().int().min(1).max(65535),
  username: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/),
  identity: z.string().max(4096).default(''),
  streamHost: z
    .string()
    .max(253)
    .regex(/^[a-zA-Z0-9.:%_-]*$/)
    .default(''),
  streamApp: z.string().min(1).max(128).default('Desktop'),
  color: z.enum(['mint', 'blue', 'peach', 'violet']).default('mint'),
  vncPort: z.number().int().min(1).max(65535).default(5900),
})
export const credentialsSchema = z.object({
  password: z.string().max(4096).optional(),
  passphrase: z.string().max(4096).optional(),
  remember: z.boolean().optional(),
})
export const settingsSchema = z.object({
  baseUrl: z
    .string()
    .max(2048)
    .refine((value) => {
      if (!value) return true
      try {
        const url = new URL(value)
        return (
          !url.username &&
          !url.password &&
          !url.search &&
          !url.hash &&
          (url.protocol === 'https:' ||
            (url.protocol === 'http:' &&
              ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
        )
      } catch {
        return false
      }
    }, '服务地址需要 HTTPS；本机服务可使用 HTTP。请勿在 URL 中放入密钥。'),
  model: z.string().max(128),
  moonlightPath: z.string().max(4096),
})
export const streamSchema = z.object({
  resolution: z.enum(['1280x720', '1920x1080', '2560x1440', '3840x2160']),
  fps: z.union([z.literal(30), z.literal(60), z.literal(120)]),
  bitrate: z.number().int().min(1000).max(150000),
})
export const pathSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine((value) => !value.includes('\0'), '路径含无效字符')
export function shellQuote(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'"
}
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

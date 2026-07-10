/**
 * Minimal Telegram Bot API client over the platform `fetch`/`FormData` — no
 * SDK dependency. https://core.telegram.org/bots/api
 */

const API_ROOT = 'https://api.telegram.org'

export class TelegramApiError extends Error {
  constructor(
    public readonly method: string,
    public readonly description: string,
  ) {
    super(`Telegram API ${method} failed: ${description}`)
  }
}

interface TelegramApiResponse<T> {
  ok: boolean
  result?: T
  description?: string
}

async function call<T>(botToken: string, method: string, body?: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${API_ROOT}/bot${botToken}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = (await res.json()) as TelegramApiResponse<T>
  if (!data.ok) throw new TelegramApiError(method, data.description ?? `HTTP ${res.status}`)
  return data.result as T
}

async function callWithFile<T>(
  botToken: string,
  method: string,
  fields: Record<string, string>,
  file: { field: string; data: Buffer; fileName: string; contentType: string },
): Promise<T> {
  const form = new FormData()
  for (const [key, value] of Object.entries(fields)) form.append(key, value)
  form.append(file.field, new Blob([new Uint8Array(file.data)], { type: file.contentType }), file.fileName)

  const res = await fetch(`${API_ROOT}/bot${botToken}/${method}`, { method: 'POST', body: form })
  const data = (await res.json()) as TelegramApiResponse<T>
  if (!data.ok) throw new TelegramApiError(method, data.description ?? `HTTP ${res.status}`)
  return data.result as T
}

export interface TelegramUser {
  id: number
  is_bot: boolean
  first_name: string
  username?: string
}

export interface TelegramPhotoSize {
  file_id: string
  file_size?: number
}

export interface TelegramMessage {
  message_id: number
  date: number
  chat: { id: number; type: string }
  from?: TelegramUser
  text?: string
  caption?: string
  photo?: TelegramPhotoSize[]
  video?: { file_id: string; mime_type?: string; file_name?: string }
  audio?: { file_id: string; mime_type?: string; file_name?: string }
  voice?: { file_id: string; mime_type?: string }
  document?: { file_id: string; mime_type?: string; file_name?: string }
}

export interface TelegramUpdate {
  update_id: number
  message?: TelegramMessage
}

export async function getMe(botToken: string): Promise<TelegramUser> {
  return call<TelegramUser>(botToken, 'getMe')
}

/** Long-poll for updates. Resolves after `timeoutSec` with an empty array if nothing arrives. */
export async function getUpdates(
  botToken: string,
  offset: number,
  timeoutSec: number,
  signal?: AbortSignal,
): Promise<TelegramUpdate[]> {
  const res = await fetch(`${API_ROOT}/bot${botToken}/getUpdates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ offset, timeout: timeoutSec, allowed_updates: ['message'] }),
    signal,
  })
  const data = (await res.json()) as TelegramApiResponse<TelegramUpdate[]>
  if (!data.ok) throw new TelegramApiError('getUpdates', data.description ?? `HTTP ${res.status}`)
  return data.result ?? []
}

export async function sendMessage(botToken: string, chatId: string, text: string): Promise<void> {
  await call(botToken, 'sendMessage', { chat_id: chatId, text })
}

export async function sendPhoto(
  botToken: string,
  chatId: string,
  data: Buffer,
  mimeType: string,
  caption?: string,
): Promise<void> {
  await callWithFile(
    botToken,
    'sendPhoto',
    { chat_id: chatId, ...(caption ? { caption } : {}) },
    { field: 'photo', data, fileName: `image.${extensionForMime(mimeType)}`, contentType: mimeType },
  )
}

export async function sendVideo(
  botToken: string,
  chatId: string,
  data: Buffer,
  mimeType: string,
  caption?: string,
): Promise<void> {
  await callWithFile(
    botToken,
    'sendVideo',
    { chat_id: chatId, ...(caption ? { caption } : {}) },
    { field: 'video', data, fileName: `video.${extensionForMime(mimeType)}`, contentType: mimeType },
  )
}

export async function sendAudio(botToken: string, chatId: string, data: Buffer, mimeType: string): Promise<void> {
  await callWithFile(
    botToken,
    'sendAudio',
    { chat_id: chatId },
    { field: 'audio', data, fileName: `audio.${extensionForMime(mimeType)}`, contentType: mimeType },
  )
}

export async function sendDocument(
  botToken: string,
  chatId: string,
  data: Buffer,
  mimeType: string,
  fileName: string,
  caption?: string,
): Promise<void> {
  await callWithFile(
    botToken,
    'sendDocument',
    { chat_id: chatId, ...(caption ? { caption } : {}) },
    { field: 'document', data, fileName, contentType: mimeType },
  )
}

export async function sendChatAction(botToken: string, chatId: string, action: string): Promise<void> {
  await call(botToken, 'sendChatAction', { chat_id: chatId, action })
}

/** Resolve a file_id to bytes (used for downloading inbound media). */
export async function downloadFile(botToken: string, fileId: string): Promise<Buffer> {
  const info = await call<{ file_path?: string }>(botToken, 'getFile', { file_id: fileId })
  if (!info.file_path) throw new TelegramApiError('getFile', 'no file_path returned')
  const res = await fetch(`${API_ROOT}/file/bot${botToken}/${info.file_path}`)
  if (!res.ok) throw new TelegramApiError('downloadFile', `HTTP ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

export function extensionForMime(mimeType: string): string {
  const subtype = mimeType.split('/', 2)[1]?.split(';', 1)[0]?.toLowerCase() ?? 'bin'
  const aliases: Record<string, string> = { jpeg: 'jpg', quicktime: 'mov', mpeg: 'mp3', plain: 'txt' }
  return aliases[subtype] ?? (subtype.replace(/[^a-z0-9]+/g, '') || 'bin')
}

/**
 * Provider-agnostic WhatsApp send API.
 * Inbound handling lives in whatsapp.ts (Baileys) or twilio-whatsapp.ts.
 */
export interface WhatsAppTransport {
  sendText(jid: string, text: string): Promise<void>
  sendImage(jid: string, data: Buffer, mimeType: string, caption?: string): Promise<void>
  sendVideo(jid: string, data: Buffer, mimeType: string, caption?: string): Promise<void>
  sendAudio(jid: string, data: Buffer, mimeType: string): Promise<void>
  sendDocument(
    jid: string,
    data: Buffer,
    mimeType: string,
    fileName: string,
    caption?: string,
  ): Promise<void>
}

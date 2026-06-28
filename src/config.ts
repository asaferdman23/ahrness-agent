export const config = {
  metaAdsMcpUrl: 'https://mcp.facebook.com/ads',
  higgsFieldMcpUrl: process.env.HIGGSFIELD_MCP_URL ?? 'https://mcp.higgsfield.ai/mcp',
  agentName: process.env.AGENT_NAME ?? 'BizzClaw',
  whatsappProvider: process.env.WHATSAPP_PROVIDER ?? 'twilio',
  whatsappPhone: process.env.WHATSAPP_PHONE_NUMBER,
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID ?? '',
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN ?? '',
  twilioWhatsappNumber: process.env.TWILIO_WHATSAPP_NUMBER ?? '+15558136169',
  twilioMessagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID ?? '',
}

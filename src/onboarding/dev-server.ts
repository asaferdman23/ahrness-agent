/**
 * Lightweight onboarding API/static server for frontend development.
 *
 * This intentionally does not start the agent, scheduler, Twilio client, or
 * Baileys socket. Run the full app when testing live WhatsApp transport.
 */
import 'dotenv/config'
import { startCallbackServer } from '../callback-server.js'

startCallbackServer(null)

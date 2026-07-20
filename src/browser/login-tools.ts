import { tool } from '@strands-agents/sdk'
import type { DockerSandbox } from '@strands-agents/sdk/sandbox/docker'
import { createBrowserRuntimeClient, type BrowserRuntimeClient } from './client.js'
import { findLoginFormFields } from './login-field-finder.js'
import { disableVision, enableVision } from './vision-gate.js'
import { siteLoginConnectUrlFor } from './site-login-link.js'
import { getSiteProfile } from '../browser-sites/registry.js'
import { getSiteCredential, getSiteCredentialSecret } from '../store/site-credentials-store.js'
import { resolvePublishedOutputPath } from '../sandbox.js'
import type { PublishedOutput } from '../outputs.js'

function loginUrlFor(domain: string): string {
  return getSiteProfile(domain)?.loginUrl ?? `https://${domain}/login`
}

async function publishScreenshot(
  sandbox: DockerSandbox,
  published: PublishedOutput[],
  client: BrowserRuntimeClient,
  clientId: string,
  fileName: string,
  caption: string,
): Promise<void> {
  const { imageBase64 } = await client.screenshot(clientId)
  const bytes = Buffer.from(imageBase64, 'base64')
  const outputPath = resolvePublishedOutputPath(`outputs/${fileName}`)
  await sandbox.writeFile(outputPath, bytes)
  const item: PublishedOutput = { path: outputPath, fileName, mimeType: 'image/png', caption, size: bytes.length }
  const existing = published.findIndex((candidate) => candidate.path === outputPath)
  if (existing >= 0) published[existing] = item
  else published.push(item)
}

export function createBrowserLoginTools(
  clientId: string,
  jid: string,
  sandbox: DockerSandbox,
  published: PublishedOutput[],
  client: BrowserRuntimeClient = createBrowserRuntimeClient(),
): ReturnType<typeof tool>[] {
  return [
    tool({
      name: 'browser_login',
      description:
        "Logs into the client's own account on a website (e.g. LinkedIn, Instagram, Reddit) using credentials " +
        'the client already saved on the dashboard. If none are saved yet, returns a one-tap link for the client ' +
        'to add one. Never pass a username or password as arguments — this tool reads them from the vault directly.',
      inputSchema: {
        type: 'object',
        properties: { domain: { type: 'string', description: 'The site to log into, e.g. "linkedin.com"' } },
        required: ['domain'],
        additionalProperties: false,
      },
      callback: async (rawInput: unknown) => {
        const input = rawInput as { domain: string }
        const domain = input.domain.trim().toLowerCase()

        const credential = await getSiteCredential(clientId, domain)
        if (!credential) {
          const link = siteLoginConnectUrlFor(process.env.CALLBACK_BASE_URL ?? 'http://localhost:3000', jid, domain)
          return `I don't have a saved login for ${domain} yet. Tap this link to add one (about 20 seconds): ${link}`
        }

        await client.navigate(clientId, loginUrlFor(domain))
        await publishScreenshot(
          sandbox,
          published,
          client,
          clientId,
          `login-${domain.replace(/[^a-z0-9.-]/g, '-')}-before.png`,
          `Logging into ${domain} on your behalf — here's the page I'm connecting to.`,
        )

        disableVision(clientId)
        try {
          const { elements } = await client.elements(clientId)
          const fields = findLoginFormFields(elements)
          if (fields.usernameIndex === null || fields.passwordIndex === null) {
            throw new Error(`Could not find a recognizable login form on ${domain}'s login page.`)
          }
          const password = await getSiteCredentialSecret(clientId, domain)
          if (!password) throw new Error(`No saved password found for ${domain} — the credential may have been removed.`)

          await client.type(clientId, { index: fields.usernameIndex, text: credential.username })
          await client.type(clientId, { index: fields.passwordIndex, text: password })
          if (fields.submitIndex !== null) {
            await client.click(clientId, { index: fields.submitIndex })
          }
        } finally {
          enableVision(clientId)
        }

        await publishScreenshot(
          sandbox,
          published,
          client,
          clientId,
          `login-${domain.replace(/[^a-z0-9.-]/g, '-')}-after.png`,
          `You're in on ${domain}.`,
        )

        return `Logged into ${domain} as ${credential.username}.`
      },
    }),
  ]
}

# Ahrness Agent

WhatsApp agent for Meta Ads management and Higgsfield creative generation.

## Client sandboxes

Execution happens on the server, not on client devices. Each WhatsApp client is
assigned a persistent Docker container and a private host workspace under
`store/workspaces/<hashed-client-id>`.

The agent process and credentials stay outside Docker. Only sandbox shell and
file operations run inside the container. Containers have a read-only root
filesystem, no Linux capabilities, no privilege escalation, resource limits,
and no network access by default. The only writable mount is `/workspace`.

Final files must be written to `/workspace/outputs` and published with the
`publish_output` tool. Published files are read through the sandbox and sent to
the client as WhatsApp documents.

### Setup

1. Install Docker on the server hosting this application.
2. Build the sandbox image:

   ```bash
   docker build -f Dockerfile.sandbox -t ahrness-sandbox:latest .
   ```

3. Copy `.env.example` to `.env` and configure the credentials.
4. Start the application with `npm start`.
5. Connect the shared server-owned Higgsfield account by visiting:

   ```text
   https://your-domain.com/auth/higgsfield/start?key=<HIGGSFIELD_SETUP_SECRET>
   ```

   This is a one-time operator setup. WhatsApp clients never log into Higgsfield.

Docker containers are created automatically on the first authenticated message
from each client and reused across later messages. Clients only interact through
WhatsApp and require no software or technical setup.

Sandbox failures are fail-closed. The application never falls back to host shell
execution when Docker is missing, disabled, or misconfigured.

## Higgsfield generation

Higgsfield runs through its OAuth-protected MCP endpoint on the host process.
Credentials are stored in `store/higgsfield-oauth.json` with owner-only file
permissions and are never mounted into client containers.

Clients can request images, videos, audio, or creative edits in ordinary
WhatsApp messages. Attached WhatsApp media is copied to `/workspace/inbox`.
Completed Higgsfield result URLs are downloaded by a restricted host-side tool,
written to `/workspace/outputs`, and delivered through WhatsApp.
For attachment-based generation, the agent creates a signed, short-lived HTTPS
URL. The URL serves only that inbox file through its client sandbox and expires
after 15 minutes.

`HIGGSFIELD_DAILY_GENERATION_LIMIT` applies a simple per-client daily limit to
protect the shared credit balance. Higgsfield remains optional: Meta Ads and
sandbox features continue working if the shared account is disconnected.

## Process notes

See [`docs/process-log.md`](docs/process-log.md) for the audit trail of the sandbox,
Higgsfield, and campaign-agent investigation performed on this codebase.

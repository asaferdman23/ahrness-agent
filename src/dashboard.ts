/**
 * Dashboard and login pages — protected by better-auth Google session.
 * Uses the same Vercel/Geist design system as onboarding.
 */
import type { User } from './auth.js'

const STYLES = `
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Geist+Mono:wght@400;500;600&family=Geist:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <style>
    :root {
      --canvas: #f7f7f8; --paper: #ffffff; --ink: #0a0a0a;
      --ink-soft: #525252; --ink-faint: #8f8f8f;
      --line: #ebebeb; --line-strong: #dcdcdc;
      --accent: #1dab61; --accent-ink: #0f7a43; --accent-tint: #f0fbf5; --accent-ring: rgba(29,171,97,0.16);
      --r-md: 10px; --r-lg: 16px;
      --shadow-card: 0 1px 2px rgba(10,10,10,0.04),0 8px 32px rgba(10,10,10,0.05);
      --sans: 'Geist',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
      --mono: 'Geist Mono',ui-monospace,'SF Mono',Menlo,monospace;
      --ease: cubic-bezier(0.22,1,0.36,1);
    }
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{font-family:var(--sans);background:var(--canvas);color:var(--ink);min-height:100vh;-webkit-font-smoothing:antialiased;line-height:1.5}
    .bg-grid{position:fixed;inset:0;z-index:0;pointer-events:none;background-image:radial-gradient(rgba(10,10,10,0.045) 1px,transparent 1px);background-size:22px 22px;mask-image:radial-gradient(ellipse 80% 60% at 50% 0%,#000 30%,transparent 75%);-webkit-mask-image:radial-gradient(ellipse 80% 60% at 50% 0%,#000 30%,transparent 75%)}
    .topbar{position:relative;z-index:2;display:flex;align-items:center;justify-content:space-between;gap:1rem;max-width:760px;width:100%;margin:0 auto;padding:1.5rem 1.25rem 0}
    .brand{display:flex;align-items:center;gap:.5rem}
    .brand-mark{width:18px;height:18px;border-radius:5px;background:var(--ink);position:relative;flex:none}
    .brand-mark::after{content:"";position:absolute;inset:5px;border-radius:2px;background:var(--accent)}
    .brand-name{font-weight:600;font-size:.95rem;letter-spacing:-.01em}
    .container{position:relative;z-index:1;max-width:760px;width:100%;margin:0 auto;padding:2rem 1.25rem 4rem}
    .card{background:var(--paper);border:1px solid var(--line);border-radius:var(--r-lg);padding:2rem;box-shadow:var(--shadow-card)}
    h1{font-size:clamp(1.5rem,4vw,1.9rem);font-weight:600;letter-spacing:-.025em;line-height:1.1;margin-bottom:.5rem}
    .subtitle{color:var(--ink-soft);font-size:.95rem;margin-bottom:1.5rem}
    .eyebrow{font-family:var(--mono);font-size:.72rem;letter-spacing:.08em;text-transform:uppercase;color:var(--accent-ink);margin-bottom:.75rem}
    .btn{display:inline-flex;align-items:center;justify-content:center;gap:.5rem;padding:.7rem 1.25rem;border-radius:var(--r-md);font-family:var(--sans);font-size:.9rem;font-weight:500;border:1px solid transparent;cursor:pointer;text-decoration:none;transition:background .15s var(--ease),border-color .15s var(--ease),transform .08s var(--ease)}
    .btn:active{transform:translateY(.5px)}
    .btn-primary{background:var(--ink);color:#fff}
    .btn-primary:hover{background:#262626}
    .btn-outline{background:var(--paper);border-color:var(--line-strong);color:var(--ink)}
    .btn-outline:hover{border-color:var(--ink)}
    .btn-google{background:#fff;border:1px solid var(--line-strong);color:var(--ink);font-weight:500;box-shadow:0 1px 3px rgba(0,0,0,.08)}
    .btn-google:hover{box-shadow:0 2px 8px rgba(0,0,0,.12);border-color:var(--ink-faint)}
    .google-logo{width:18px;height:18px;flex:none}
    .status-row{display:flex;align-items:center;gap:.5rem;font-family:var(--mono);font-size:.75rem;color:var(--ink-faint)}
    .dot{width:7px;height:7px;border-radius:50%;background:var(--line-strong)}
    .dot-live{background:var(--accent);animation:pulse 2.4s var(--ease) infinite}
    @keyframes pulse{0%{box-shadow:0 0 0 0 rgba(29,171,97,.4)}70%{box-shadow:0 0 0 7px rgba(29,171,97,0)}100%{box-shadow:0 0 0 0 rgba(29,171,97,0)}}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin:1.5rem 0}
    @media(max-width:540px){.grid{grid-template-columns:1fr}}
    .stat-card{background:var(--canvas);border:1px solid var(--line);border-radius:var(--r-md);padding:1.1rem 1.25rem}
    .stat-label{font-family:var(--mono);font-size:.7rem;color:var(--ink-faint);letter-spacing:.04em;text-transform:uppercase;margin-bottom:.35rem}
    .stat-value{font-size:1.05rem;font-weight:600;letter-spacing:-.01em}
    .stat-sub{font-size:.8rem;color:var(--ink-soft);margin-top:.15rem}
    .divider{border:none;border-top:1px solid var(--line);margin:1.5rem 0}
    .action-row{display:flex;gap:.75rem;flex-wrap:wrap;margin-top:1.5rem}
    .user-chip{display:flex;align-items:center;gap:.6rem;background:var(--canvas);border:1px solid var(--line);border-radius:999px;padding:.3rem .75rem .3rem .4rem;font-size:.82rem}
    .avatar{width:24px;height:24px;border-radius:50%;background:var(--ink);color:#fff;display:flex;align-items:center;justify-content:center;font-size:.7rem;font-weight:600;flex:none;overflow:hidden}
    .avatar img{width:100%;height:100%;object-fit:cover}
    @keyframes rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
    .topbar{animation:rise .5s var(--ease) both}
    .card{animation:rise .55s var(--ease) .1s both}
    .login-wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:1.5rem}
    .login-card{background:var(--paper);border:1px solid var(--line);border-radius:var(--r-lg);padding:2.5rem 2rem;box-shadow:var(--shadow-card);width:100%;max-width:380px;text-align:center;animation:rise .55s var(--ease) both}
    .login-mark{width:44px;height:44px;border-radius:12px;background:var(--ink);position:relative;margin:0 auto 1.25rem}
    .login-mark::after{content:"";position:absolute;inset:12px;border-radius:4px;background:var(--accent)}
    @media(max-width:540px){.card{padding:1.5rem 1.25rem}}
  </style>`

function layout(title: string, body: string, agentName = process.env.AGENT_NAME ?? 'BizzClaw'): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title} — ${agentName}</title>
  ${STYLES}
</head>
<body>
  <div class="bg-grid" aria-hidden="true"></div>
  ${body}
</body>
</html>`
}

const GOOGLE_SVG = `<svg class="google-logo" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
  <path d="M17.64 9.2a10 10 0 0 0-.16-1.7H9v3.22h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92a8.78 8.78 0 0 0 2.68-6.5z" fill="#4285F4"/>
  <path d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26a5.4 5.4 0 0 1-8.07-2.83H.97v2.33A9 9 0 0 0 9 18z" fill="#34A853"/>
  <path d="M3.98 10.73a5.41 5.41 0 0 1 0-3.46V4.94H.97a9 9 0 0 0 0 8.12l3.01-2.33z" fill="#FBBC05"/>
  <path d="M9 3.58a4.86 4.86 0 0 1 3.44 1.35l2.58-2.58A8.64 8.64 0 0 0 9 0 9 9 0 0 0 .97 4.94L4 7.27A5.37 5.37 0 0 1 9 3.58z" fill="#EA4335"/>
</svg>`

export function renderLoginPage(agentName: string, error?: string): string {
  const name = agentName || 'BizzClaw'
  return layout('Sign In', `
  <div class="login-wrap">
    <div class="login-card">
      <div class="login-mark" aria-hidden="true"></div>
      <h1 style="font-size:1.5rem;margin-bottom:.4rem">${name}</h1>
      <p class="subtitle" style="font-size:.9rem;margin-bottom:1.75rem">
        Your AI business agent — on WhatsApp, working for you around the clock.
      </p>
      ${error ? `<p style="color:#c0381f;font-size:.84rem;margin-bottom:1rem;padding:.6rem .85rem;background:#fff1f0;border-radius:8px;border:1px solid #f5c6c0">${error}</p>` : ''}
      <button id="google-btn" onclick="signInWithGoogle()" class="btn btn-google" style="width:100%;justify-content:center">
        ${GOOGLE_SVG}
        Sign in with Google
      </button>
      <script>
        async function signInWithGoogle() {
          const btn = document.getElementById('google-btn');
          btn.disabled = true;
          btn.style.opacity = '0.6';
          try {
            const res = await fetch('/api/auth/sign-in/social', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ provider: 'google', callbackURL: '/dashboard' })
            });
            const data = await res.json();
            if (data.url) window.location.href = data.url;
            else throw new Error('No redirect URL');
          } catch (e) {
            btn.disabled = false;
            btn.style.opacity = '1';
            alert('Sign-in failed. Please try again.');
          }
        }
      </script>
      <p style="font-size:.75rem;color:var(--ink-faint);margin-top:1.25rem;line-height:1.5">
        By signing in you agree that your information is processed to run your AI agent.
      </p>
    </div>
  </div>`)
}

export function renderDashboardPage(user: User, state: {
  whatsappLinked: boolean
  whatsappJid: string | null
  whatsappProvider: string | null
  onboardingStep: number
}): string {
  const agentName = process.env.AGENT_NAME ?? 'BizzClaw'
  const initials = (user.name ?? user.email ?? '?').slice(0, 2).toUpperCase()
  const avatar = user.image
    ? `<img src="${user.image}" alt="${user.name ?? 'you'}" />`
    : initials

  const isLive = state.whatsappLinked
  const statusDot = isLive ? 'dot dot-live' : 'dot'
  const statusText = isLive ? 'agent · live' : 'agent · not connected'

  const waNumber = state.whatsappJid ? state.whatsappJid.replace(/@.*$/, '') : null
  const waLink = waNumber ? `https://wa.me/${waNumber}` : null

  const setupStep = state.onboardingStep

  return layout('Dashboard', `
  <header class="topbar">
    <div class="brand">
      <span class="brand-mark" aria-hidden="true"></span>
      <span class="brand-name">${agentName}</span>
    </div>
    <div style="display:flex;align-items:center;gap:.75rem">
      <div class="status-row">
        <span class="${statusDot}" aria-hidden="true"></span>
        <span>${statusText}</span>
      </div>
      <div class="user-chip">
        <div class="avatar">${avatar}</div>
        <span style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${user.name ?? user.email}</span>
      </div>
    </div>
  </header>
  <main class="container">
    <div class="card">
      <div class="eyebrow">Overview</div>
      <h1>${isLive ? 'Your agent is live' : 'Finish setup to go live'}</h1>
      <p class="subtitle">
        ${isLive
          ? `${agentName} is running on WhatsApp and ready to assist.`
          : `Complete ${setupStep < 6 ? `step ${setupStep} of 6 in` : ''} onboarding to connect your WhatsApp and go live.`}
      </p>

      <div class="grid">
        <div class="stat-card">
          <div class="stat-label">Status</div>
          <div class="stat-value" style="color:${isLive ? 'var(--accent-ink)' : 'var(--ink-soft)'}">
            ${isLive ? 'Live' : 'Inactive'}
          </div>
          <div class="stat-sub">${isLive ? 'Receiving WhatsApp messages' : 'WhatsApp not connected'}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Account</div>
          <div class="stat-value" style="font-size:.92rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${user.email}</div>
          <div class="stat-sub">Google account</div>
        </div>
      </div>

      <hr class="divider" />

      <div class="action-row">
        ${isLive
          ? `
          <a href="${waLink}" class="btn btn-primary">
            💬 Open WhatsApp
          </a>
          <a href="/onboarding/step/4" class="btn btn-outline">Manage Connections</a>
          `
          : `
          <a href="/onboarding/step/${Math.min(setupStep, 6)}" class="btn btn-primary">
            ${setupStep <= 1 ? 'Start Setup →' : `Continue Setup (step ${setupStep}) →`}
          </a>
          `
        }
        <a href="/api/auth/sign-out?callbackURL=/login" class="btn btn-outline" style="margin-left:auto">Sign out</a>
      </div>
    </div>
  </main>`)
}

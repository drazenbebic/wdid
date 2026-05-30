import { createHash, randomBytes } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { URL } from 'node:url';
import open from 'open';
import type { WdidConfig } from '../config.js';

declare const __GOOGLE_CLIENT_ID__: string;
declare const __GOOGLE_CLIENT_SECRET__: string;

export interface GoogleCredentials {
  clientId: string;
  clientSecret: string;
}

export interface OAuthResult {
  refreshToken: string;
  accessToken: string;
  email: string;
}

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
];

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const FLOW_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Resolve Google OAuth credentials.
 *
 * Precedence: user config > runtime env var > build-time bundled.
 * Returns null when no credentials are available — caller should surface a
 * clear "no OAuth client configured" error.
 */
export function getGoogleCredentials(
  config: WdidConfig,
): GoogleCredentials | null {
  const clientId =
    config.gcalClientId ?? process.env.GOOGLE_CLIENT_ID ?? __GOOGLE_CLIENT_ID__;
  const clientSecret =
    config.gcalClientSecret ??
    process.env.GOOGLE_CLIENT_SECRET ??
    __GOOGLE_CLIENT_SECRET__;

  if (!clientId || !clientSecret) {
    return null;
  }

  return { clientId, clientSecret };
}

function base64UrlEncode(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function generatePkce(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = base64UrlEncode(randomBytes(32));
  const codeChallenge = base64UrlEncode(
    createHash('sha256').update(codeVerifier).digest(),
  );

  return { codeVerifier, codeChallenge };
}

function buildAuthUrl(
  clientId: string,
  redirectUri: string,
  state: string,
  codeChallenge: string,
): string {
  const url = new URL(AUTH_URL);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', SCOPES.join(' '));
  url.searchParams.set('access_type', 'offline');
  // prompt=consent forces Google to return a refresh_token every time, not
  // just on the first authorization. Without this, re-auth after a logout
  // may yield only an access_token.
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');

  return url.toString();
}

function renderPage(message: string, error: boolean): string {
  const color = error ? '#dc2626' : '#16a34a';
  const title = error ? 'wdid · auth failed' : 'wdid · auth complete';

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title>
<style>
  body { font-family: ui-sans-serif, system-ui, sans-serif; padding: 2rem;
         max-width: 32rem; margin: 4rem auto; color: #111; }
  h1 { color: ${color}; font-size: 1.5rem; }
  p { color: #444; }
</style></head>
<body>
  <h1>${title}</h1>
  <p>${message}</p>
</body></html>`;
}

interface CallbackServer {
  port: number;
  /** Resolves with the auth code once Google redirects back. */
  awaitCode: Promise<string>;
  close: () => void;
}

/**
 * Start a localhost HTTP server that listens for Google's OAuth redirect.
 *
 * Returns the chosen port synchronously (after `listen` resolves) along with
 * a Promise that resolves to the auth code when Google redirects back to
 * /callback. The server is closed by the caller once the flow completes.
 */
function startCallbackServer(expectedState: string): Promise<CallbackServer> {
  return new Promise((resolve, reject) => {
    let codeResolve: (code: string) => void;
    let codeReject: (err: Error) => void;
    const awaitCode = new Promise<string>((res, rej) => {
      codeResolve = res;
      codeReject = rej;
    });

    const server: Server = createServer(
      (req: IncomingMessage, res: ServerResponse) => {
        if (!req.url) {
          res.statusCode = 400;
          res.end('Bad request');

          return;
        }

        const url = new URL(req.url, 'http://127.0.0.1');

        if (url.pathname !== '/callback') {
          res.statusCode = 404;
          res.end('Not found');

          return;
        }

        const error = url.searchParams.get('error');

        if (error) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end(renderPage(`Authorization failed: ${error}`, true));
          codeReject(new Error(`Google returned error: ${error}`));

          return;
        }

        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');

        if (!code || !state) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end(renderPage('Missing code or state.', true));
          codeReject(new Error('callback missing code or state'));

          return;
        }

        if (state !== expectedState) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end(renderPage('State mismatch — possible CSRF.', true));
          codeReject(new Error('OAuth state mismatch'));

          return;
        }

        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(
          renderPage(
            'You can close this tab and return to the terminal.',
            false,
          ),
        );
        codeResolve(code);
      },
    );

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();

      if (!addr || typeof addr === 'string') {
        server.close();
        reject(new Error('server did not bind to a port'));

        return;
      }

      resolve({
        port: addr.port,
        awaitCode,
        close: () => server.close(),
      });
    });
  });
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
}

async function exchangeCodeForTokens(
  creds: GoogleCredentials,
  code: string,
  codeVerifier: string,
  redirectUri: string,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    code,
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    code_verifier: codeVerifier,
  });

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `token exchange failed: ${res.status} ${res.statusText} — ${text}`,
    );
  }

  return (await res.json()) as TokenResponse;
}

async function fetchUserEmail(accessToken: string): Promise<string> {
  const res = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    throw new Error(`userinfo fetch failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as { email?: string };

  if (!data.email) {
    throw new Error('userinfo response did not include email');
  }

  return data.email;
}

/**
 * Run the installed-app OAuth flow end-to-end.
 *
 * 1. Spawn a localhost callback server on an ephemeral port.
 * 2. Open the user's browser to Google's consent screen with PKCE + state.
 * 3. Wait for the redirect, validate state, exchange code for tokens.
 * 4. Fetch the authorized user's email for display in `wdid gcal status`.
 *
 * Rejects if the user doesn't authorize within FLOW_TIMEOUT_MS, or if any
 * step in the OAuth exchange fails.
 */
export async function runInstalledAppOAuth(
  creds: GoogleCredentials,
): Promise<OAuthResult> {
  const state = base64UrlEncode(randomBytes(16));
  const { codeVerifier, codeChallenge } = generatePkce();

  const server = await startCallbackServer(state);
  const redirectUri = `http://127.0.0.1:${server.port}/callback`;

  try {
    const authUrl = buildAuthUrl(
      creds.clientId,
      redirectUri,
      state,
      codeChallenge,
    );

    // Race the user's authorization against a timeout so an abandoned flow
    // doesn't leave the CLI hanging.
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              `OAuth flow timed out after ${FLOW_TIMEOUT_MS / 1000}s. Try again.`,
            ),
          ),
        FLOW_TIMEOUT_MS,
      ).unref(),
    );

    await open(authUrl);

    const code = await Promise.race([server.awaitCode, timeout]);
    const tokens = await exchangeCodeForTokens(
      creds,
      code,
      codeVerifier,
      redirectUri,
    );

    if (!tokens.refresh_token) {
      throw new Error(
        'Google did not return a refresh_token. ' +
          'Run `wdid gcal logout` then `wdid gcal auth` again to force re-consent.',
      );
    }

    const email = await fetchUserEmail(tokens.access_token);

    return {
      refreshToken: tokens.refresh_token,
      accessToken: tokens.access_token,
      email,
    };
  } finally {
    server.close();
  }
}

/**
 * Exchange a stored refresh token for a fresh access token.
 *
 * Google's access tokens last ~1 hour; we don't bother caching them — every
 * sync invocation gets a new one. The refresh token itself is long-lived and
 * persists in wdid config.
 */
export async function refreshAccessToken(
  creds: GoogleCredentials,
  refreshToken: string,
): Promise<string> {
  const body = new URLSearchParams({
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `refresh failed: ${res.status} ${res.statusText} — ${text}. ` +
        'You may need to re-run `wdid gcal auth`.',
    );
  }

  const data = (await res.json()) as TokenResponse;

  return data.access_token;
}

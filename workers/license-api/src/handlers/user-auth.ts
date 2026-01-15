/**
 * User Wallet Authentication Handlers
 * Provides /auth/sign page and /auth/verify endpoint for VSCode extension users
 */

import type { Context } from 'hono';
import type { Env } from '../types';

/**
 * Generate a signing challenge for user authentication
 */
export async function generateUserChallenge(env: Env): Promise<string> {
  const timestamp = Date.now();
  const randomBytes = new Uint8Array(16);
  crypto.getRandomValues(randomBytes);
  const random = Array.from(randomBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return `SpecFlow Authentication Challenge\n\nTimestamp: ${timestamp}\nRandom: ${random}\n\nSign this message to authenticate with SpecFlow.`;
}

/**
 * Verify user signature using NEP-413 format
 */
export async function verifyUserSignature(
  env: Env,
  params: {
    nearAccountId: string;
    signature: string;
    publicKey: string;
    message: string;
    nonce?: number[];
    recipient?: string;
  }
): Promise<{ valid: boolean; error?: string }> {
  const { nearAccountId, signature, publicKey, message, nonce, recipient } = params;

  try {
    // Dynamically import to avoid bundling issues
    const { PublicKey } = await import('@near-js/crypto');

    // Validate public key format
    if (!publicKey.startsWith('ed25519:')) {
      return { valid: false, error: 'Invalid public key format' };
    }

    const pubKey = PublicKey.fromString(publicKey);

    // Decode signature - NEAR wallets typically use base64
    // but the format may vary by wallet
    let signatureBytes: Uint8Array;

    console.log('Signature verification attempt:', {
      signatureLength: signature.length,
      signaturePreview: signature.substring(0, 50) + '...',
      publicKey,
      messageLength: message.length,
    });

    // Try different encodings to find the one that produces 64 bytes
    const encodingAttempts: { name: string; bytes: Uint8Array | null }[] = [];

    // 1. Try standard base64
    try {
      const bytes = Uint8Array.from(atob(signature), (c) => c.charCodeAt(0));
      encodingAttempts.push({ name: 'base64', bytes });
    } catch {
      encodingAttempts.push({ name: 'base64', bytes: null });
    }

    // 2. Try URL-safe base64 (replace - with + and _ with /)
    try {
      const normalizedSig = signature.replace(/-/g, '+').replace(/_/g, '/');
      const bytes = Uint8Array.from(atob(normalizedSig), (c) => c.charCodeAt(0));
      encodingAttempts.push({ name: 'base64url', bytes });
    } catch {
      encodingAttempts.push({ name: 'base64url', bytes: null });
    }

    // 3. Try base58
    try {
      const bytes = decodeBase58(signature);
      encodingAttempts.push({ name: 'base58', bytes });
    } catch {
      encodingAttempts.push({ name: 'base58', bytes: null });
    }

    console.log('Encoding attempts:', encodingAttempts.map(a => ({
      name: a.name,
      length: a.bytes?.length ?? 'failed'
    })));

    // Find the encoding that produces 64 bytes (ed25519 signature length)
    const validAttempt = encodingAttempts.find(a => a.bytes?.length === 64);
    if (validAttempt?.bytes) {
      signatureBytes = validAttempt.bytes;
      console.log(`Using ${validAttempt.name} encoding`);
    } else {
      // If none produce 64 bytes, use the first successful decode
      const anySuccess = encodingAttempts.find(a => a.bytes !== null);
      if (anySuccess?.bytes) {
        signatureBytes = anySuccess.bytes;
        console.log(`No 64-byte encoding found, using ${anySuccess.name} with ${anySuccess.bytes.length} bytes`);
      } else {
        return { valid: false, error: 'Invalid signature format' };
      }
    }

    // Verify using NEP-413 if nonce and recipient provided
    if (nonce && recipient) {
      if (nonce.length !== 32) {
        return { valid: false, error: 'Invalid nonce length' };
      }

      // Create NEP-413 payload hash
      const payloadHash = await createNep413PayloadHash(message, nonce, recipient);
      const isValid = pubKey.verify(payloadHash, signatureBytes);

      if (!isValid) {
        return { valid: false, error: 'Invalid signature' };
      }
    } else {
      // Fallback to raw message verification
      const messageBytes = new TextEncoder().encode(message);
      const isValid = pubKey.verify(messageBytes, signatureBytes);

      if (!isValid) {
        return { valid: false, error: 'Invalid signature' };
      }
    }

    return { valid: true };
  } catch (error) {
    console.error('Signature verification error:', error);
    return { valid: false, error: 'Signature verification failed' };
  }
}

/**
 * Create NEP-413 payload hash for signature verification
 */
async function createNep413PayloadHash(
  message: string,
  nonce: number[],
  recipient: string
): Promise<Uint8Array> {
  // NEP-413 tag: 2^31 + 413 = 2147484061
  const tag = 2147484061;

  // Borsh encode the payload
  const payloadBytes = borshSerializeNep413Payload(message, nonce, recipient);

  // Prepend the tag (4 bytes, little-endian)
  const tagBytes = new Uint8Array(4);
  tagBytes[0] = tag & 0xff;
  tagBytes[1] = (tag >> 8) & 0xff;
  tagBytes[2] = (tag >> 16) & 0xff;
  tagBytes[3] = (tag >> 24) & 0xff;

  // Concatenate tag + payload
  const fullPayload = new Uint8Array(tagBytes.length + payloadBytes.length);
  fullPayload.set(tagBytes, 0);
  fullPayload.set(payloadBytes, tagBytes.length);

  // SHA-256 hash
  const hashBuffer = await crypto.subtle.digest('SHA-256', fullPayload);
  return new Uint8Array(hashBuffer);
}

/**
 * Borsh serialize NEP-413 payload
 */
function borshSerializeNep413Payload(
  message: string,
  nonce: number[],
  recipient: string
): Uint8Array {
  const encoder = new TextEncoder();

  // Encode message (4-byte length prefix + UTF-8 bytes)
  const messageBytes = encoder.encode(message);
  const messageLenBytes = new Uint8Array(4);
  messageLenBytes[0] = messageBytes.length & 0xff;
  messageLenBytes[1] = (messageBytes.length >> 8) & 0xff;
  messageLenBytes[2] = (messageBytes.length >> 16) & 0xff;
  messageLenBytes[3] = (messageBytes.length >> 24) & 0xff;

  // Nonce is fixed 32 bytes
  const nonceBytes = new Uint8Array(nonce);

  // Encode recipient (4-byte length prefix + UTF-8 bytes)
  const recipientBytes = encoder.encode(recipient);
  const recipientLenBytes = new Uint8Array(4);
  recipientLenBytes[0] = recipientBytes.length & 0xff;
  recipientLenBytes[1] = (recipientBytes.length >> 8) & 0xff;
  recipientLenBytes[2] = (recipientBytes.length >> 16) & 0xff;
  recipientLenBytes[3] = (recipientBytes.length >> 24) & 0xff;

  // callbackUrl is None (1 byte = 0)
  const callbackUrlBytes = new Uint8Array([0]);

  // Concatenate all parts
  const totalLength =
    messageLenBytes.length +
    messageBytes.length +
    nonceBytes.length +
    recipientLenBytes.length +
    recipientBytes.length +
    callbackUrlBytes.length;

  const result = new Uint8Array(totalLength);
  let offset = 0;

  result.set(messageLenBytes, offset);
  offset += messageLenBytes.length;
  result.set(messageBytes, offset);
  offset += messageBytes.length;
  result.set(nonceBytes, offset);
  offset += nonceBytes.length;
  result.set(recipientLenBytes, offset);
  offset += recipientLenBytes.length;
  result.set(recipientBytes, offset);
  offset += recipientBytes.length;
  result.set(callbackUrlBytes, offset);

  return result;
}

/**
 * Base58 alphabet used by NEAR
 */
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * Decode base58 string to Uint8Array
 */
function decodeBase58(str: string): Uint8Array {
  if (str.length === 0) {
    return new Uint8Array(0);
  }

  // Count leading zeros
  let zeros = 0;
  for (let i = 0; i < str.length && str[i] === '1'; i++) {
    zeros++;
  }

  // Convert base58 to big integer
  let result = BigInt(0);
  for (let i = 0; i < str.length; i++) {
    const charIndex = BASE58_ALPHABET.indexOf(str[i]);
    if (charIndex === -1) {
      throw new Error(`Invalid base58 character: ${str[i]}`);
    }
    result = result * BigInt(58) + BigInt(charIndex);
  }

  // Convert big integer to bytes
  const bytes: number[] = [];
  while (result > 0) {
    bytes.unshift(Number(result % BigInt(256)));
    result = result / BigInt(256);
  }

  // Add leading zeros
  for (let i = 0; i < zeros; i++) {
    bytes.unshift(0);
  }

  return new Uint8Array(bytes);
}

/**
 * Create JWT for authenticated user
 */
export async function createUserJwt(env: Env, nearAccountId: string): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    sub: nearAccountId,
    type: 'user',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 24 * 60 * 60, // 24 hours
  };

  const encoder = new TextEncoder();

  // Use ADMIN_SECRET as JWT signing key (same secret, different token type)
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(env.ADMIN_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const headerB64 = btoa(JSON.stringify(header))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  const payloadB64 = btoa(JSON.stringify(payload))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

  const signatureInput = encoder.encode(`${headerB64}.${payloadB64}`);
  const signatureBuffer = await crypto.subtle.sign('HMAC', key, signatureInput);
  const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

  return `${headerB64}.${payloadB64}.${signatureB64}`;
}

/**
 * User authentication sign page HTML
 * Professional branded page for VSCode extension users
 */
export function userSignPage(
  network: string,
  params: {
    nonce: string;
    timestamp: string;
    message: string;
    callback: string;
  }
): string {
  const { nonce, timestamp, message, callback } = params;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Connect Wallet - SpecFlow</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    @keyframes gradient {
      0% { background-position: 0% 50%; }
      50% { background-position: 100% 50%; }
      100% { background-position: 0% 50%; }
    }
    .gradient-bg {
      background: linear-gradient(-45deg, #1e3a5f, #2d5a87, #1a4971, #234e6c);
      background-size: 400% 400%;
      animation: gradient 15s ease infinite;
    }
    .glass {
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
    }
  </style>
</head>
<body class="gradient-bg min-h-screen flex items-center justify-center p-4">
  <div class="glass max-w-md w-full rounded-2xl shadow-2xl p-8">
    <!-- Header -->
    <div class="text-center mb-8">
      <div class="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl mb-4">
        <svg class="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"></path>
        </svg>
      </div>
      <h1 class="text-2xl font-bold text-gray-900">Connect to SpecFlow</h1>
      <p class="text-gray-600 mt-2">Sign in with your NEAR wallet to continue</p>
    </div>

    <!-- Main Content -->
    <div id="auth-container">
      <!-- Connect State -->
      <div id="step-connect" class="space-y-6">
        <div class="bg-blue-50 border border-blue-100 rounded-lg p-4">
          <div class="flex items-start">
            <svg class="w-5 h-5 text-blue-500 mt-0.5 mr-3 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"></path>
            </svg>
            <div>
              <h3 class="text-sm font-medium text-blue-800">Secure Authentication</h3>
              <p class="text-sm text-blue-700 mt-1">
                Your wallet will sign a message to verify ownership. No tokens will be transferred.
              </p>
            </div>
          </div>
        </div>

        <button
          id="connect-btn"
          class="w-full flex items-center justify-center gap-3 py-4 px-6 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-semibold rounded-xl shadow-lg transition-all duration-200 transform hover:scale-[1.02]"
        >
          <svg class="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
            <path d="M21 18v1c0 1.1-.9 2-2 2H5c-1.11 0-2-.9-2-2V5c0-1.1.89-2 2-2h14c1.1 0 2 .9 2 2v1h-9c-1.11 0-2 .9-2 2v8c0 1.1.89 2 2 2h9zm-9-2h10V8H12v8zm4-2.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/>
          </svg>
          Connect NEAR Wallet
        </button>

        <p class="text-xs text-center text-gray-500">
          Supports Meteor, HOT, MyNearWallet, Mintbase, and more
        </p>
      </div>

      <!-- Signing State -->
      <div id="step-signing" class="hidden space-y-6">
        <div class="flex flex-col items-center py-8">
          <div class="relative">
            <div class="w-16 h-16 border-4 border-blue-200 rounded-full"></div>
            <div class="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin absolute top-0"></div>
          </div>
          <p class="text-gray-600 mt-6" id="signing-message">Connecting to wallet...</p>
        </div>
      </div>

      <!-- Success State -->
      <div id="step-success" class="hidden space-y-6">
        <div class="flex flex-col items-center py-8">
          <div class="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
            <svg class="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
            </svg>
          </div>
          <h3 class="text-xl font-semibold text-gray-900 mt-4">Connected!</h3>
          <p class="text-gray-600 mt-2" id="success-message">Redirecting back to VSCode...</p>
          <p class="text-sm text-gray-500 mt-4 hidden" id="manual-redirect-hint">
            If VSCode doesn't open automatically,
            <a href="#" id="manual-redirect-link" class="text-blue-600 hover:underline font-medium">click here</a>
          </p>
        </div>
      </div>

      <!-- Error State -->
      <div id="step-error" class="hidden space-y-6">
        <div class="bg-red-50 border border-red-100 rounded-lg p-4">
          <div class="flex items-start">
            <svg class="w-5 h-5 text-red-500 mt-0.5 mr-3 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"></path>
            </svg>
            <div>
              <h3 class="text-sm font-medium text-red-800">Authentication Failed</h3>
              <p class="text-sm text-red-700 mt-1" id="error-message">An error occurred</p>
            </div>
          </div>
        </div>
        <button
          id="retry-btn"
          class="w-full py-3 px-6 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-xl transition-colors"
        >
          Try Again
        </button>
      </div>
    </div>

    <!-- Footer -->
    <div class="mt-8 pt-6 border-t border-gray-200">
      <p class="text-xs text-center text-gray-400">
        By connecting, you agree to SpecFlow's
        <a href="https://specflow.dev/terms" class="text-blue-500 hover:underline">Terms</a> and
        <a href="https://specflow.dev/privacy" class="text-blue-500 hover:underline">Privacy Policy</a>
      </p>
    </div>
  </div>

  <script type="module">
    import { NearConnector } from 'https://esm.sh/@hot-labs/near-connect';

    // Parameters from extension
    const params = {
      nonce: '${nonce}',
      timestamp: '${timestamp}',
      message: decodeURIComponent('${encodeURIComponent(message)}'),
      callback: decodeURIComponent('${encodeURIComponent(callback)}')
    };

    let connector = null;
    let connectedAccountId = null;

    // Initialize connector
    async function initConnector() {
      connector = new NearConnector({
        network: '${network}',
        features: { signMessage: true }
      });

      connector.on('wallet:signIn', async (event) => {
        if (event.accounts && event.accounts.length > 0) {
          connectedAccountId = event.accounts[0].accountId;
        }
      });

      return connector;
    }

    // Main auth flow
    async function handleConnect() {
      showStep('signing');
      setMessage('Initializing wallet connector...');

      try {
        if (!connector) {
          await initConnector();
        }

        setMessage('Opening wallet selector...');
        const wallet = await connector.connect();

        const { accounts } = await connector.getConnectedWallet();
        if (!accounts || accounts.length === 0) {
          throw new Error('No accounts found');
        }
        connectedAccountId = accounts[0].accountId;

        setMessage('Please sign the message in your wallet...');

        // Create nonce for NEP-413
        const nonce = new Uint8Array(32);
        crypto.getRandomValues(nonce);

        // Sign the challenge message from extension
        const signResult = await wallet.signMessage({
          message: params.message,
          recipient: 'specflow-auth',
          nonce: Array.from(nonce),
        });

        if (!signResult || !signResult.signature) {
          throw new Error('Signing was cancelled or failed');
        }

        setMessage('Verifying signature...');

        // Verify with server
        const verifyResponse = await fetch('/auth/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            nearAccountId: signResult.accountId || connectedAccountId,
            signature: signResult.signature,
            publicKey: signResult.publicKey,
            message: params.message,
            nonce: Array.from(nonce),
            recipient: 'specflow-auth',
          })
        });

        const verifyData = await verifyResponse.json();

        if (verifyResponse.ok && verifyData.token) {
          showStep('success');

          // Build callback URL with auth data
          // Use snake_case to match extension's expected parameter names
          // Include token and expires_at so extension can skip re-verification
          const callbackUrl = new URL(params.callback);
          callbackUrl.searchParams.set('account_id', signResult.accountId || connectedAccountId);
          callbackUrl.searchParams.set('signature', signResult.signature);
          callbackUrl.searchParams.set('public_key', signResult.publicKey);
          callbackUrl.searchParams.set('token', verifyData.token);
          callbackUrl.searchParams.set('expires_at', verifyData.expires_at.toString());

          const finalUrl = callbackUrl.toString();
          console.log('Redirecting to:', finalUrl);

          // Set up manual redirect link
          const manualLink = document.getElementById('manual-redirect-link');
          if (manualLink) {
            manualLink.href = finalUrl;
          }

          // Try to redirect back to VSCode
          setTimeout(() => {
            window.location.href = finalUrl;

            // Show manual link after a delay if we're still on this page
            setTimeout(() => {
              const hint = document.getElementById('manual-redirect-hint');
              if (hint) {
                hint.classList.remove('hidden');
              }
              document.getElementById('success-message').textContent =
                'Authentication successful! You can close this window.';
            }, 2000);
          }, 1000);
        } else {
          throw new Error(verifyData.error || 'Verification failed');
        }
      } catch (err) {
        console.error('Auth error:', err);
        showError(err.message || 'Authentication failed');
      }
    }

    // UI helpers
    function showStep(step) {
      document.getElementById('step-connect').classList.add('hidden');
      document.getElementById('step-signing').classList.add('hidden');
      document.getElementById('step-success').classList.add('hidden');
      document.getElementById('step-error').classList.add('hidden');
      document.getElementById('step-' + step).classList.remove('hidden');
    }

    function setMessage(msg) {
      document.getElementById('signing-message').textContent = msg;
    }

    function showError(msg) {
      document.getElementById('error-message').textContent = msg;
      showStep('error');
    }

    // Event handlers
    document.getElementById('connect-btn').addEventListener('click', handleConnect);
    document.getElementById('retry-btn').addEventListener('click', () => showStep('connect'));
  </script>
</body>
</html>`;
}

// ============================================================================
// Route Handlers
// ============================================================================

/**
 * GET /auth/sign - User authentication page
 */
export function handleUserSignPage(c: Context<{ Bindings: Env }>): Response {
  const nonce = c.req.query('nonce') || '';
  const timestamp = c.req.query('timestamp') || '';
  const message = c.req.query('message') || '';
  const callback = c.req.query('callback') || '';

  if (!nonce || !timestamp || !message || !callback) {
    return c.json({ error: 'Missing required parameters' }, 400);
  }

  return c.html(userSignPage(c.env.NEAR_NETWORK, { nonce, timestamp, message, callback }));
}

/**
 * POST /auth/verify - Verify user signature and return JWT
 * Accepts both camelCase (from sign page) and snake_case (from extension) field names
 */
export async function handleUserVerify(c: Context<{ Bindings: Env }>): Promise<Response> {
  const body = await c.req.json<{
    // camelCase (from sign page)
    nearAccountId?: string;
    publicKey?: string;
    // snake_case (from extension)
    account_id?: string;
    public_key?: string;
    // common fields
    signature: string;
    message: string;
    nonce?: number[] | string;
    recipient?: string;
    timestamp?: number;
  }>();

  // Support both naming conventions
  const nearAccountId = body.nearAccountId || body.account_id;
  const publicKey = body.publicKey || body.public_key;
  const { signature, message, recipient } = body;

  // Handle nonce - can be array (from sign page) or string (from extension challenge)
  let nonce: number[] | undefined;
  if (Array.isArray(body.nonce)) {
    nonce = body.nonce;
  }
  // If nonce is a string (extension's challenge nonce), we skip NEP-413 verification

  if (!nearAccountId || !signature || !publicKey || !message) {
    return c.json({ error: 'Missing required fields' }, 400);
  }

  const result = await verifyUserSignature(c.env, {
    nearAccountId,
    signature,
    publicKey,
    message,
    nonce,
    recipient,
  });

  if (!result.valid) {
    return c.json({ error: result.error }, 401);
  }

  const token = await createUserJwt(c.env, nearAccountId);
  return c.json({
    token,
    expires_at: Date.now() + 24 * 60 * 60 * 1000, // 24 hours in ms
  });
}

/**
 * Cloudflare Worker environment bindings
 */
export interface Env {
  // KV Namespaces
  PROCESSED_EVENTS: KVNamespace;
  SUBSCRIPTIONS: KVNamespace;
  CRYPTO_SUBSCRIPTIONS: KVNamespace;
  TELEMETRY: KVNamespace;
  USER_LICENSES: KVNamespace;

  // Secrets (set via wrangler secret put)
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  STRIPE_PRICE_ID: string;
  NEAR_PRIVATE_KEY: string;
  LICENSE_CONTRACT_ID: string;
  NEAR_NETWORK: string;
  FASTNEAR_API_KEY: string;
  NEAR_INTENTS_API_KEY: string;
  ADMIN_SECRET: string; // JWT signing key for admin sessions
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;

  // Environment variables
  NEAR_RPC_URL: string;
  LICENSE_DURATION_DAYS: string;
  CRYPTO_MONTHLY_USD: string;
  NEAR_INTENTS_API_URL: string;
  SETTLEMENT_ACCOUNT: string;
  ADMIN_WALLET: string; // Admin NEAR account ID (contract admin)
}

/**
 * Subscription record stored in KV
 */
export interface SubscriptionRecord {
  nearAccountId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  status: 'active' | 'canceled' | 'past_due' | 'unpaid' | 'incomplete';
  currentPeriodEnd: number; // Unix timestamp in seconds
  cancelAtPeriodEnd: boolean;
  createdAt: number;
  updatedAt: number;
}

/**
 * Request body for checkout endpoint
 */
export interface CheckoutRequest {
  nearAccountId: string;
  successUrl: string;
  cancelUrl: string;
}

/**
 * Response from checkout endpoint
 */
export interface CheckoutResponse {
  sessionId: string;
  url: string;
}

/**
 * Request body for subscription cancellation
 */
export interface CancelSubscriptionRequest {
  nearAccountId: string;
}

/**
 * Response from subscription status endpoint
 */
export interface SubscriptionStatusResponse {
  status: SubscriptionRecord['status'] | 'none';
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean;
  nearAccountId: string;
}

/**
 * NEAR RPC request types
 */
export interface NearRpcRequest {
  jsonrpc: '2.0';
  id: string;
  method: string;
  params: unknown;
}

export interface NearRpcResponse<T = unknown> {
  jsonrpc: '2.0';
  id: string;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

/**
 * NEAR transaction types for signing
 */
export interface NearAction {
  FunctionCall: {
    method_name: string;
    args: string; // base64 encoded
    gas: string; // in yoctoNEAR string
    deposit: string; // in yoctoNEAR string
  };
}

/**
 * Crypto subscription record stored in KV
 * Uses NEAR Intents for pre-authorized recurring payments
 */
export interface CryptoSubscription {
  nearAccountId: string;
  intentId: string; // NEAR Intents subscription intent ID
  monthlyAmountUsd: string;
  billingDay: number; // 1-28
  status: 'pending' | 'active' | 'past_due' | 'cancelled';
  retryCount: number; // Track retry attempts for past_due
  lastChargeDate: string | null;
  nextChargeDate: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Request body for crypto subscription endpoint
 */
export interface CryptoSubscribeRequest {
  nearAccountId: string;
  billingDay?: number; // Optional, defaults to current day (1-28)
}

/**
 * Response from crypto subscription creation
 */
export interface CryptoSubscribeResponse {
  intentId: string;
  authorizationUrl: string;
  monthlyAmount: string;
}

/**
 * Response from crypto subscription confirmation
 */
export interface CryptoConfirmResponse {
  success: boolean;
  license: {
    days: number;
    expiresAt: string;
  };
}

/**
 * Response from crypto subscription status endpoint
 */
export interface CryptoSubscriptionStatusResponse {
  status: CryptoSubscription['status'] | 'none';
  nextChargeDate: string | null;
  monthlyAmount: string;
  nearAccountId: string;
}

/**
 * Response from crypto subscription cancellation
 */
export interface CryptoSubscriptionCancelResponse {
  cancelledAt: string;
  activeUntil: string;
}

/**
 * Admin session from JWT verification
 */
export interface AdminSession {
  nearAccountId: string;
  issuedAt: number;
  expiresAt: number;
}

/**
 * Installation record stored in KV
 * Tracks unique extension installations for conversion analytics
 */
export interface InstallationRecord {
  installId: string; // Unique identifier (machine ID or generated UUID)
  firstSeen: string; // ISO timestamp of first activation
  lastSeen: string; // ISO timestamp of most recent activation
  extensionVersion: string;
  vscodeVersion: string;
  platform: string; // darwin, linux, win32
  nearAccountId?: string; // Set when user logs in with NEAR wallet
  upgradedAt?: string; // Set when user subscribes (free -> pro conversion)
  source?: string; // Optional: marketplace, direct, etc.
}

/**
 * Request body for telemetry endpoint
 */
export interface TelemetryRequest {
  event: 'install' | 'activate' | 'login' | 'upgrade';
  installId: string;
  extensionVersion: string;
  vscodeVersion: string;
  platform: string;
  nearAccountId?: string; // For login/upgrade events
  source?: string;
}

/**
 * Telemetry stats for admin dashboard
 */
export interface TelemetryStats {
  totalInstallations: number;
  activeInstallations: number; // Seen in last 30 days
  loggedInUsers: number; // Have nearAccountId
  conversions: number; // Have upgradedAt
  conversionRate: number; // conversions / totalInstallations * 100
}

// ============================================================================
// OAuth Authentication Types
// ============================================================================

/**
 * OAuth provider types
 */
export type OAuthProvider = 'google' | 'github' | 'email';

/**
 * OAuth user license stored in USER_LICENSES KV
 * Key: oauth:{provider}:{userId} (e.g., oauth:google:123456)
 */
export interface OAuthUserLicense {
  id: string; // Provider-specific user ID
  provider: OAuthProvider;
  email: string;
  displayName?: string;
  licenseExpiry: number | null; // Unix timestamp, null if no license
  stripeCustomerId?: string; // Set when they subscribe
  createdAt: number;
  updatedAt: number;
}

/**
 * Email user stored in USER_LICENSES KV (for email+password auth)
 * Key: email:{email}
 */
export interface EmailUser {
  email: string;
  passwordHash: string; // bcrypt hash
  createdAt: number;
}

/**
 * OAuth state stored temporarily in PROCESSED_EVENTS KV
 * Key: oauth_state:{state}
 */
export interface OAuthState {
  provider: 'google' | 'github';
  callback: string; // VSCode callback URL
  createdAt: number;
}

/**
 * Request body for email registration
 */
export interface EmailRegisterRequest {
  email: string;
  password: string;
  displayName?: string;
}

/**
 * Request body for email login
 */
export interface EmailLoginRequest {
  email: string;
  password: string;
}

/**
 * Response from email auth endpoints
 */
export interface EmailAuthResponse {
  token: string;
  expiresAt: number;
  userId: string; // oauth:email:{email}
}

/**
 * Rate limit record stored in PROCESSED_EVENTS KV
 * Key: ratelimit:{ip}
 */
export interface RateLimitRecord {
  failedAttempts: number;
  lockoutUntil: number | null; // Unix timestamp, null if not locked out
  lastAttempt: number;
}

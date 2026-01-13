/**
 * Cloudflare Worker environment bindings
 */
export interface Env {
  // KV Namespaces
  PROCESSED_EVENTS: KVNamespace;
  SUBSCRIPTIONS: KVNamespace;
  CRYPTO_SUBSCRIPTIONS: KVNamespace;

  // Secrets (set via wrangler secret put)
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  STRIPE_PRICE_ID: string;
  NEAR_PRIVATE_KEY: string;
  LICENSE_CONTRACT_ID: string;
  NEAR_NETWORK: string;
  FASTNEAR_API_KEY: string;
  NEAR_INTENTS_API_KEY: string;

  // Environment variables
  NEAR_RPC_URL: string;
  LICENSE_DURATION_DAYS: string;
  CRYPTO_MONTHLY_USD: string;
  NEAR_INTENTS_API_URL: string;
  SETTLEMENT_ACCOUNT: string;
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

/**
 * Cloudflare Worker environment bindings
 */
export interface Env {
  // KV Namespaces
  PROCESSED_EVENTS: KVNamespace;
  SUBSCRIPTIONS: KVNamespace;

  // Secrets (set via wrangler secret put)
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  STRIPE_PRICE_ID: string;
  NEAR_PRIVATE_KEY: string;
  LICENSE_CONTRACT_ID: string;
  NEAR_NETWORK: string;
  FASTNEAR_API_KEY: string;

  // Environment variables
  NEAR_RPC_URL: string;
  LICENSE_DURATION_DAYS: string;
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

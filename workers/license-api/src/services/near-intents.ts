/**
 * NEAR Intents 1Click API integration service
 *
 * Note: The 1Click SDK supports one-time swaps with ANY_INPUT mode for receiving
 * variable amounts over time. We use this to create persistent deposit addresses
 * for crypto subscriptions - users send monthly payments to their assigned address.
 *
 * The workflow:
 * 1. Create ANY_INPUT quote with persistent deposit address (long deadline)
 * 2. User sends monthly payment ($4 USDC equivalent in any supported token)
 * 3. Cron job checks for new withdrawals and extends license accordingly
 */

import { OneClickService, OpenAPI, QuoteRequest, QuoteResponse, GetExecutionStatusResponse } from '@defuse-protocol/one-click-sdk-typescript';
import type { Env } from '../types';

// USDC on NEAR for settlement
const USDC_NEAR_ASSET_ID = 'near:mainnet:usdc.tether-token.near';
// USDC on Base (common source for crypto payments)
const USDC_BASE_ASSET_ID = 'base:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

/**
 * Configure the 1Click API with the provided environment
 */
function configureApi(env: Env): void {
  OpenAPI.BASE = env.NEAR_INTENTS_API_URL;
  if (env.NEAR_INTENTS_API_KEY) {
    OpenAPI.TOKEN = env.NEAR_INTENTS_API_KEY;
  }
}

/**
 * Result of creating a subscription deposit address
 */
export interface SubscriptionIntentResult {
  intentId: string; // deposit address (used as unique ID)
  depositAddress: string;
  depositMemo?: string;
  authorizationUrl: string; // URL user visits to see deposit details
  monthlyAmountUsd: string;
  deadline: string;
}

/**
 * Create a subscription intent (deposit address) for recurring payments
 * Uses ANY_INPUT swap type to allow variable deposits over time
 */
export async function createSubscriptionIntent(
  env: Env,
  nearAccountId: string,
  monthlyAmountUsd: string
): Promise<SubscriptionIntentResult> {
  configureApi(env);

  // Convert USD to USDC amount (6 decimals)
  const usdcAmount = Math.floor(parseFloat(monthlyAmountUsd) * 1_000_000).toString();

  // Set a long deadline (1 year) for the subscription address to remain active
  const oneYearFromNow = new Date();
  oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);
  const deadline = oneYearFromNow.toISOString();

  // Create quote request for ANY_INPUT swap
  // ANY_INPUT allows receiving variable amounts over time
  const quoteRequest: QuoteRequest = {
    dry: false,
    swapType: QuoteRequest.swapType.ANY_INPUT,
    slippageTolerance: 100, // 1%
    originAsset: USDC_BASE_ASSET_ID, // Accept USDC from Base
    depositType: QuoteRequest.depositType.ORIGIN_CHAIN,
    destinationAsset: USDC_NEAR_ASSET_ID, // Settle as USDC on NEAR
    amount: usdcAmount,
    refundTo: nearAccountId, // Refund to user's NEAR account
    refundType: QuoteRequest.refundType.INTENTS,
    recipient: env.SETTLEMENT_ACCOUNT, // vitalpointai.near
    recipientType: QuoteRequest.recipientType.INTENTS,
    deadline,
    referral: 'specflow',
  };

  const quoteResponse: QuoteResponse = await OneClickService.getQuote(quoteRequest);

  if (!quoteResponse.quote.depositAddress) {
    throw new Error('Failed to get deposit address from 1Click API');
  }

  // The deposit address serves as the unique intent ID
  const intentId = quoteResponse.quote.depositAddress;

  // Create authorization URL (for user to see deposit details)
  // This would typically be a frontend URL showing the deposit address
  const authorizationUrl = `https://app.defuse.org/swap?deposit=${encodeURIComponent(intentId)}`;

  return {
    intentId,
    depositAddress: quoteResponse.quote.depositAddress,
    depositMemo: quoteResponse.quote.depositMemo,
    authorizationUrl,
    monthlyAmountUsd,
    deadline,
  };
}

/**
 * Result of checking subscription payment status
 */
export interface SubscriptionChargeResult {
  success: boolean;
  status: 'success' | 'pending' | 'insufficient' | 'failed';
  txHash?: string;
  amountReceivedUsd?: string;
  error?: string;
}

/**
 * Check if a subscription payment has been received
 * Monitors the ANY_INPUT deposit address for new withdrawals
 */
export async function checkSubscriptionPayment(
  env: Env,
  depositAddress: string,
  depositMemo?: string,
  sinceTimestamp?: string
): Promise<SubscriptionChargeResult> {
  configureApi(env);

  try {
    // Get execution status for the deposit address
    const status = await OneClickService.getExecutionStatus(depositAddress, depositMemo);

    // Check if any successful swaps have occurred
    if (status.status === GetExecutionStatusResponse.status.SUCCESS) {
      return {
        success: true,
        status: 'success',
        txHash: status.swapDetails.nearTxHashes?.[0],
        amountReceivedUsd: status.swapDetails.amountInUsd,
      };
    }

    if (status.status === GetExecutionStatusResponse.status.PROCESSING) {
      return {
        success: false,
        status: 'pending',
      };
    }

    // For ANY_INPUT, also check withdrawals
    try {
      const withdrawals = await OneClickService.getAnyInputQuoteWithdrawals(
        depositAddress,
        depositMemo,
        sinceTimestamp,
        1,
        50,
        'desc'
      );

      if (withdrawals.withdrawals) {
        const withdrawal = withdrawals.withdrawals;
        if (withdrawal.status === 'SUCCESS') {
          return {
            success: true,
            status: 'success',
            txHash: withdrawal.hash,
            amountReceivedUsd: withdrawal.amountOutUsd,
          };
        }
      }
    } catch {
      // Withdrawals endpoint may not be available for all quotes
    }

    return {
      success: false,
      status: status.status === GetExecutionStatusResponse.status.FAILED ? 'failed' : 'pending',
    };
  } catch (error) {
    return {
      success: false,
      status: 'failed',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get detailed status of a subscription intent
 */
export async function getSubscriptionStatus(
  env: Env,
  depositAddress: string,
  depositMemo?: string
): Promise<GetExecutionStatusResponse | null> {
  configureApi(env);

  try {
    return await OneClickService.getExecutionStatus(depositAddress, depositMemo);
  } catch {
    return null;
  }
}

/**
 * Note: True subscription cancellation is not supported by 1Click API
 * The deposit address simply expires after the deadline
 * "Cancellation" is handled by marking the subscription as cancelled in our KV store
 */
export function cancelSubscription(): { success: boolean } {
  // Deposit addresses expire naturally; we just mark as cancelled in KV
  return { success: true };
}

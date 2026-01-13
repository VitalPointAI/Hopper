/**
 * Cloudflare Workers Cron Trigger handler
 * Processes recurring crypto subscription charges daily
 */

import type { Env, CryptoSubscription } from '../types';
import { checkSubscriptionPayment } from '../services/near-intents';
import {
  listDueSubscriptions,
  updateCryptoSubscriptionStatus,
  calculateNextChargeDate,
} from '../services/crypto-subscription-store';
import { grantLicense } from '../services/near-contract';

// Maximum retry attempts before marking as cancelled
const MAX_RETRY_ATTEMPTS = 3;

/**
 * Result of processing a single subscription
 */
interface ProcessingResult {
  nearAccountId: string;
  success: boolean;
  action: 'charged' | 'pending' | 'past_due' | 'cancelled' | 'error';
  txHash?: string;
  error?: string;
}

/**
 * Summary of cron run
 */
interface CronSummary {
  runDate: string;
  totalProcessed: number;
  charged: number;
  pending: number;
  pastDue: number;
  cancelled: number;
  errors: number;
  results: ProcessingResult[];
}

/**
 * Process a single subscription charge
 */
async function processSubscription(
  env: Env,
  subscription: CryptoSubscription
): Promise<ProcessingResult> {
  const { nearAccountId, intentId, retryCount } = subscription;

  try {
    // Check if payment has been received since last charge
    const paymentResult = await checkSubscriptionPayment(
      env,
      intentId,
      undefined, // no memo
      subscription.lastChargeDate || subscription.createdAt
    );

    if (paymentResult.success) {
      // Payment received - grant license extension
      const durationDays = parseInt(env.LICENSE_DURATION_DAYS, 10);
      const licenseResult = await grantLicense(env, nearAccountId, durationDays);

      if (!licenseResult.success) {
        console.error(`Failed to grant license for ${nearAccountId}:`, licenseResult.error);
        return {
          nearAccountId,
          success: false,
          action: 'error',
          error: `License grant failed: ${licenseResult.error}`,
        };
      }

      // Update subscription - calculate next charge date
      const nextChargeDate = calculateNextChargeDate(subscription.billingDay);

      await updateCryptoSubscriptionStatus(
        env.CRYPTO_SUBSCRIPTIONS,
        nearAccountId,
        'active',
        {
          lastChargeDate: new Date().toISOString(),
          nextChargeDate,
          retryCount: 0,
        }
      );

      console.log(
        `Subscription charged for ${nearAccountId}, license extended ${durationDays} days, tx: ${licenseResult.txHash}`
      );

      return {
        nearAccountId,
        success: true,
        action: 'charged',
        txHash: licenseResult.txHash,
      };
    }

    // Payment not received
    if (paymentResult.status === 'pending') {
      // Still processing - don't update status yet
      return {
        nearAccountId,
        success: false,
        action: 'pending',
      };
    }

    // Payment failed or not received
    const newRetryCount = retryCount + 1;

    if (newRetryCount >= MAX_RETRY_ATTEMPTS) {
      // Max retries exceeded - cancel subscription
      await updateCryptoSubscriptionStatus(
        env.CRYPTO_SUBSCRIPTIONS,
        nearAccountId,
        'cancelled',
        {
          retryCount: newRetryCount,
        }
      );

      console.log(
        `Subscription cancelled for ${nearAccountId} after ${MAX_RETRY_ATTEMPTS} failed attempts`
      );

      return {
        nearAccountId,
        success: false,
        action: 'cancelled',
        error: `Cancelled after ${MAX_RETRY_ATTEMPTS} failed payment attempts`,
      };
    }

    // Mark as past_due and increment retry count
    await updateCryptoSubscriptionStatus(
      env.CRYPTO_SUBSCRIPTIONS,
      nearAccountId,
      'past_due',
      {
        retryCount: newRetryCount,
      }
    );

    console.log(
      `Subscription past_due for ${nearAccountId}, retry ${newRetryCount}/${MAX_RETRY_ATTEMPTS}`
    );

    return {
      nearAccountId,
      success: false,
      action: 'past_due',
      error: `Payment not received, retry ${newRetryCount}/${MAX_RETRY_ATTEMPTS}`,
    };
  } catch (error) {
    console.error(`Error processing subscription for ${nearAccountId}:`, error);
    return {
      nearAccountId,
      success: false,
      action: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Handle Cloudflare Cron Trigger scheduled event
 * Runs daily at 6 AM UTC to process due crypto subscriptions
 */
export async function handleScheduled(
  _event: ScheduledEvent,
  env: Env,
  _ctx: ExecutionContext
): Promise<CronSummary> {
  const today = new Date();
  const runDate = today.toISOString();

  console.log(`Cron job started: ${runDate}`);

  // Get all subscriptions due today or earlier
  const dueSubscriptions = await listDueSubscriptions(env.CRYPTO_SUBSCRIPTIONS, today);

  console.log(`Found ${dueSubscriptions.length} subscriptions to process`);

  // Process each subscription
  const results: ProcessingResult[] = [];

  for (const subscription of dueSubscriptions) {
    const result = await processSubscription(env, subscription);
    results.push(result);
  }

  // Compile summary
  const summary: CronSummary = {
    runDate,
    totalProcessed: results.length,
    charged: results.filter((r) => r.action === 'charged').length,
    pending: results.filter((r) => r.action === 'pending').length,
    pastDue: results.filter((r) => r.action === 'past_due').length,
    cancelled: results.filter((r) => r.action === 'cancelled').length,
    errors: results.filter((r) => r.action === 'error').length,
    results,
  };

  console.log(
    `Cron job completed: charged=${summary.charged}, pending=${summary.pending}, past_due=${summary.pastDue}, cancelled=${summary.cancelled}, errors=${summary.errors}`
  );

  return summary;
}

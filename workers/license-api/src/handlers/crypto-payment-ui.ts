/**
 * Crypto Payment Page UI
 * Serves HTML page with near-connect wallet selector for cross-chain payments
 */

import type { Context } from 'hono';
import type { Env } from '../types';
import { getCryptoSubscriptionByIntentId } from '../services/crypto-subscription-store';

/**
 * Crypto payment page HTML
 * Uses @hot-labs/near-connect for multi-wallet cross-chain payments
 */
function paymentPage(subscription: {
  nearAccountId: string;
  intentId: string;
  monthlyAmountUsd: string;
  depositAddress: string;
  status: string;
  network: string;
}): string {
  const isPending = subscription.status === 'pending';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Complete Payment - SpecFlow</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    .pulse-ring {
      animation: pulse-ring 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite;
    }
    @keyframes pulse-ring {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
  </style>
</head>
<body class="bg-gradient-to-br from-indigo-50 to-purple-50 min-h-screen">
  <div class="min-h-screen flex flex-col items-center justify-center p-4">
    <!-- Header -->
    <div class="text-center mb-8">
      <h1 class="text-3xl font-bold text-gray-900 mb-2">SpecFlow Subscription</h1>
      <p class="text-gray-600">Complete your payment to activate your license</p>
    </div>

    <!-- Payment Card -->
    <div class="max-w-lg w-full bg-white rounded-2xl shadow-xl overflow-hidden">
      <!-- Amount Section -->
      <div class="bg-indigo-600 text-white p-6 text-center">
        <p class="text-indigo-200 text-sm mb-1">Monthly Subscription</p>
        <p class="text-4xl font-bold">$${subscription.monthlyAmountUsd}</p>
        <p class="text-indigo-200 text-sm mt-2">Pay with any token from any chain</p>
      </div>

      <!-- Main Content -->
      <div class="p-6 space-y-6">
        <!-- Account Info -->
        <div class="bg-gray-50 rounded-lg p-4">
          <p class="text-xs text-gray-500 uppercase tracking-wider mb-1">NEAR Account</p>
          <p class="font-mono text-sm text-gray-900 break-all">${subscription.nearAccountId}</p>
        </div>

        ${isPending ? `
        <!-- Payment Options -->
        <div id="payment-container">
          <!-- Initial State: Connect Wallet -->
          <div id="step-connect" class="space-y-4">
            <div class="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div class="flex items-start gap-3">
                <svg class="w-5 h-5 text-blue-600 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                </svg>
                <div>
                  <h3 class="text-sm font-medium text-blue-800">Multi-Chain Payment</h3>
                  <p class="mt-1 text-sm text-blue-700">
                    Connect any wallet to pay with tokens from Ethereum, Base, Arbitrum, Polygon, NEAR, and more.
                  </p>
                </div>
              </div>
            </div>

            <button
              id="connect-wallet-btn"
              class="w-full flex justify-center items-center gap-3 py-4 px-6 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl transition-all transform hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
            >
              <svg class="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                <path d="M21 18v1c0 1.1-.9 2-2 2H5c-1.11 0-2-.9-2-2V5c0-1.1.89-2 2-2h14c1.1 0 2 .9 2 2v1h-9c-1.11 0-2 .9-2 2v8c0 1.1.89 2 2 2h9zm-9-2h10V8H12v8zm4-2.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/>
              </svg>
              Connect Wallet to Pay
            </button>

            <p class="text-xs text-center text-gray-500">
              Supports HOT, Meteor, MyNearWallet, Intear, and 50+ wallets via WalletConnect
            </p>
          </div>

          <!-- Processing State -->
          <div id="step-processing" class="hidden space-y-4">
            <div class="flex flex-col items-center py-8">
              <div class="relative">
                <div class="w-16 h-16 border-4 border-indigo-200 rounded-full"></div>
                <div class="absolute top-0 left-0 w-16 h-16 border-4 border-indigo-600 rounded-full border-t-transparent animate-spin"></div>
              </div>
              <p class="mt-4 text-gray-600" id="processing-message">Connecting wallet...</p>
            </div>
          </div>

          <!-- Error Display -->
          <div id="error-display" class="hidden">
            <div class="bg-red-50 border border-red-200 rounded-lg p-4">
              <div class="flex items-start gap-3">
                <svg class="w-5 h-5 text-red-600 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                </svg>
                <div class="flex-1">
                  <h3 class="text-sm font-medium text-red-800">Payment Failed</h3>
                  <p class="mt-1 text-sm text-red-700" id="error-message"></p>
                </div>
              </div>
            </div>
            <button id="retry-btn" class="mt-4 w-full py-3 px-4 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-lg transition-colors">
              Try Again
            </button>
          </div>
        </div>

        <!-- Alternative: Manual Deposit -->
        <div class="border-t pt-6">
          <details class="group">
            <summary class="flex items-center justify-between cursor-pointer text-sm text-gray-600 hover:text-gray-900">
              <span>Or send payment manually</span>
              <svg class="w-4 h-4 transform group-open:rotate-180 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
              </svg>
            </summary>
            <div class="mt-4 space-y-3">
              <p class="text-xs text-gray-500">Send $${subscription.monthlyAmountUsd} USDC to this deposit address:</p>
              <div class="bg-gray-100 rounded-lg p-3 break-all">
                <code class="text-xs text-gray-800">${subscription.depositAddress}</code>
              </div>
              <button
                onclick="navigator.clipboard.writeText('${subscription.depositAddress}')"
                class="w-full py-2 px-3 text-sm text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 rounded-lg transition-colors"
              >
                Copy Address
              </button>
            </div>
          </details>
        </div>
        ` : `
        <!-- Already Paid/Active -->
        <div class="text-center py-8">
          <div class="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg class="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
            </svg>
          </div>
          <h3 class="text-lg font-semibold text-gray-900 mb-2">Subscription Active</h3>
          <p class="text-gray-600">Your payment has been confirmed and your license is active.</p>
          <a href="/" class="mt-6 inline-block py-2 px-6 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors">
            Go to Dashboard
          </a>
        </div>
        `}
      </div>
    </div>

    <!-- Footer -->
    <div class="mt-8 text-center text-sm text-gray-500">
      <p>Powered by <a href="https://defuse.org" target="_blank" class="text-indigo-600 hover:underline">NEAR Intents</a></p>
      <p class="mt-1">Secure cross-chain payments</p>
    </div>
  </div>

  ${isPending ? `
  <script type="module">
    import { NearConnector } from 'https://esm.sh/@hot-labs/near-connect';

    const intentId = '${subscription.intentId}';
    const depositAddress = '${subscription.depositAddress}';
    const amountUsd = '${subscription.monthlyAmountUsd}';
    const nearAccountId = '${subscription.nearAccountId}';

    let connector = null;
    let connectedAccountId = null;

    // Initialize the connector
    async function initConnector() {
      connector = new NearConnector({
        network: '${subscription.network}',
        features: { signAndSendTransaction: true }
      });

      connector.on('wallet:signIn', async (event) => {
        if (event.accounts && event.accounts.length > 0) {
          connectedAccountId = event.accounts[0].accountId;
          console.log('Wallet connected:', connectedAccountId);
        }
      });

      connector.on('wallet:signOut', async () => {
        connectedAccountId = null;
        console.log('Wallet disconnected');
      });

      return connector;
    }

    // Main payment flow
    async function handlePayment() {
      showStep('processing');
      setProcessingMessage('Initializing wallet connector...');

      try {
        if (!connector) {
          await initConnector();
        }

        setProcessingMessage('Opening wallet selector...');

        // Connect to wallet - this opens the wallet selector modal
        // and returns the connected wallet instance
        const wallet = await connector.connect();

        // Get the connected account
        const { accounts } = await connector.getConnectedWallet();
        if (!accounts || accounts.length === 0) {
          throw new Error('No accounts found after connecting wallet.');
        }
        connectedAccountId = accounts[0].accountId;

        setProcessingMessage('Preparing payment transaction...');

        // Create transfer transaction to deposit address
        // This will trigger the wallet to send USDC or equivalent
        const amountInUsdc = parseFloat(amountUsd) * 1_000_000; // 6 decimals

        setProcessingMessage('Please confirm the payment in your wallet...');

        // For cross-chain payments via Intents, we use signAndSendTransaction
        // The transaction sends to the deposit address which NEAR Intents monitors
        const result = await wallet.signAndSendTransaction({
          receiverId: 'usdc.near', // USDC contract on NEAR
          actions: [
            {
              type: 'FunctionCall',
              params: {
                methodName: 'ft_transfer',
                args: {
                  receiver_id: depositAddress,
                  amount: amountInUsdc.toString(),
                  memo: 'SpecFlow subscription payment'
                },
                gas: '30000000000000',
                deposit: '1' // 1 yoctoNEAR for transfer
              }
            }
          ]
        });

        if (!result || !result.transaction) {
          throw new Error('Transaction was cancelled or failed');
        }

        setProcessingMessage('Confirming payment...');

        // Confirm with backend
        const confirmResponse = await fetch('/api/crypto/subscribe/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ intentId })
        });

        const confirmData = await confirmResponse.json();

        if (confirmResponse.ok && confirmData.success) {
          // Payment confirmed - reload page to show success state
          window.location.reload();
        } else {
          // Payment sent but not yet confirmed - show pending message
          setProcessingMessage('Payment sent! Waiting for confirmation...');
          // Poll for confirmation
          pollForConfirmation();
        }

      } catch (err) {
        console.error('Payment error:', err);
        showError(err.message || 'Failed to process payment');
      }
    }

    // Poll for payment confirmation
    async function pollForConfirmation() {
      let attempts = 0;
      const maxAttempts = 30; // 30 seconds

      while (attempts < maxAttempts) {
        await new Promise(r => setTimeout(r, 1000));

        try {
          const response = await fetch('/api/crypto/subscribe/confirm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ intentId })
          });

          const data = await response.json();

          if (response.ok && data.success) {
            window.location.reload();
            return;
          }
        } catch {
          // Continue polling
        }

        attempts++;
        setProcessingMessage('Payment sent! Confirming... (' + (maxAttempts - attempts) + 's)');
      }

      // Timeout - show manual confirmation option
      showError('Payment may have been sent. Please check back in a few minutes or contact support.');
    }

    // UI helpers
    function showStep(step) {
      document.getElementById('step-connect')?.classList.add('hidden');
      document.getElementById('step-processing')?.classList.add('hidden');
      document.getElementById('error-display')?.classList.add('hidden');

      switch(step) {
        case 'connect':
          document.getElementById('step-connect')?.classList.remove('hidden');
          break;
        case 'processing':
          document.getElementById('step-processing')?.classList.remove('hidden');
          break;
      }
    }

    function setProcessingMessage(msg) {
      const el = document.getElementById('processing-message');
      if (el) el.textContent = msg;
    }

    function showError(message) {
      const errorMsg = document.getElementById('error-message');
      if (errorMsg) errorMsg.textContent = message;
      document.getElementById('step-connect')?.classList.add('hidden');
      document.getElementById('step-processing')?.classList.add('hidden');
      document.getElementById('error-display')?.classList.remove('hidden');
    }

    // Event handlers
    document.getElementById('connect-wallet-btn')?.addEventListener('click', handlePayment);
    document.getElementById('retry-btn')?.addEventListener('click', () => showStep('connect'));
  </script>
  ` : ''}
</body>
</html>`;
}

/**
 * Not found page for invalid intent IDs
 */
function notFoundPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Payment Not Found - SpecFlow</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-100 min-h-screen flex items-center justify-center">
  <div class="text-center p-8">
    <div class="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
      <svg class="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
      </svg>
    </div>
    <h1 class="text-2xl font-bold text-gray-900 mb-2">Payment Not Found</h1>
    <p class="text-gray-600 mb-6">This payment link is invalid or has expired.</p>
    <a href="/" class="inline-block py-2 px-6 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors">
      Go Home
    </a>
  </div>
</body>
</html>`;
}

/**
 * GET /pay/:intentId
 * Render the crypto payment page for a specific subscription intent
 */
export async function handleCryptoPaymentPage(
  c: Context<{ Bindings: Env }>
): Promise<Response> {
  const intentId = c.req.param('intentId');

  if (!intentId) {
    return c.html(notFoundPage(), 404);
  }

  // Look up subscription by intent ID
  const subscription = await getCryptoSubscriptionByIntentId(
    c.env.CRYPTO_SUBSCRIPTIONS,
    intentId
  );

  if (!subscription) {
    return c.html(notFoundPage(), 404);
  }

  // Render payment page
  return c.html(paymentPage({
    nearAccountId: subscription.nearAccountId,
    intentId: subscription.intentId,
    monthlyAmountUsd: subscription.monthlyAmountUsd,
    depositAddress: subscription.intentId, // deposit address is the intent ID
    status: subscription.status,
    network: c.env.NEAR_NETWORK,
  }));
}

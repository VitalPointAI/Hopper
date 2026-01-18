/**
 * Crypto Payment Page UI
 * Serves HTML page with token selection and cross-chain payment via NEAR Intents
 */

import type { Context } from 'hono';
import type { Env } from '../types';
import { getCryptoSubscriptionByIntentId } from '../services/crypto-subscription-store';

/**
 * Crypto payment page HTML
 * Multi-step payment flow: Connect Wallet → Select Token → Confirm Payment
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
  const hasWallet = !!subscription.nearAccountId && subscription.nearAccountId.length > 0;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Complete Payment - Hopper</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    .token-option { transition: all 0.15s ease; }
    .token-option:hover { transform: translateY(-2px); }
    .token-option.selected { border-color: #4F46E5; background-color: #EEF2FF; }
    .fade-in { animation: fadeIn 0.2s ease; }
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  </style>
</head>
<body class="bg-gradient-to-br from-indigo-50 to-purple-50 min-h-screen">
  <div class="min-h-screen flex flex-col items-center justify-center p-4">
    <!-- Header -->
    <div class="text-center mb-8">
      <h1 class="text-3xl font-bold text-gray-900 mb-2">Hopper Subscription</h1>
      <p class="text-gray-600">Complete your payment to activate your license</p>
    </div>

    <!-- Payment Card -->
    <div class="max-w-lg w-full bg-white rounded-2xl shadow-xl overflow-hidden">
      <!-- Amount Section -->
      <div class="bg-indigo-600 text-white p-6 text-center">
        <p class="text-indigo-200 text-sm mb-1">Monthly Subscription</p>
        <p class="text-4xl font-bold">$${subscription.monthlyAmountUsd} <span class="text-2xl font-normal">USDC</span></p>
        <p class="text-indigo-200 text-sm mt-2">Pay with any token from any chain</p>
      </div>

      <!-- Main Content -->
      <div class="p-6">
        ${isPending ? `
        <!-- Payment Flow Container -->
        <div id="payment-flow">

          <!-- Step 1: Select Chain -->
          <div id="step-connect" class="space-y-4">
            ${hasWallet ? `
            <div class="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-2">
              <div class="flex items-center gap-2">
                <svg class="w-4 h-4 text-blue-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                </svg>
                <p class="text-xs text-blue-700">
                  NEAR wallet linked: <span class="font-mono">${subscription.nearAccountId.length > 20 ? subscription.nearAccountId.slice(0, 10) + '...' + subscription.nearAccountId.slice(-8) : subscription.nearAccountId}</span>
                </p>
              </div>
            </div>
            ` : ''}
            <h3 class="font-semibold text-gray-900 mb-3">Select Payment Network</h3>

            <div id="chain-options" class="grid grid-cols-2 gap-2">
              <button data-chain="near" class="chain-option flex items-center gap-2 p-3 border-2 ${hasWallet ? 'border-indigo-400 bg-indigo-50' : 'border-gray-200'} rounded-lg hover:border-indigo-300 transition-colors">
                <div class="w-8 h-8 bg-black rounded-full flex items-center justify-center text-white text-xs font-bold">N</div>
                <div class="text-left">
                  <p class="text-sm font-medium text-gray-900">NEAR${hasWallet ? ' ✓' : ''}</p>
                  <p class="text-xs text-gray-500">NEAR, USDC, USDT</p>
                </div>
              </button>

              <button data-chain="eth" class="chain-option flex items-center gap-2 p-3 border-2 border-gray-200 rounded-lg hover:border-indigo-300 transition-colors">
                <div class="w-8 h-8 bg-[#627EEA] rounded-full flex items-center justify-center text-white text-xs font-bold">Ξ</div>
                <div class="text-left">
                  <p class="text-sm font-medium text-gray-900">Ethereum</p>
                  <p class="text-xs text-gray-500">ETH, USDC, DAI</p>
                </div>
              </button>

              <button data-chain="base" class="chain-option flex items-center gap-2 p-3 border-2 border-gray-200 rounded-lg hover:border-indigo-300 transition-colors">
                <div class="w-8 h-8 bg-[#0052FF] rounded-full flex items-center justify-center text-white text-xs font-bold">B</div>
                <div class="text-left">
                  <p class="text-sm font-medium text-gray-900">Base</p>
                  <p class="text-xs text-gray-500">ETH, USDC</p>
                </div>
              </button>

              <button data-chain="arb" class="chain-option flex items-center gap-2 p-3 border-2 border-gray-200 rounded-lg hover:border-indigo-300 transition-colors">
                <div class="w-8 h-8 bg-[#28A0F0] rounded-full flex items-center justify-center text-white text-xs font-bold">A</div>
                <div class="text-left">
                  <p class="text-sm font-medium text-gray-900">Arbitrum</p>
                  <p class="text-xs text-gray-500">ETH, USDC, ARB</p>
                </div>
              </button>

              <button data-chain="pol" class="chain-option flex items-center gap-2 p-3 border-2 border-gray-200 rounded-lg hover:border-indigo-300 transition-colors">
                <div class="w-8 h-8 bg-[#8247E5] rounded-full flex items-center justify-center text-white text-xs font-bold">P</div>
                <div class="text-left">
                  <p class="text-sm font-medium text-gray-900">Polygon</p>
                  <p class="text-xs text-gray-500">MATIC, USDC</p>
                </div>
              </button>

              <button data-chain="sol" class="chain-option flex items-center gap-2 p-3 border-2 border-gray-200 rounded-lg hover:border-indigo-300 transition-colors">
                <div class="w-8 h-8 bg-gradient-to-r from-[#9945FF] to-[#14F195] rounded-full flex items-center justify-center text-white text-xs font-bold">S</div>
                <div class="text-left">
                  <p class="text-sm font-medium text-gray-900">Solana</p>
                  <p class="text-xs text-gray-500">SOL, USDC</p>
                </div>
              </button>

              <button data-chain="ton" class="chain-option flex items-center gap-2 p-3 border-2 border-gray-200 rounded-lg hover:border-indigo-300 transition-colors">
                <div class="w-8 h-8 bg-[#0088CC] rounded-full flex items-center justify-center text-white text-xs font-bold">T</div>
                <div class="text-left">
                  <p class="text-sm font-medium text-gray-900">TON</p>
                  <p class="text-xs text-gray-500">TON, USDT</p>
                </div>
              </button>

              <button data-chain="stellar" class="chain-option flex items-center gap-2 p-3 border-2 border-gray-200 rounded-lg hover:border-indigo-300 transition-colors">
                <div class="w-8 h-8 bg-black rounded-full flex items-center justify-center text-white text-xs font-bold">✦</div>
                <div class="text-left">
                  <p class="text-sm font-medium text-gray-900">Stellar</p>
                  <p class="text-xs text-gray-500">XLM, USDC</p>
                </div>
              </button>

              <button data-chain="tron" class="chain-option flex items-center gap-2 p-3 border-2 border-gray-200 rounded-lg hover:border-indigo-300 transition-colors">
                <div class="w-8 h-8 bg-[#FF0013] rounded-full flex items-center justify-center text-white text-xs font-bold">T</div>
                <div class="text-left">
                  <p class="text-sm font-medium text-gray-900">TRON</p>
                  <p class="text-xs text-gray-500">TRX, USDT</p>
                </div>
              </button>
            </div>

            <p class="text-xs text-center text-gray-500 mt-2">
              Select a network to connect your wallet
            </p>
          </div>

          <!-- Step 2: Select Token -->
          <div id="step-tokens" class="hidden space-y-4 fade-in">
            <div class="flex items-center justify-between mb-2">
              <h3 class="font-semibold text-gray-900">Select Payment Token</h3>
              <button id="back-to-connect" class="text-sm text-indigo-600 hover:text-indigo-700">
                ← Back
              </button>
            </div>

            <div id="tokens-loading" class="py-8 text-center">
              <div class="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto"></div>
              <p class="mt-2 text-sm text-gray-600">Loading available tokens...</p>
            </div>

            <div id="tokens-list" class="hidden space-y-2 max-h-64 overflow-y-auto">
              <!-- Tokens will be populated here -->
            </div>

            <button
              id="continue-to-confirm"
              disabled
              class="w-full py-4 px-6 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-all"
            >
              Continue
            </button>
          </div>

          <!-- Step 3: Confirm Payment -->
          <div id="step-confirm" class="hidden space-y-4 fade-in">
            <div class="flex items-center justify-between mb-2">
              <h3 class="font-semibold text-gray-900">Confirm Payment</h3>
              <button id="back-to-tokens" class="text-sm text-indigo-600 hover:text-indigo-700">
                ← Change Token
              </button>
            </div>

            <div class="bg-gray-50 rounded-xl p-4 space-y-3">
              <div class="flex justify-between items-center">
                <span class="text-sm text-gray-600">You Pay</span>
                <span id="confirm-amount" class="font-semibold text-gray-900">--</span>
              </div>
              <div class="border-t border-gray-200"></div>
              <div class="flex justify-between items-center">
                <span class="text-sm text-gray-600">You Receive</span>
                <span class="font-semibold text-gray-900">1 Month Hopper Pro</span>
              </div>
              <div class="flex justify-between items-center">
                <span class="text-sm text-gray-600">Value</span>
                <span id="confirm-value" class="text-sm text-gray-700">≈ $${subscription.monthlyAmountUsd} USDC</span>
              </div>
            </div>

            <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
              <p class="text-xs text-yellow-800">
                <strong>Note:</strong> Final amount may vary slightly due to price fluctuations.
                A small buffer is included to ensure successful payment.
              </p>
            </div>

            <button
              id="confirm-payment-btn"
              class="w-full py-4 px-6 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-xl transition-all transform hover:scale-[1.02]"
            >
              Confirm & Pay
            </button>
          </div>

          <!-- Processing State -->
          <div id="step-processing" class="hidden py-8 fade-in">
            <div class="flex flex-col items-center">
              <div class="relative">
                <div class="w-16 h-16 border-4 border-indigo-200 rounded-full"></div>
                <div class="absolute top-0 left-0 w-16 h-16 border-4 border-indigo-600 rounded-full border-t-transparent animate-spin"></div>
              </div>
              <p class="mt-4 text-gray-600" id="processing-message">Processing...</p>
            </div>
          </div>

          <!-- Success State -->
          <div id="step-success" class="hidden py-8 text-center fade-in">
            <div class="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg class="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
              </svg>
            </div>
            <h3 class="text-lg font-semibold text-gray-900 mb-2">Payment Successful!</h3>
            <p class="text-gray-600 mb-4">Your Hopper Pro license is now active.</p>
            <p class="text-sm text-gray-500">Redirecting back to VSCode...</p>
          </div>

          <!-- Error State -->
          <div id="step-error" class="hidden fade-in">
            <div class="bg-red-50 border border-red-200 rounded-lg p-4">
              <div class="flex items-start gap-3">
                <svg class="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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

        <!-- Manual Deposit Option -->
        <div class="border-t mt-6 pt-6">
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
                onclick="navigator.clipboard.writeText('${subscription.depositAddress}'); this.textContent = 'Copied!'; setTimeout(() => this.textContent = 'Copy Address', 2000);"
                class="w-full py-2 px-3 text-sm text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 rounded-lg transition-colors"
              >
                Copy Address
              </button>
            </div>
          </details>
        </div>
        ` : `
        <!-- Already Active -->
        <div class="text-center py-8">
          <div class="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg class="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
            </svg>
          </div>
          <h3 class="text-lg font-semibold text-gray-900 mb-2">Subscription Active</h3>
          <p class="text-gray-600">Your payment has been confirmed and your license is active.</p>
        </div>
        `}
      </div>
    </div>

    <!-- Footer -->
    <div class="mt-8 text-center text-sm text-gray-500">
      <p>Powered by <a href="https://near-intents.org" target="_blank" class="text-indigo-600 hover:underline">NEAR Intents</a></p>
      <p class="mt-1">Secure cross-chain payments</p>
    </div>
  </div>

  ${isPending ? `
  <script type="module">
    import { NearConnector } from 'https://esm.sh/@hot-labs/near-connect';

    // Solana wallet adapter (Phantom, Solflare, etc.)
    // Uses the Solana wallet standard - most wallets inject window.solana or window.phantom.solana

    // TON Connect - uses the TON Connect protocol
    // Most TON wallets (Tonkeeper, OpenMask, etc.) support this

    // Stellar - uses Freighter or other SEP-0007 compatible wallets

    // TRON - uses TronLink or other TRON wallets that inject window.tronWeb

    // Payment config
    const config = {
      intentId: '${subscription.intentId}',
      depositAddress: '${subscription.depositAddress}',
      amountUsd: '${subscription.monthlyAmountUsd}',
      nearAccountId: '${subscription.nearAccountId}',
      hasWallet: ${hasWallet},
      network: '${subscription.network}'
    };

    // Chain configurations for EVM networks
    const CHAIN_CONFIG = {
      eth: { chainId: '0x1', name: 'Ethereum', rpcUrl: 'https://eth.llamarpc.com' },
      base: { chainId: '0x2105', name: 'Base', rpcUrl: 'https://mainnet.base.org' },
      arb: { chainId: '0xa4b1', name: 'Arbitrum', rpcUrl: 'https://arb1.arbitrum.io/rpc' },
      pol: { chainId: '0x89', name: 'Polygon', rpcUrl: 'https://polygon-rpc.com' },
      bsc: { chainId: '0x38', name: 'BSC', rpcUrl: 'https://bsc-dataseed.binance.org' },
    };

    // State
    let nearConnector = null;
    let connectedWallet = config.hasWallet ? { address: config.nearAccountId, chain: 'near' } : null;
    let selectedChain = config.hasWallet ? 'near' : null;
    let availableTokens = [];
    let selectedToken = null;
    let evmProvider = null;
    let solanaProvider = null;
    let tonConnector = null;
    let stellarProvider = null;
    let tronProvider = null;

    // Initialize NEAR wallet connector
    async function initNearConnector() {
      if (nearConnector) return nearConnector;

      nearConnector = new NearConnector({
        network: config.network,
        features: { signAndSendTransaction: true }
      });

      nearConnector.on('wallet:signIn', (event) => {
        if (event.accounts?.length > 0) {
          connectedWallet = { address: event.accounts[0].accountId, chain: 'near' };
          console.log('NEAR wallet connected:', connectedWallet.address);
        }
      });

      nearConnector.on('wallet:signOut', () => {
        connectedWallet = null;
        console.log('Wallet disconnected');
      });

      return nearConnector;
    }

    // Connect EVM wallet (MetaMask, etc.)
    async function connectEvmWallet(chain) {
      if (!window.ethereum) {
        throw new Error('No Ethereum wallet detected. Please install MetaMask or another Web3 wallet.');
      }

      evmProvider = window.ethereum;

      // Request account access
      const accounts = await evmProvider.request({ method: 'eth_requestAccounts' });
      if (!accounts?.length) {
        throw new Error('No accounts found. Please unlock your wallet.');
      }

      // Switch to the correct network
      const chainConfig = CHAIN_CONFIG[chain];
      if (chainConfig) {
        try {
          await evmProvider.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: chainConfig.chainId }],
          });
        } catch (switchError) {
          // Chain not added, try to add it
          if (switchError.code === 4902) {
            await evmProvider.request({
              method: 'wallet_addEthereumChain',
              params: [{
                chainId: chainConfig.chainId,
                chainName: chainConfig.name,
                rpcUrls: [chainConfig.rpcUrl],
              }],
            });
          } else {
            console.warn('Could not switch chain:', switchError);
          }
        }
      }

      connectedWallet = { address: accounts[0], chain };
      selectedChain = chain;

      return accounts[0];
    }

    // Connect Solana wallet (Phantom, Solflare, etc.)
    async function connectSolanaWallet() {
      // Check for Phantom or other Solana wallets
      const provider = window.phantom?.solana || window.solana || window.solflare;

      if (!provider) {
        throw new Error('No Solana wallet detected. Please install Phantom or another Solana wallet.');
      }

      if (!provider.isPhantom && !provider.isSolflare) {
        console.warn('Unknown Solana wallet, attempting connection...');
      }

      try {
        const response = await provider.connect();
        const publicKey = response.publicKey.toString();

        solanaProvider = provider;
        connectedWallet = { address: publicKey, chain: 'sol' };
        selectedChain = 'sol';

        console.log('Solana wallet connected:', publicKey);
        return publicKey;
      } catch (err) {
        if (err.code === 4001) {
          throw new Error('Connection rejected. Please approve the connection in your wallet.');
        }
        throw err;
      }
    }

    // Connect TON wallet (Tonkeeper, OpenMask, etc.)
    async function connectTonWallet() {
      // TON wallets typically inject tonkeeper or use TON Connect
      // For simplicity, we'll check for common TON wallet extensions
      const provider = window.ton || window.tonkeeper;

      if (!provider) {
        // Try to use TON Connect protocol via a popup
        // For now, show an error with instructions
        throw new Error('No TON wallet detected. Please install Tonkeeper or OpenMask browser extension.');
      }

      try {
        // Request wallet connection
        const accounts = await provider.send('ton_requestAccounts');

        if (!accounts || accounts.length === 0) {
          throw new Error('No TON accounts found. Please unlock your wallet.');
        }

        const address = accounts[0];
        tonConnector = provider;
        connectedWallet = { address, chain: 'ton' };
        selectedChain = 'ton';

        console.log('TON wallet connected:', address);
        return address;
      } catch (err) {
        if (err.code === 4001) {
          throw new Error('Connection rejected. Please approve the connection in your wallet.');
        }
        throw err;
      }
    }

    // Connect Stellar wallet (Freighter)
    async function connectStellarWallet() {
      // Freighter is the most common Stellar wallet extension
      if (!window.freighterApi) {
        throw new Error('No Stellar wallet detected. Please install Freighter browser extension.');
      }

      try {
        // Check if user has Freighter installed and is signed in
        const isConnected = await window.freighterApi.isConnected();
        if (!isConnected) {
          throw new Error('Freighter is not connected. Please open the extension and sign in.');
        }

        // Request public key
        const publicKey = await window.freighterApi.getPublicKey();

        if (!publicKey) {
          throw new Error('Could not get Stellar public key. Please unlock Freighter.');
        }

        stellarProvider = window.freighterApi;
        connectedWallet = { address: publicKey, chain: 'stellar' };
        selectedChain = 'stellar';

        console.log('Stellar wallet connected:', publicKey);
        return publicKey;
      } catch (err) {
        throw new Error(err.message || 'Failed to connect Stellar wallet');
      }
    }

    // Connect TRON wallet (TronLink)
    async function connectTronWallet() {
      // TronLink injects tronWeb and tronLink
      if (!window.tronWeb || !window.tronLink) {
        throw new Error('No TRON wallet detected. Please install TronLink browser extension.');
      }

      try {
        // TronLink ready state
        if (!window.tronWeb.ready) {
          // Request connection
          const res = await window.tronLink.request({ method: 'tron_requestAccounts' });

          if (res.code !== 200) {
            throw new Error('Connection rejected. Please approve the connection in TronLink.');
          }
        }

        // Get the default address
        const address = window.tronWeb.defaultAddress.base58;

        if (!address) {
          throw new Error('Could not get TRON address. Please unlock TronLink.');
        }

        tronProvider = window.tronWeb;
        connectedWallet = { address, chain: 'tron' };
        selectedChain = 'tron';

        console.log('TRON wallet connected:', address);
        return address;
      } catch (err) {
        throw new Error(err.message || 'Failed to connect TRON wallet');
      }
    }

    // Fetch user's wallet tokens with balances
    async function fetchWalletTokens() {
      try {
        if (!connectedWallet) {
          console.error('No wallet connected');
          return [];
        }

        const params = new URLSearchParams({
          address: connectedWallet.address,
          chain: connectedWallet.chain,
          amountUsd: config.amountUsd
        });

        const response = await fetch('/api/crypto/wallet-tokens?' + params.toString());
        const data = await response.json();
        return data.tokens || [];
      } catch (err) {
        console.error('Failed to fetch wallet tokens:', err);
        return [];
      }
    }

    // Create payment quote with deposit address
    async function createPaymentQuote(token) {
      if (!connectedWallet) {
        throw new Error('No wallet connected');
      }

      const response = await fetch('/api/crypto/payment-quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          originAsset: token.assetId,
          amountUsd: config.amountUsd,
          refundAddress: connectedWallet.address,
          chain: connectedWallet.chain,
          intentId: config.intentId, // CRITICAL: Pass intentId so deposit address is stored
        })
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to create payment quote');
      }
      return response.json();
    }

    // Render token list with balances and required amounts
    function renderTokens(tokens) {
      const list = document.getElementById('tokens-list');
      list.innerHTML = '';

      if (tokens.length === 0) {
        list.innerHTML = \`
          <div class="text-center py-6">
            <p class="text-gray-500 mb-2">No supported tokens found in your wallet</p>
            <p class="text-sm text-gray-400">You need NEAR or supported tokens to pay</p>
          </div>
        \`;
        return;
      }

      // Split into sufficient and insufficient balance
      const sufficient = tokens.filter(t => t.hasSufficientBalance);
      const insufficient = tokens.filter(t => !t.hasSufficientBalance);

      if (sufficient.length > 0) {
        const suffEl = document.createElement('div');
        suffEl.className = 'mb-4';
        suffEl.innerHTML = '<p class="text-xs font-medium text-green-600 mb-2">✓ Available for payment</p>';

        sufficient.forEach(token => {
          suffEl.appendChild(createTokenElement(token, true));
        });

        list.appendChild(suffEl);
      }

      if (insufficient.length > 0) {
        const insuffEl = document.createElement('div');
        insuffEl.innerHTML = '<p class="text-xs font-medium text-gray-400 mb-2">Insufficient balance</p>';

        insufficient.forEach(token => {
          insuffEl.appendChild(createTokenElement(token, false));
        });

        list.appendChild(insuffEl);
      }

      document.getElementById('tokens-loading').classList.add('hidden');
      list.classList.remove('hidden');
    }

    // Create a token element
    function createTokenElement(token, canSelect) {
      const tokenEl = document.createElement('button');
      tokenEl.className = 'token-option w-full flex items-center gap-3 p-3 border rounded-lg text-left mb-2 ' +
        (canSelect
          ? 'border-gray-200 hover:border-indigo-300 cursor-pointer'
          : 'border-gray-100 bg-gray-50 opacity-60 cursor-not-allowed');
      tokenEl.dataset.assetId = token.assetId;
      tokenEl.disabled = !canSelect;

      tokenEl.innerHTML = \`
        <div class="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center text-sm font-bold text-gray-600 flex-shrink-0">
          \${token.symbol.substring(0, 2)}
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            <p class="font-medium text-gray-900">\${token.symbol}</p>
            \${canSelect ? '<span class="text-xs text-green-600">✓</span>' : ''}
          </div>
          <p class="text-xs text-gray-500">Balance: \${token.balanceFormatted} (\$\${token.balanceUsd.toFixed(2)})</p>
        </div>
        <div class="text-right flex-shrink-0">
          <p class="text-sm font-medium \${canSelect ? 'text-indigo-600' : 'text-gray-400'}">
            \${token.requiredAmountFormatted || '--'}
          </p>
          <p class="text-xs text-gray-500">required</p>
        </div>
      \`;

      if (canSelect) {
        tokenEl.addEventListener('click', () => selectToken(token, tokenEl));
      }

      return tokenEl;
    }

    // Handle token selection
    function selectToken(token, element) {
      // Update UI
      document.querySelectorAll('.token-option').forEach(el => el.classList.remove('selected'));
      element.classList.add('selected');

      selectedToken = token;
      document.getElementById('continue-to-confirm').disabled = false;
    }

    // Show step
    function showStep(step) {
      ['connect', 'tokens', 'confirm', 'processing', 'success', 'error'].forEach(s => {
        const el = document.getElementById('step-' + s);
        if (el) el.classList.add('hidden');
      });

      const stepEl = document.getElementById('step-' + step);
      if (stepEl) {
        stepEl.classList.remove('hidden');
        stepEl.classList.add('fade-in');
      }
    }

    function setProcessingMessage(msg) {
      const el = document.getElementById('processing-message');
      if (el) el.textContent = msg;
    }

    function showError(message) {
      const errorMsg = document.getElementById('error-message');
      if (errorMsg) errorMsg.textContent = message;
      showStep('error');
    }

    // Handle chain selection
    async function handleChainSelect(chain) {
      showStep('processing');
      setProcessingMessage('Connecting wallet...');
      selectedChain = chain;

      try {
        let walletAddress;
        let needsLinking = true;

        if (chain === 'near') {
          // If we already have a NEAR wallet linked, use it directly
          if (config.hasWallet && config.nearAccountId) {
            walletAddress = config.nearAccountId;
            connectedWallet = { address: walletAddress, chain: 'near' };
            console.log('Using existing NEAR wallet:', walletAddress);
            needsLinking = false; // Already linked
          } else {
            // Connect NEAR wallet via HOT Connect
            await initNearConnector();
            const wallet = await nearConnector.connect();
            const { accounts } = await nearConnector.getConnectedWallet();

            if (!accounts?.length) {
              throw new Error('No accounts found after connecting.');
            }
            walletAddress = accounts[0].accountId;
            connectedWallet = { address: walletAddress, chain: 'near' };
          }
        } else if (chain === 'sol') {
          // Connect Solana wallet
          walletAddress = await connectSolanaWallet();
          connectedWallet = { address: walletAddress, chain: 'sol' };
        } else if (chain === 'ton') {
          // Connect TON wallet
          walletAddress = await connectTonWallet();
          connectedWallet = { address: walletAddress, chain: 'ton' };
        } else if (chain === 'stellar') {
          // Connect Stellar wallet
          walletAddress = await connectStellarWallet();
          connectedWallet = { address: walletAddress, chain: 'stellar' };
        } else if (chain === 'tron') {
          // Connect TRON wallet
          walletAddress = await connectTronWallet();
          connectedWallet = { address: walletAddress, chain: 'tron' };
        } else {
          // Connect EVM wallet (eth, base, arb, pol, etc.)
          walletAddress = await connectEvmWallet(chain);
          connectedWallet = { address: walletAddress, chain: chain };
        }

        // Link wallet to subscription (for license) - ALL chains need linking
        if (needsLinking && walletAddress) {
          setProcessingMessage('Linking wallet...');
          console.log('Linking wallet:', { intentId: config.intentId, walletAddress, chain });
          const linkResponse = await fetch('/api/crypto/subscribe/link', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              intentId: config.intentId,
              walletAddress: walletAddress,
              chain: chain
            })
          });

          if (!linkResponse.ok) {
            const err = await linkResponse.json();
            console.error('Link failed:', err);
            throw new Error(err.error || 'Failed to link wallet');
          }
          console.log('Wallet linked successfully');
        }

        // Load wallet tokens with balances
        setProcessingMessage('Loading your tokens...');
        availableTokens = await fetchWalletTokens();

        renderTokens(availableTokens);
        showStep('tokens');

      } catch (err) {
        console.error('Connect error:', err);
        showError(err.message || 'Failed to connect wallet');
      }
    }

    // Continue to confirmation - uses pre-computed values from wallet-tokens
    function handleContinueToConfirm() {
      if (!selectedToken) return;

      // Update confirmation UI with pre-computed values
      document.getElementById('confirm-amount').textContent =
        selectedToken.requiredAmountFormatted + ' ' + selectedToken.symbol;
      document.getElementById('confirm-value').textContent =
        '≈ $' + config.amountUsd + ' USDC';

      showStep('confirm');
    }

    // Execute payment
    async function handleConfirmPayment() {
      showStep('processing');
      setProcessingMessage('Creating payment quote...');

      try {
        // Create payment quote with deposit address
        // This gets a deposit address on the origin chain that 1Click monitors
        // When tokens arrive, 1Click swaps to USDC and sends to specflow.near
        const paymentData = await createPaymentQuote(selectedToken);

        if (!paymentData.quote?.depositAddress) {
          throw new Error('Failed to get deposit address');
        }

        const depositAddress = paymentData.quote.depositAddress;
        const amountIn = paymentData.quote.amountIn;
        const amountInFormatted = paymentData.quote.amountInFormatted;
        const isNativeNear = paymentData.quote.isNativeNear === true;

        setProcessingMessage('Please confirm in your wallet...');

        // Handle payment based on blockchain
        const isNearChain = selectedToken.blockchain === 'near';

        if (isNearChain) {
          // NEAR chain - use NEAR wallet to send
          await initNearConnector();
          const wallet = await nearConnector.connect();

          let result;

          if (isNativeNear) {
            // Native NEAR payment requires three steps:
            // 1. Register the deposit address for storage on wrap.near (if not already registered)
            // 2. Wrap NEAR to wNEAR via wrap.near contract
            // 3. Transfer wNEAR to the 1Click deposit address
            // We combine these in a single transaction batch for atomic execution

            setProcessingMessage('Wrapping NEAR and sending payment...');

            // Storage deposit minimum is 0.00125 NEAR (1250000000000000000000 yoctoNEAR)
            // We'll use a slightly higher amount to be safe
            const storageDeposit = '1250000000000000000000';

            result = await wallet.signAndSendTransactions({
              transactions: [
                {
                  // Step 1: Register deposit address on wrap.near for storage
                  // This allows the address to receive wNEAR tokens
                  receiverId: 'wrap.near',
                  actions: [{
                    type: 'FunctionCall',
                    params: {
                      methodName: 'storage_deposit',
                      args: {
                        account_id: depositAddress,
                        registration_only: true
                      },
                      gas: '10000000000000', // 10 TGas
                      deposit: storageDeposit
                    }
                  }]
                },
                {
                  // Step 2: Wrap NEAR to wNEAR
                  receiverId: 'wrap.near',
                  actions: [{
                    type: 'FunctionCall',
                    params: {
                      methodName: 'near_deposit',
                      args: {},
                      gas: '10000000000000', // 10 TGas
                      deposit: amountIn // Attach the NEAR to wrap
                    }
                  }]
                },
                {
                  // Step 3: Transfer wNEAR to 1Click deposit address
                  receiverId: 'wrap.near',
                  actions: [{
                    type: 'FunctionCall',
                    params: {
                      methodName: 'ft_transfer',
                      args: {
                        receiver_id: depositAddress,
                        amount: amountIn,
                        memo: 'Hopper subscription payment'
                      },
                      gas: '30000000000000', // 30 TGas
                      deposit: '1' // 1 yoctoNEAR required for ft_transfer
                    }
                  }]
                }
              ]
            });

            // signAndSendTransactions returns array of results
            if (!result || result.length < 3 || !result[2]?.transaction) {
              throw new Error('Transaction cancelled or failed');
            }
          } else {
            // NEP-141 token transfer (format: nep141:contract_id)
            // Need to register storage for the deposit address first
            const contractId = selectedToken.assetId.replace('nep141:', '');

            // Storage deposit minimum is 0.00125 NEAR
            const storageDeposit = '1250000000000000000000';

            result = await wallet.signAndSendTransactions({
              transactions: [
                {
                  // Step 1: Register deposit address for storage on the token contract
                  receiverId: contractId,
                  actions: [{
                    type: 'FunctionCall',
                    params: {
                      methodName: 'storage_deposit',
                      args: {
                        account_id: depositAddress,
                        registration_only: true
                      },
                      gas: '10000000000000', // 10 TGas
                      deposit: storageDeposit
                    }
                  }]
                },
                {
                  // Step 2: Transfer tokens to 1Click deposit address
                  receiverId: contractId,
                  actions: [{
                    type: 'FunctionCall',
                    params: {
                      methodName: 'ft_transfer',
                      args: {
                        receiver_id: depositAddress,
                        amount: amountIn,
                        memo: 'Hopper subscription payment'
                      },
                      gas: '30000000000000', // 30 TGas
                      deposit: '1' // 1 yoctoNEAR required for ft_transfer
                    }
                  }]
                }
              ]
            });

            // Check transaction results
            if (!result || result.length < 2 || !result[1]?.transaction) {
              throw new Error('Transaction cancelled or failed');
            }
          }

          // Notify backend of the deposit tx
          setProcessingMessage('Confirming payment...');
          const confirmResponse = await fetch('/api/crypto/subscribe/confirm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ intentId: config.intentId })
          });
          const confirmData = await confirmResponse.json();

          showStep('success');
          setTimeout(() => {
            // Use the redirect URL from confirm response (includes wallet auth info)
            // Falls back to payment-success if not provided
            window.location.href = confirmData.redirectUrl || 'vscode://VitalPoint.hopper-velocity/payment-success';
          }, 2000);

        } else if (['eth', 'base', 'arb', 'pol', 'bsc', 'avax', 'op'].includes(selectedToken.blockchain)) {
          // EVM chain - use MetaMask/injected wallet to send
          if (!evmProvider) {
            throw new Error('EVM wallet not connected');
          }

          // Check if sending native token (ETH, MATIC, etc.) or ERC-20
          const isNativeToken = selectedToken.name.includes('Native') ||
            (selectedToken.symbol === 'ETH' && !selectedToken.assetId.includes(':')) ||
            selectedToken.symbol === 'MATIC' || selectedToken.symbol === 'BNB';

          if (isNativeToken) {
            // Native transfer (ETH, MATIC, etc.)
            const txHash = await evmProvider.request({
              method: 'eth_sendTransaction',
              params: [{
                from: connectedWallet.address,
                to: depositAddress,
                value: '0x' + BigInt(amountIn).toString(16),
              }]
            });

            console.log('Native transfer tx:', txHash);

          } else {
            // ERC-20 token transfer
            // We need the contract address - extract from assetId
            // Format: erc20:eth:0x... or similar
            const contractAddress = selectedToken.contractAddress ||
              selectedToken.assetId.split(':').pop();

            if (!contractAddress) {
              throw new Error('Could not determine token contract address');
            }

            // ERC-20 transfer function: transfer(address to, uint256 amount)
            // Function selector: 0xa9059cbb
            const transferData = '0xa9059cbb' +
              depositAddress.slice(2).padStart(64, '0') +
              BigInt(amountIn).toString(16).padStart(64, '0');

            const txHash = await evmProvider.request({
              method: 'eth_sendTransaction',
              params: [{
                from: connectedWallet.address,
                to: contractAddress,
                data: transferData,
              }]
            });

            console.log('ERC-20 transfer tx:', txHash);
          }

          // Poll for confirmation since 1Click will process the swap
          setProcessingMessage('Processing payment via NEAR Intents...');

          // Start polling for payment confirmation
          await pollForConfirmation();

        } else if (selectedToken.blockchain === 'sol') {
          // Solana chain - use Phantom/Solflare
          if (!solanaProvider) {
            throw new Error('Solana wallet not connected');
          }

          setProcessingMessage('Sending Solana payment...');

          // For Solana SPL tokens, we need to use the SPL Token program
          // For native SOL, we do a regular transfer
          const isNativeSol = selectedToken.symbol === 'SOL' && !selectedToken.contractAddress;

          if (isNativeSol) {
            // Native SOL transfer
            const { Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } = await import('https://esm.sh/@solana/web3.js@1.95.4');

            const connection = new Connection('https://api.mainnet-beta.solana.com');
            const fromPubkey = new PublicKey(connectedWallet.address);
            const toPubkey = new PublicKey(depositAddress);

            const transaction = new Transaction().add(
              SystemProgram.transfer({
                fromPubkey,
                toPubkey,
                lamports: BigInt(amountIn),
              })
            );

            transaction.feePayer = fromPubkey;
            const { blockhash } = await connection.getLatestBlockhash();
            transaction.recentBlockhash = blockhash;

            const signedTx = await solanaProvider.signTransaction(transaction);
            const txHash = await connection.sendRawTransaction(signedTx.serialize());

            console.log('SOL transfer tx:', txHash);
          } else {
            // SPL Token transfer
            // Note: Requires the token's mint address and associated token accounts
            // This is more complex - for now, show an informative error
            throw new Error('SPL token transfers coming soon. Please use native SOL for now.');
          }

          // Poll for confirmation
          setProcessingMessage('Processing payment via NEAR Intents...');
          await pollForConfirmation();

        } else if (selectedToken.blockchain === 'ton') {
          // TON chain
          if (!tonConnector) {
            throw new Error('TON wallet not connected');
          }

          setProcessingMessage('Sending TON payment...');

          // TON uses nanotons (1 TON = 10^9 nanotons)
          // The deposit address may include a memo requirement
          const memo = paymentData.quote.depositMemo || '';

          try {
            const txResult = await tonConnector.send('ton_sendTransaction', [{
              to: depositAddress,
              value: amountIn, // in nanotons
              data: memo,
            }]);

            console.log('TON transfer tx:', txResult);
          } catch (err) {
            throw new Error('TON transfer failed: ' + (err.message || 'Unknown error'));
          }

          // Poll for confirmation
          setProcessingMessage('Processing payment via NEAR Intents...');
          await pollForConfirmation();

        } else if (selectedToken.blockchain === 'stellar') {
          // Stellar chain
          if (!stellarProvider) {
            throw new Error('Stellar wallet not connected');
          }

          setProcessingMessage('Sending Stellar payment...');

          // Stellar uses stroops (1 XLM = 10^7 stroops)
          // Stellar requires a memo for deposit identification
          const memo = paymentData.quote.depositMemo || '';

          // Build and sign the transaction using Freighter
          // Note: This requires building an XDR transaction
          const isNativeXlm = selectedToken.symbol === 'XLM';

          try {
            // For Stellar, we need to use stellar-sdk to build the transaction
            // Freighter will sign it
            // This is a simplified version - production would use stellar-sdk
            const txXdr = await buildStellarTransaction(
              connectedWallet.address,
              depositAddress,
              amountIn,
              isNativeXlm ? 'native' : selectedToken.contractAddress,
              memo
            );

            const signedTx = await stellarProvider.signTransaction(txXdr);
            console.log('Stellar signed tx:', signedTx);

            // Submit to Stellar network
            const response = await fetch('https://horizon.stellar.org/transactions', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: 'tx=' + encodeURIComponent(signedTx)
            });

            if (!response.ok) {
              throw new Error('Failed to submit Stellar transaction');
            }
          } catch (err) {
            throw new Error('Stellar transfer failed: ' + (err.message || 'Unknown error'));
          }

          // Poll for confirmation
          setProcessingMessage('Processing payment via NEAR Intents...');
          await pollForConfirmation();

        } else if (selectedToken.blockchain === 'tron') {
          // TRON chain
          if (!tronProvider) {
            throw new Error('TRON wallet not connected');
          }

          setProcessingMessage('Sending TRON payment...');

          const isNativeTrx = selectedToken.symbol === 'TRX';

          try {
            if (isNativeTrx) {
              // Native TRX transfer
              const tx = await tronProvider.transactionBuilder.sendTrx(
                depositAddress,
                parseInt(amountIn), // in sun (1 TRX = 10^6 sun)
                connectedWallet.address
              );

              const signedTx = await tronProvider.trx.sign(tx);
              const result = await tronProvider.trx.sendRawTransaction(signedTx);

              console.log('TRX transfer tx:', result.txid);
            } else {
              // TRC-20 token transfer
              const contractAddress = selectedToken.contractAddress;

              if (!contractAddress) {
                throw new Error('Token contract address not found');
              }

              const contract = await tronProvider.contract().at(contractAddress);
              const result = await contract.transfer(depositAddress, amountIn).send();

              console.log('TRC-20 transfer tx:', result);
            }
          } catch (err) {
            throw new Error('TRON transfer failed: ' + (err.message || 'Unknown error'));
          }

          // Poll for confirmation
          setProcessingMessage('Processing payment via NEAR Intents...');
          await pollForConfirmation();
        } else {
          // Unknown/unsupported chain
          throw new Error('Unsupported blockchain: ' + selectedToken.blockchain);
        }

      } catch (err) {
        console.error('Payment error:', err);
        showError(err.message || 'Payment failed');
      }
    }

    // Helper function to build Stellar transaction XDR
    // In production, use stellar-sdk properly
    async function buildStellarTransaction(source, destination, amount, asset, memo) {
      // This is a placeholder - in production, use stellar-sdk
      // For now, we'll rely on the wallet to handle transaction building
      throw new Error('Stellar transaction building requires additional setup. Please contact support.');
    }

    // Poll for payment confirmation
    async function pollForConfirmation() {
      showStep('processing');
      setProcessingMessage('Checking for payment...');

      let attempts = 0;
      const maxAttempts = 60;

      while (attempts < maxAttempts) {
        await new Promise(r => setTimeout(r, 2000));

        try {
          const response = await fetch('/api/crypto/subscribe/confirm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ intentId: config.intentId })
          });

          const data = await response.json();

          if (response.ok && data.success) {
            showStep('success');
            setTimeout(() => {
              // Use the redirect URL from confirm response (includes wallet auth info)
              window.location.href = data.redirectUrl || 'vscode://VitalPoint.hopper-velocity/payment-success';
            }, 2000);
            return;
          }
        } catch {
          // Continue polling
        }

        attempts++;
        setProcessingMessage(\`Checking for payment... (\${maxAttempts - attempts}s)\`);
      }

      showError('Payment not detected. If you sent payment, please wait a few minutes and refresh.');
    }

    // Event listeners
    // Chain selection buttons (for new users)
    document.querySelectorAll('.chain-option').forEach(btn => {
      if (!btn.disabled) {
        btn.addEventListener('click', () => {
          const chain = btn.dataset.chain;
          if (chain) handleChainSelect(chain);
        });
      }
    });

    document.getElementById('back-to-connect')?.addEventListener('click', () => showStep('connect'));
    document.getElementById('continue-to-confirm')?.addEventListener('click', handleContinueToConfirm);
    document.getElementById('back-to-tokens')?.addEventListener('click', () => showStep('tokens'));
    document.getElementById('confirm-payment-btn')?.addEventListener('click', handleConfirmPayment);
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
  <title>Payment Not Found - Hopper</title>
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
  console.log('[pay] Looking up intent:', intentId);

  if (!intentId) {
    console.log('[pay] No intentId provided');
    return c.html(notFoundPage(), 404);
  }

  // Look up subscription by intent ID
  const subscription = await getCryptoSubscriptionByIntentId(
    c.env.CRYPTO_SUBSCRIPTIONS,
    intentId
  );
  console.log('[pay] Subscription found:', !!subscription, subscription ? subscription.status : 'null');

  if (!subscription) {
    console.log('[pay] Subscription not found for intentId:', intentId);
    return c.html(notFoundPage(), 404);
  }

  // Render payment page
  return c.html(paymentPage({
    nearAccountId: subscription.nearAccountId,
    intentId: subscription.intentId,
    monthlyAmountUsd: subscription.monthlyAmountUsd,
    depositAddress: subscription.intentId,
    status: subscription.status,
    network: c.env.NEAR_NETWORK,
  }));
}

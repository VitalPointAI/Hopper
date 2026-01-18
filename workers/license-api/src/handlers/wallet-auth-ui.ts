/**
 * Multi-chain Wallet Authentication Page
 * Supports NEAR, Ethereum, Solana, TON, Stellar, TRON, etc.
 */

import type { Context } from 'hono';
import type { Env } from '../types';

/**
 * Multi-chain wallet authentication page HTML
 */
function walletAuthPage(params: {
  callback: string;
  network: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Connect Wallet - Hopper</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    .chain-option { transition: all 0.15s ease; }
    .chain-option:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
    .chain-option.selected { border-color: #4F46E5; background-color: #EEF2FF; }
    .fade-in { animation: fadeIn 0.2s ease; }
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
    .spin { animation: spin 1s linear infinite; }
    @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  </style>
</head>
<body class="bg-gradient-to-br from-indigo-50 to-purple-50 min-h-screen">
  <div class="min-h-screen flex flex-col items-center justify-center p-4">
    <!-- Header -->
    <div class="text-center mb-8">
      <h1 class="text-3xl font-bold text-gray-900 mb-2">Connect Wallet</h1>
      <p class="text-gray-600">Select your wallet to authenticate with Hopper</p>
    </div>

    <!-- Wallet Card -->
    <div class="max-w-lg w-full bg-white rounded-2xl shadow-xl overflow-hidden">
      <div class="p-6">
        <!-- Chain Selection -->
        <div id="step-select" class="space-y-4">
          <h3 class="font-semibold text-gray-900 mb-3">Select Wallet Network</h3>

          <div id="chain-options" class="grid grid-cols-2 gap-3">
            <button data-chain="near" class="chain-option flex items-center gap-3 p-4 border-2 border-gray-200 rounded-xl hover:border-indigo-300 transition-colors">
              <div class="w-10 h-10 bg-black rounded-full flex items-center justify-center text-white font-bold">N</div>
              <div class="text-left">
                <p class="font-medium text-gray-900">NEAR</p>
                <p class="text-xs text-gray-500">NEAR Protocol</p>
              </div>
            </button>

            <button data-chain="eth" class="chain-option flex items-center gap-3 p-4 border-2 border-gray-200 rounded-xl hover:border-indigo-300 transition-colors">
              <div class="w-10 h-10 bg-[#627EEA] rounded-full flex items-center justify-center text-white font-bold">Ξ</div>
              <div class="text-left">
                <p class="font-medium text-gray-900">Ethereum</p>
                <p class="text-xs text-gray-500">MetaMask, etc.</p>
              </div>
            </button>

            <button data-chain="base" class="chain-option flex items-center gap-3 p-4 border-2 border-gray-200 rounded-xl hover:border-indigo-300 transition-colors">
              <div class="w-10 h-10 bg-[#0052FF] rounded-full flex items-center justify-center text-white font-bold">B</div>
              <div class="text-left">
                <p class="font-medium text-gray-900">Base</p>
                <p class="text-xs text-gray-500">Coinbase L2</p>
              </div>
            </button>

            <button data-chain="arb" class="chain-option flex items-center gap-3 p-4 border-2 border-gray-200 rounded-xl hover:border-indigo-300 transition-colors">
              <div class="w-10 h-10 bg-[#28A0F0] rounded-full flex items-center justify-center text-white font-bold">A</div>
              <div class="text-left">
                <p class="font-medium text-gray-900">Arbitrum</p>
                <p class="text-xs text-gray-500">Arbitrum One</p>
              </div>
            </button>

            <button data-chain="sol" class="chain-option flex items-center gap-3 p-4 border-2 border-gray-200 rounded-xl hover:border-indigo-300 transition-colors">
              <div class="w-10 h-10 bg-gradient-to-r from-[#9945FF] to-[#14F195] rounded-full flex items-center justify-center text-white font-bold">S</div>
              <div class="text-left">
                <p class="font-medium text-gray-900">Solana</p>
                <p class="text-xs text-gray-500">Phantom, etc.</p>
              </div>
            </button>

            <button data-chain="pol" class="chain-option flex items-center gap-3 p-4 border-2 border-gray-200 rounded-xl hover:border-indigo-300 transition-colors">
              <div class="w-10 h-10 bg-[#8247E5] rounded-full flex items-center justify-center text-white font-bold">P</div>
              <div class="text-left">
                <p class="font-medium text-gray-900">Polygon</p>
                <p class="text-xs text-gray-500">Polygon PoS</p>
              </div>
            </button>

            <button data-chain="ton" class="chain-option flex items-center gap-3 p-4 border-2 border-gray-200 rounded-xl hover:border-indigo-300 transition-colors">
              <div class="w-10 h-10 bg-[#0088CC] rounded-full flex items-center justify-center text-white font-bold">T</div>
              <div class="text-left">
                <p class="font-medium text-gray-900">TON</p>
                <p class="text-xs text-gray-500">Tonkeeper, etc.</p>
              </div>
            </button>

            <button data-chain="tron" class="chain-option flex items-center gap-3 p-4 border-2 border-gray-200 rounded-xl hover:border-indigo-300 transition-colors">
              <div class="w-10 h-10 bg-[#FF0013] rounded-full flex items-center justify-center text-white font-bold">T</div>
              <div class="text-left">
                <p class="font-medium text-gray-900">TRON</p>
                <p class="text-xs text-gray-500">TronLink</p>
              </div>
            </button>
          </div>

          <p class="text-xs text-center text-gray-500 mt-4">
            Your wallet address will be used as your Hopper account ID
          </p>
        </div>

        <!-- Connecting State -->
        <div id="step-connecting" class="hidden py-12 text-center fade-in">
          <div class="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full spin mx-auto"></div>
          <p class="mt-4 text-gray-600" id="connecting-message">Connecting wallet...</p>
        </div>

        <!-- Success State -->
        <div id="step-success" class="hidden py-12 text-center fade-in">
          <div class="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg class="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
            </svg>
          </div>
          <h3 class="text-lg font-semibold text-gray-900 mb-2">Connected!</h3>
          <p class="text-gray-600 mb-2" id="success-address"></p>
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
                <h3 class="text-sm font-medium text-red-800">Connection Failed</h3>
                <p class="mt-1 text-sm text-red-700" id="error-message"></p>
              </div>
            </div>
          </div>
          <button id="retry-btn" class="mt-4 w-full py-3 px-4 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-lg transition-colors">
            Try Again
          </button>
        </div>
      </div>
    </div>

    <!-- Footer -->
    <div class="mt-8 text-center text-sm text-gray-500">
      <p>Your wallet proves ownership without sharing private keys</p>
    </div>
  </div>

  <script type="module">
    import { NearConnector } from 'https://esm.sh/@hot-labs/near-connect';

    // Config
    const config = {
      callback: '${params.callback}',
      network: '${params.network}'
    };

    // Chain configurations for EVM networks
    const CHAIN_CONFIG = {
      eth: { chainId: '0x1', name: 'Ethereum' },
      base: { chainId: '0x2105', name: 'Base' },
      arb: { chainId: '0xa4b1', name: 'Arbitrum' },
      pol: { chainId: '0x89', name: 'Polygon' },
    };

    // State
    let nearConnector = null;
    let evmProvider = null;

    // UI helpers
    function showStep(step) {
      ['select', 'connecting', 'success', 'error'].forEach(s => {
        const el = document.getElementById('step-' + s);
        if (el) {
          el.classList.add('hidden');
          el.classList.remove('fade-in');
        }
      });
      const stepEl = document.getElementById('step-' + step);
      if (stepEl) {
        stepEl.classList.remove('hidden');
        stepEl.classList.add('fade-in');
      }
    }

    function setConnectingMessage(msg) {
      const el = document.getElementById('connecting-message');
      if (el) el.textContent = msg;
    }

    function showError(message) {
      const errorMsg = document.getElementById('error-message');
      if (errorMsg) errorMsg.textContent = message;
      showStep('error');
    }

    function showSuccess(address) {
      const addrEl = document.getElementById('success-address');
      if (addrEl) {
        addrEl.textContent = address.length > 30
          ? address.slice(0, 12) + '...' + address.slice(-10)
          : address;
      }
      showStep('success');
    }

    // Redirect to VSCode with auth info
    function redirectToVSCode(walletAddress, chain) {
      const callbackUrl = new URL(config.callback);
      callbackUrl.searchParams.set('type', 'wallet');
      callbackUrl.searchParams.set('accountId', walletAddress);
      callbackUrl.searchParams.set('chain', chain);
      callbackUrl.searchParams.set('status', 'success');

      showSuccess(walletAddress);
      setTimeout(() => {
        window.location.href = callbackUrl.toString();
      }, 1500);
    }

    // Initialize NEAR connector
    async function initNearConnector() {
      if (nearConnector) return nearConnector;

      nearConnector = new NearConnector({
        network: config.network,
        features: { signAndSendTransaction: false }
      });

      return nearConnector;
    }

    // Connect NEAR wallet
    async function connectNear() {
      showStep('connecting');
      setConnectingMessage('Opening NEAR wallet...');

      try {
        await initNearConnector();
        await nearConnector.connect();
        const { accounts } = await nearConnector.getConnectedWallet();

        if (!accounts?.length) {
          throw new Error('No accounts found after connecting.');
        }

        const walletAddress = accounts[0].accountId;
        redirectToVSCode(walletAddress, 'near');
      } catch (err) {
        console.error('NEAR connect error:', err);
        showError(err.message || 'Failed to connect NEAR wallet');
      }
    }

    // Connect EVM wallet
    async function connectEvm(chain) {
      showStep('connecting');
      setConnectingMessage('Opening wallet...');

      try {
        if (!window.ethereum) {
          throw new Error('No Ethereum wallet detected. Please install MetaMask.');
        }

        evmProvider = window.ethereum;

        // Request accounts
        const accounts = await evmProvider.request({ method: 'eth_requestAccounts' });
        if (!accounts?.length) {
          throw new Error('No accounts found. Please unlock your wallet.');
        }

        // Switch to correct chain
        const chainConfig = CHAIN_CONFIG[chain];
        if (chainConfig) {
          try {
            await evmProvider.request({
              method: 'wallet_switchEthereumChain',
              params: [{ chainId: chainConfig.chainId }],
            });
          } catch (switchError) {
            if (switchError.code !== 4902) {
              console.warn('Could not switch chain:', switchError);
            }
          }
        }

        const walletAddress = accounts[0];
        redirectToVSCode(walletAddress, chain);
      } catch (err) {
        console.error('EVM connect error:', err);
        showError(err.message || 'Failed to connect wallet');
      }
    }

    // Connect Solana wallet
    async function connectSolana() {
      showStep('connecting');
      setConnectingMessage('Opening Solana wallet...');

      try {
        const provider = window.phantom?.solana || window.solana || window.solflare;

        if (!provider) {
          throw new Error('No Solana wallet detected. Please install Phantom.');
        }

        const response = await provider.connect();
        const walletAddress = response.publicKey.toString();
        redirectToVSCode(walletAddress, 'sol');
      } catch (err) {
        console.error('Solana connect error:', err);
        showError(err.message || 'Failed to connect Solana wallet');
      }
    }

    // Connect TON wallet
    async function connectTon() {
      showStep('connecting');
      setConnectingMessage('Opening TON wallet...');

      try {
        const provider = window.ton || window.tonkeeper;

        if (!provider) {
          throw new Error('No TON wallet detected. Please install Tonkeeper.');
        }

        const accounts = await provider.send('ton_requestAccounts');
        if (!accounts?.length) {
          throw new Error('No TON accounts found.');
        }

        redirectToVSCode(accounts[0], 'ton');
      } catch (err) {
        console.error('TON connect error:', err);
        showError(err.message || 'Failed to connect TON wallet');
      }
    }

    // Connect TRON wallet
    async function connectTron() {
      showStep('connecting');
      setConnectingMessage('Opening TRON wallet...');

      try {
        if (!window.tronWeb || !window.tronLink) {
          throw new Error('No TRON wallet detected. Please install TronLink.');
        }

        if (!window.tronWeb.ready) {
          const res = await window.tronLink.request({ method: 'tron_requestAccounts' });
          if (res.code !== 200) {
            throw new Error('Connection rejected.');
          }
        }

        const walletAddress = window.tronWeb.defaultAddress.base58;
        if (!walletAddress) {
          throw new Error('Could not get TRON address.');
        }

        redirectToVSCode(walletAddress, 'tron');
      } catch (err) {
        console.error('TRON connect error:', err);
        showError(err.message || 'Failed to connect TRON wallet');
      }
    }

    // Handle chain selection
    async function handleChainSelect(chain) {
      switch (chain) {
        case 'near':
          await connectNear();
          break;
        case 'eth':
        case 'base':
        case 'arb':
        case 'pol':
          await connectEvm(chain);
          break;
        case 'sol':
          await connectSolana();
          break;
        case 'ton':
          await connectTon();
          break;
        case 'tron':
          await connectTron();
          break;
        default:
          showError('Unsupported chain: ' + chain);
      }
    }

    // Event listeners
    document.querySelectorAll('.chain-option').forEach(btn => {
      btn.addEventListener('click', () => {
        const chain = btn.dataset.chain;
        if (chain) handleChainSelect(chain);
      });
    });

    document.getElementById('retry-btn')?.addEventListener('click', () => showStep('select'));
  </script>
</body>
</html>`;
}

/**
 * GET /auth/wallet
 * Multi-chain wallet authentication page
 */
export async function handleWalletAuthPage(
  c: Context<{ Bindings: Env }>
): Promise<Response> {
  const callback = c.req.query('callback') || 'vscode://VitalPoint.hopper-velocity/auth-callback';
  const network = c.req.query('network') || 'mainnet';

  return c.html(walletAuthPage({ callback, network }));
}

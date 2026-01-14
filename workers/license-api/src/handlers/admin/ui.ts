/**
 * Admin Dashboard UI Templates
 * Serves HTML pages with htmx for dynamic updates
 */

import type { Context } from 'hono';
import type { Env } from '../../types';

/**
 * Base HTML layout with Tailwind CSS and htmx
 */
function baseLayout(title: string, content: string, includeAuth = true): string {
  const authScript = includeAuth
    ? `
    <script>
      // Check for JWT token on load
      document.addEventListener('DOMContentLoaded', function() {
        const token = localStorage.getItem('specflow_admin_token');
        if (!token && !window.location.pathname.includes('/admin/login')) {
          window.location.href = '/admin/login';
          return;
        }

        // Set htmx headers for all requests
        if (token) {
          document.body.setAttribute('hx-headers', JSON.stringify({
            'Authorization': 'Bearer ' + token
          }));
        }
      });

      // Handle 401 responses (token expired)
      document.body.addEventListener('htmx:responseError', function(event) {
        if (event.detail.xhr.status === 401) {
          localStorage.removeItem('specflow_admin_token');
          window.location.href = '/admin/login';
        }
      });

      function logout() {
        localStorage.removeItem('specflow_admin_token');
        window.location.href = '/admin/login';
      }
    </script>
    `
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - SpecFlow Admin</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://unpkg.com/htmx.org@1.9.10"></script>
  ${authScript}
  <style>
    .htmx-indicator { display: none; }
    .htmx-request .htmx-indicator { display: inline-block; }
    .htmx-request.htmx-indicator { display: inline-block; }
  </style>
</head>
<body class="bg-gray-100 min-h-screen" hx-ext="json-enc">
  ${content}
</body>
</html>`;
}

/**
 * Navigation header component
 */
function navHeader(activePage: string): string {
  const navItems = [
    { id: 'dashboard', label: 'Dashboard', href: '/admin/dashboard' },
    { id: 'licenses', label: 'Licenses', href: '/admin/licenses' },
    { id: 'subscriptions', label: 'Subscriptions', href: '/admin/subscriptions' },
  ];

  const navLinks = navItems
    .map((item) => {
      const isActive = item.id === activePage;
      const classes = isActive
        ? 'bg-indigo-700 text-white px-3 py-2 rounded-md text-sm font-medium'
        : 'text-indigo-100 hover:bg-indigo-500 hover:text-white px-3 py-2 rounded-md text-sm font-medium';
      return `<a href="${item.href}" class="${classes}">${item.label}</a>`;
    })
    .join('\n        ');

  return `
  <nav class="bg-indigo-600">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="flex items-center justify-between h-16">
        <div class="flex items-center">
          <div class="flex-shrink-0">
            <span class="text-white text-xl font-bold">SpecFlow Admin</span>
          </div>
          <div class="ml-10 flex items-baseline space-x-4">
            ${navLinks}
          </div>
        </div>
        <div>
          <button onclick="logout()" class="text-indigo-100 hover:text-white text-sm">
            Logout
          </button>
        </div>
      </div>
    </div>
  </nav>`;
}

/**
 * Login page HTML
 * Uses @hot-labs/near-connect for multi-wallet NEAR authentication
 */
export function loginPage(network: string): string {
  const content = `
  <div class="min-h-screen flex items-center justify-center bg-gray-100">
    <div class="max-w-md w-full space-y-8 p-8 bg-white rounded-lg shadow">
      <div>
        <h2 class="mt-6 text-center text-3xl font-extrabold text-gray-900">
          Admin Login
        </h2>
        <p class="mt-2 text-center text-sm text-gray-600">
          Sign in with your NEAR wallet
        </p>
      </div>

      <div id="login-container">
        <!-- Initial State: Login Button -->
        <div id="step-connect" class="space-y-4">
          <div class="bg-blue-50 border border-blue-200 rounded-md p-4">
            <h3 class="text-sm font-medium text-blue-800">Wallet Authentication</h3>
            <p class="mt-1 text-sm text-blue-700">
              Click Login to connect your NEAR wallet and sign an authentication challenge.
            </p>
          </div>
          <button
            id="connect-wallet-btn"
            class="w-full flex justify-center items-center gap-2 py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
          >
            <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M21 18v1c0 1.1-.9 2-2 2H5c-1.11 0-2-.9-2-2V5c0-1.1.89-2 2-2h14c1.1 0 2 .9 2 2v1h-9c-1.11 0-2 .9-2 2v8c0 1.1.89 2 2 2h9zm-9-2h10V8H12v8zm4-2.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/>
            </svg>
            Login
          </button>
          <p class="text-xs text-center text-gray-500">
            Supports Meteor, HOT, MyNearWallet, Intear, and more
          </p>
        </div>

        <!-- Signing State -->
        <div id="step-signing" class="hidden space-y-4">
          <div class="flex justify-center py-8">
            <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
          </div>
          <p class="text-center text-sm text-gray-600" id="signing-message">
            Connecting to wallet...
          </p>
        </div>

        <!-- Error display -->
        <div id="error-display" class="hidden mt-4 bg-red-50 border border-red-200 rounded-md p-4">
          <p class="text-sm text-red-700" id="error-message"></p>
          <button id="retry-btn" class="mt-2 text-sm text-red-600 hover:text-red-500 underline">
            Try again
          </button>
        </div>

        <!-- Success display -->
        <div id="success-display" class="hidden mt-4 bg-green-50 border border-green-200 rounded-md p-4">
          <p class="text-sm text-green-700">Login successful! Redirecting...</p>
        </div>
      </div>
    </div>
  </div>

  <script type="module">
    import { NearConnector } from 'https://esm.sh/@hot-labs/near-connect';

    // Global connector instance
    let connector = null;
    let connectedAccountId = null;

    // Initialize the connector
    async function initConnector() {
      connector = new NearConnector({
        network: '${network}',
        features: { signMessage: true }
      });

      // Handle sign-in events
      connector.on('wallet:signIn', async (event) => {
        if (event.accounts && event.accounts.length > 0) {
          connectedAccountId = event.accounts[0].accountId;
          console.log('Wallet connected:', connectedAccountId);
        }
      });

      // Handle sign-out events
      connector.on('wallet:signOut', async () => {
        connectedAccountId = null;
        console.log('Wallet disconnected');
      });

      return connector;
    }

    // Main login flow
    async function handleLogin() {
      showStep('signing');
      setSigningMessage('Initializing wallet connector...');

      try {
        // Initialize connector if not already done
        if (!connector) {
          await initConnector();
        }

        setSigningMessage('Opening wallet selector...');

        // Connect to wallet - this opens the wallet selector modal
        // and returns the connected wallet instance
        const wallet = await connector.connect();

        // Get the connected account
        const { accounts } = await connector.getConnectedWallet();
        if (!accounts || accounts.length === 0) {
          throw new Error('No accounts found after connecting wallet.');
        }
        connectedAccountId = accounts[0].accountId;

        setSigningMessage('Getting authentication challenge...');

        // Get challenge from server
        const challengeResponse = await fetch('/admin/auth/challenge');
        const challengeData = await challengeResponse.json();

        if (!challengeData.challenge) {
          throw new Error('Failed to get challenge from server');
        }

        setSigningMessage('Please sign the message in your wallet...');

        // Create nonce for NEP-413
        const nonce = new Uint8Array(32);
        crypto.getRandomValues(nonce);

        // Sign the message
        const signResult = await wallet.signMessage({
          message: challengeData.challenge,
          recipient: 'specflow-admin',
          nonce: Array.from(nonce),
        });

        if (!signResult || !signResult.signature) {
          throw new Error('Signing was cancelled or failed');
        }

        setSigningMessage('Verifying signature...');

        // Submit to server for verification
        // Include nonce and recipient for NEP-413 verification
        const verifyResponse = await fetch('/admin/auth/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            nearAccountId: signResult.accountId || connectedAccountId,
            signature: signResult.signature,
            publicKey: signResult.publicKey,
            message: challengeData.challenge,
            nonce: Array.from(nonce),
            recipient: 'specflow-admin',
          })
        });

        const verifyData = await verifyResponse.json();

        if (verifyResponse.ok && verifyData.token) {
          localStorage.setItem('specflow_admin_token', verifyData.token);
          showStep('success');
          setTimeout(() => {
            window.location.href = '/admin/dashboard';
          }, 1000);
        } else {
          throw new Error(verifyData.error || 'Verification failed');
        }
      } catch (err) {
        console.error('Login error:', err);
        showError(err.message || 'Failed to authenticate');
      }
    }

    // UI helpers
    function showStep(step) {
      document.getElementById('step-connect').classList.add('hidden');
      document.getElementById('step-signing').classList.add('hidden');
      document.getElementById('error-display').classList.add('hidden');
      document.getElementById('success-display').classList.add('hidden');

      switch(step) {
        case 'connect':
          document.getElementById('step-connect').classList.remove('hidden');
          break;
        case 'signing':
          document.getElementById('step-signing').classList.remove('hidden');
          break;
        case 'success':
          document.getElementById('success-display').classList.remove('hidden');
          break;
      }
    }

    function setSigningMessage(msg) {
      document.getElementById('signing-message').textContent = msg;
    }

    function showError(message) {
      document.getElementById('error-message').textContent = message;
      document.getElementById('step-connect').classList.add('hidden');
      document.getElementById('step-signing').classList.add('hidden');
      document.getElementById('error-display').classList.remove('hidden');
    }

    // Event handlers
    document.getElementById('connect-wallet-btn').addEventListener('click', handleLogin);
    document.getElementById('retry-btn').addEventListener('click', function() {
      showStep('connect');
    });
  </script>`;

  return baseLayout('Login', content, false);
}

/**
 * Dashboard page HTML
 */
export function dashboardPage(): string {
  const content = `
  ${navHeader('dashboard')}

  <main class="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
    <div class="px-4 py-6 sm:px-0">
      <h1 class="text-2xl font-semibold text-gray-900 mb-6">Dashboard</h1>

      <!-- Stats Cards -->
      <div id="stats-container"
           hx-get="/admin/api/stats"
           hx-trigger="load, every 60s"
           hx-swap="innerHTML">
        <div class="flex justify-center py-12">
          <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
        </div>
      </div>

      <!-- Quick Actions -->
      <div class="mt-8">
        <h2 class="text-lg font-medium text-gray-900 mb-4">Quick Actions</h2>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <a href="/admin/licenses" class="block p-4 bg-white rounded-lg shadow hover:shadow-md transition-shadow">
            <h3 class="font-medium text-indigo-600">Manage Licenses</h3>
            <p class="text-sm text-gray-500 mt-1">Grant or search licenses</p>
          </a>
          <a href="/admin/subscriptions" class="block p-4 bg-white rounded-lg shadow hover:shadow-md transition-shadow">
            <h3 class="font-medium text-indigo-600">View Subscriptions</h3>
            <p class="text-sm text-gray-500 mt-1">Monitor active subscriptions</p>
          </a>
          <div class="p-4 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
            <h3 class="font-medium text-gray-400">More Actions</h3>
            <p class="text-sm text-gray-400 mt-1">Coming soon...</p>
          </div>
        </div>
      </div>
    </div>
  </main>`;

  return baseLayout('Dashboard', content);
}

/**
 * Stats fragment for htmx response
 */
export function statsFragment(stats: {
  stripe: { active: number; canceled: number; pastDue: number };
  crypto: { active: number; cancelled: number; pending: number; pastDue: number };
  totalActive: number;
  estimatedMonthlyRevenue: number;
}): string {
  // Calculate revenue breakdown (using known prices)
  const stripeMonthlyUsd = 5;
  const cryptoMonthlyUsd = 4;
  const stripeRevenue = stats.stripe.active * stripeMonthlyUsd;
  const cryptoRevenue = stats.crypto.active * cryptoMonthlyUsd;

  return `
  <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
    <!-- Stripe Subscriptions -->
    <div class="bg-white overflow-hidden shadow rounded-lg">
      <div class="p-5">
        <div class="flex items-center">
          <div class="flex-shrink-0">
            <svg class="h-6 w-6 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"></path>
            </svg>
          </div>
          <div class="ml-5 w-0 flex-1">
            <dl>
              <dt class="text-sm font-medium text-gray-500 truncate">Stripe Active</dt>
              <dd class="text-3xl font-semibold text-gray-900">${stats.stripe.active}</dd>
            </dl>
          </div>
        </div>
      </div>
      <div class="bg-gray-50 px-5 py-3">
        <div class="text-sm text-gray-500">
          ${stats.stripe.canceled} cancelled
        </div>
      </div>
    </div>

    <!-- Crypto Subscriptions -->
    <div class="bg-white overflow-hidden shadow rounded-lg">
      <div class="p-5">
        <div class="flex items-center">
          <div class="flex-shrink-0">
            <svg class="h-6 w-6 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
            </svg>
          </div>
          <div class="ml-5 w-0 flex-1">
            <dl>
              <dt class="text-sm font-medium text-gray-500 truncate">Crypto Active</dt>
              <dd class="text-3xl font-semibold text-gray-900">${stats.crypto.active}</dd>
            </dl>
          </div>
        </div>
      </div>
      <div class="bg-gray-50 px-5 py-3">
        <div class="text-sm text-gray-500">
          ${stats.crypto.pending} pending, ${stats.crypto.pastDue} past due
        </div>
      </div>
    </div>

    <!-- Monthly Revenue -->
    <div class="bg-white overflow-hidden shadow rounded-lg">
      <div class="p-5">
        <div class="flex items-center">
          <div class="flex-shrink-0">
            <svg class="h-6 w-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
            </svg>
          </div>
          <div class="ml-5 w-0 flex-1">
            <dl>
              <dt class="text-sm font-medium text-gray-500 truncate">Monthly Revenue</dt>
              <dd class="text-3xl font-semibold text-gray-900">$${stats.estimatedMonthlyRevenue.toFixed(2)}</dd>
            </dl>
          </div>
        </div>
      </div>
      <div class="bg-gray-50 px-5 py-3">
        <div class="text-sm text-gray-500">
          Stripe: $${stripeRevenue.toFixed(2)} | Crypto: $${cryptoRevenue.toFixed(2)}
        </div>
      </div>
    </div>
  </div>`;
}

/**
 * Licenses page HTML
 */
export function licensesPage(): string {
  const content = `
  ${navHeader('licenses')}

  <main class="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
    <div class="px-4 py-6 sm:px-0">
      <h1 class="text-2xl font-semibold text-gray-900 mb-6">License Management</h1>

      <!-- Grant License Form -->
      <div class="bg-white shadow rounded-lg p-6 mb-6">
        <h2 class="text-lg font-medium text-gray-900 mb-4">Grant License</h2>
        <form id="grant-form" class="space-y-4">
          <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label for="grant-account" class="block text-sm font-medium text-gray-700">
                NEAR Account ID
              </label>
              <input type="text" id="grant-account" name="nearAccountId" required
                class="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                placeholder="username.near">
            </div>
            <div>
              <label for="grant-duration" class="block text-sm font-medium text-gray-700">
                Duration
              </label>
              <select id="grant-duration" name="durationDays"
                class="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm">
                <option value="30">30 days</option>
                <option value="90">90 days</option>
                <option value="180">180 days</option>
                <option value="365">365 days</option>
              </select>
            </div>
            <div class="flex items-end">
              <button type="submit"
                class="w-full px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500">
                Grant License
              </button>
            </div>
          </div>
        </form>
        <div id="grant-result" class="mt-4"></div>
      </div>

      <!-- Search Licenses -->
      <div class="bg-white shadow rounded-lg p-6">
        <h2 class="text-lg font-medium text-gray-900 mb-4">Search Licenses</h2>
        <div class="mb-4">
          <input type="text" id="search-input"
            class="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
            placeholder="Search by NEAR account ID..."
            hx-get="/admin/api/licenses"
            hx-trigger="keyup changed delay:300ms"
            hx-target="#licenses-results"
            hx-include="this"
            name="search">
        </div>

        <div id="licenses-results"
             hx-get="/admin/api/licenses"
             hx-trigger="load"
             hx-swap="innerHTML">
          <div class="flex justify-center py-12">
            <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
          </div>
        </div>
      </div>
    </div>
  </main>

  <script>
    document.getElementById('grant-form').addEventListener('submit', async function(e) {
      e.preventDefault();

      const nearAccountId = document.getElementById('grant-account').value.trim();
      const durationDays = parseInt(document.getElementById('grant-duration').value, 10);
      const resultDiv = document.getElementById('grant-result');

      const token = localStorage.getItem('specflow_admin_token');
      if (!token) {
        window.location.href = '/admin/login';
        return;
      }

      try {
        const response = await fetch('/admin/api/licenses/grant', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + token
          },
          body: JSON.stringify({ nearAccountId, durationDays })
        });

        const data = await response.json();

        if (data.success) {
          resultDiv.innerHTML = '<div class="bg-green-50 border border-green-200 rounded-md p-4"><p class="text-sm text-green-700">License granted to <strong>' + data.nearAccountId + '</strong> until ' + new Date(data.expiry).toLocaleDateString() + '</p><p class="text-xs text-green-600 mt-1">TX: ' + data.txHash + '</p></div>';
          document.getElementById('grant-account').value = '';
          // Refresh search results
          htmx.trigger('#licenses-results', 'htmx:load');
        } else {
          resultDiv.innerHTML = '<div class="bg-red-50 border border-red-200 rounded-md p-4"><p class="text-sm text-red-700">' + (data.error || 'Failed to grant license') + '</p></div>';
        }
      } catch (err) {
        resultDiv.innerHTML = '<div class="bg-red-50 border border-red-200 rounded-md p-4"><p class="text-sm text-red-700">Error: ' + err.message + '</p></div>';
      }
    });
  </script>`;

  return baseLayout('Licenses', content);
}

/**
 * Licenses search results fragment
 */
export function licensesFragment(licenses: Array<{
  nearAccountId: string;
  source: 'stripe' | 'crypto';
  subscriptionStatus: string;
  currentPeriodEnd?: number;
  nextChargeDate?: string;
  contractLicense?: {
    isLicensed: boolean;
    expiry: string | null;
  };
}>): string {
  if (licenses.length === 0) {
    return `
    <div class="text-center py-8 text-gray-500">
      No licenses found. Try a different search term.
    </div>`;
  }

  const rows = licenses
    .map((lic) => {
      const expiryDate = lic.contractLicense?.expiry
        ? new Date(lic.contractLicense.expiry).toLocaleDateString()
        : 'N/A';
      const status = lic.contractLicense?.isLicensed
        ? '<span class="px-2 py-1 text-xs font-medium rounded-full bg-green-100 text-green-800">Active</span>'
        : '<span class="px-2 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-800">Expired</span>';
      const sourceLabel =
        lic.source === 'stripe'
          ? '<span class="px-2 py-1 text-xs font-medium rounded-full bg-indigo-100 text-indigo-800">Stripe</span>'
          : '<span class="px-2 py-1 text-xs font-medium rounded-full bg-yellow-100 text-yellow-800">Crypto</span>';

      return `
      <tr class="hover:bg-gray-50">
        <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${lic.nearAccountId}</td>
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${expiryDate}</td>
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${sourceLabel}</td>
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${status}</td>
      </tr>`;
    })
    .join('');

  return `
  <div class="overflow-x-auto">
    <table class="min-w-full divide-y divide-gray-200">
      <thead class="bg-gray-50">
        <tr>
          <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Account</th>
          <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Expiry</th>
          <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Source</th>
          <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
        </tr>
      </thead>
      <tbody class="bg-white divide-y divide-gray-200">
        ${rows}
      </tbody>
    </table>
  </div>
  <div class="mt-4 text-sm text-gray-500">
    Showing ${licenses.length} license(s)
  </div>`;
}

/**
 * Subscriptions page HTML
 */
export function subscriptionsPage(): string {
  const content = `
  ${navHeader('subscriptions')}

  <main class="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
    <div class="px-4 py-6 sm:px-0">
      <h1 class="text-2xl font-semibold text-gray-900 mb-6">Subscription Management</h1>

      <!-- Filter Tabs -->
      <div class="border-b border-gray-200 mb-6">
        <nav class="-mb-px flex space-x-8" aria-label="Tabs">
          <button id="tab-all" class="tab-btn border-indigo-500 text-indigo-600 whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm" data-filter="all">
            All
          </button>
          <button id="tab-stripe" class="tab-btn border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm" data-filter="stripe">
            Stripe
          </button>
          <button id="tab-crypto" class="tab-btn border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm" data-filter="crypto">
            Crypto
          </button>
        </nav>
      </div>

      <!-- Subscriptions Table -->
      <div class="bg-white shadow rounded-lg overflow-hidden">
        <div id="subscriptions-results"
             hx-get="/admin/api/subscriptions"
             hx-trigger="load"
             hx-swap="innerHTML">
          <div class="flex justify-center py-12">
            <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
          </div>
        </div>
      </div>
    </div>
  </main>

  <script>
    // Tab filtering
    let currentFilter = 'all';

    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', function() {
        // Update active tab styling
        document.querySelectorAll('.tab-btn').forEach(b => {
          b.classList.remove('border-indigo-500', 'text-indigo-600');
          b.classList.add('border-transparent', 'text-gray-500');
        });
        this.classList.remove('border-transparent', 'text-gray-500');
        this.classList.add('border-indigo-500', 'text-indigo-600');

        // Update filter and reload
        currentFilter = this.dataset.filter;
        const url = '/admin/api/subscriptions' + (currentFilter !== 'all' ? '?type=' + currentFilter : '');
        htmx.ajax('GET', url, {target: '#subscriptions-results'});
      });
    });

    // Cancel subscription handler
    window.cancelSubscription = async function(nearAccountId, type) {
      if (!confirm('Are you sure you want to cancel this subscription? The user will retain access until their current period ends.')) {
        return;
      }

      const token = localStorage.getItem('specflow_admin_token');
      if (!token) {
        window.location.href = '/admin/login';
        return;
      }

      try {
        const response = await fetch('/admin/api/subscriptions/cancel', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + token
          },
          body: JSON.stringify({ nearAccountId, type })
        });

        const data = await response.json();

        if (data.success) {
          alert('Subscription cancelled. Active until: ' + new Date(data.activeUntil).toLocaleDateString());
          // Refresh results
          const url = '/admin/api/subscriptions' + (currentFilter !== 'all' ? '?type=' + currentFilter : '');
          htmx.ajax('GET', url, {target: '#subscriptions-results'});
        } else {
          alert('Error: ' + (data.error || 'Failed to cancel subscription'));
        }
      } catch (err) {
        alert('Error: ' + err.message);
      }
    };
  </script>`;

  return baseLayout('Subscriptions', content);
}

/**
 * Subscriptions fragment for htmx response
 */
export function subscriptionsFragment(subscriptions: Array<{
  nearAccountId: string;
  type: 'stripe' | 'crypto';
  status: string;
  nextChargeDate: string | null;
}>): string {
  if (subscriptions.length === 0) {
    return `
    <div class="text-center py-8 text-gray-500">
      No subscriptions found.
    </div>`;
  }

  const rows = subscriptions
    .map((sub) => {
      const nextCharge = sub.nextChargeDate
        ? new Date(sub.nextChargeDate).toLocaleDateString()
        : 'N/A';
      const typeLabel =
        sub.type === 'stripe'
          ? '<span class="px-2 py-1 text-xs font-medium rounded-full bg-indigo-100 text-indigo-800">Stripe</span>'
          : '<span class="px-2 py-1 text-xs font-medium rounded-full bg-yellow-100 text-yellow-800">Crypto</span>';

      let statusLabel: string;
      switch (sub.status) {
        case 'active':
          statusLabel =
            '<span class="px-2 py-1 text-xs font-medium rounded-full bg-green-100 text-green-800">Active</span>';
          break;
        case 'cancelled':
        case 'canceled':
          statusLabel =
            '<span class="px-2 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-800">Cancelled</span>';
          break;
        case 'past_due':
          statusLabel =
            '<span class="px-2 py-1 text-xs font-medium rounded-full bg-red-100 text-red-800">Past Due</span>';
          break;
        case 'pending':
          statusLabel =
            '<span class="px-2 py-1 text-xs font-medium rounded-full bg-yellow-100 text-yellow-800">Pending</span>';
          break;
        default:
          statusLabel =
            '<span class="px-2 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-800">' +
            sub.status +
            '</span>';
      }

      const canCancel = sub.status === 'active';
      const cancelBtn = canCancel
        ? `<button onclick="cancelSubscription('${sub.nearAccountId}', '${sub.type}')" class="text-red-600 hover:text-red-900 text-sm">Cancel</button>`
        : '<span class="text-gray-400 text-sm">-</span>';

      return `
      <tr class="hover:bg-gray-50">
        <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${sub.nearAccountId}</td>
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${typeLabel}</td>
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${statusLabel}</td>
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${nextCharge}</td>
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${cancelBtn}</td>
      </tr>`;
    })
    .join('');

  return `
  <table class="min-w-full divide-y divide-gray-200">
    <thead class="bg-gray-50">
      <tr>
        <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Account</th>
        <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
        <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
        <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Next Charge</th>
        <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
      </tr>
    </thead>
    <tbody class="bg-white divide-y divide-gray-200">
      ${rows}
    </tbody>
  </table>
  <div class="px-6 py-4 text-sm text-gray-500">
    Showing ${subscriptions.length} subscription(s)
  </div>`;
}

// ============================================================================
// Route Handlers
// ============================================================================

/**
 * GET /admin/login
 */
export function handleAdminLogin(c: Context<{ Bindings: Env }>): Response {
  return c.html(loginPage(c.env.NEAR_NETWORK));
}

/**
 * GET /admin/dashboard
 */
export function handleAdminDashboard(c: Context<{ Bindings: Env }>): Response {
  return c.html(dashboardPage());
}

/**
 * GET /admin/licenses (UI page)
 */
export function handleAdminLicensesPage(c: Context<{ Bindings: Env }>): Response {
  return c.html(licensesPage());
}

/**
 * GET /admin/subscriptions (UI page)
 */
export function handleAdminSubscriptionsPage(c: Context<{ Bindings: Env }>): Response {
  return c.html(subscriptionsPage());
}

/**
 * Redirect /admin to appropriate page based on auth
 */
export function handleAdminRoot(c: Context<{ Bindings: Env }>): Response {
  // Always redirect to login - client-side JS will redirect to dashboard if token exists
  return c.redirect('/admin/login');
}

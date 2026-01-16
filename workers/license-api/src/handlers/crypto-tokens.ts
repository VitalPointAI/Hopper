/**
 * Crypto Token Endpoints
 * Provides token list, wallet balances, and quote functionality for payment page
 */

import type { Context } from 'hono';
import { OneClickService, OpenAPI, QuoteRequest, TokenResponse } from '@defuse-protocol/one-click-sdk-typescript';
import type { Env } from '../types';
import { getCryptoSubscriptionByIntentId, saveCryptoSubscription } from '../services/crypto-subscription-store';

// USDC on NEAR for settlement
const USDC_NEAR_ASSET_ID = 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1';

/**
 * Configure the 1Click API
 */
function configureApi(env: Env): void {
  OpenAPI.BASE = env.NEAR_INTENTS_API_URL;
  if (env.NEAR_INTENTS_API_KEY) {
    OpenAPI.TOKEN = env.NEAR_INTENTS_API_KEY;
  }
}

/**
 * Token info for frontend display
 */
export interface PaymentToken {
  assetId: string;
  symbol: string;
  name: string;
  decimals: number;
  blockchain: string;
  priceUsd: number;
  iconUrl?: string;
}

/**
 * Token with user's balance
 */
export interface WalletToken extends PaymentToken {
  balance: string;
  balanceFormatted: string;
  balanceUsd: number;
  requiredAmount?: string;
  requiredAmountFormatted?: string;
  hasSufficientBalance: boolean;
  contractAddress?: string; // For ERC-20/NEP-141 tokens
}

/**
 * GET /api/crypto/tokens
 * Returns list of supported tokens for payment
 */
export async function handleGetTokens(c: Context<{ Bindings: Env }>): Promise<Response> {
  configureApi(c.env);

  try {
    const tokens = await OneClickService.getTokens();

    // Filter to popular tokens and format for frontend
    const popularSymbols = ['USDC', 'USDT', 'ETH', 'WETH', 'NEAR', 'WNEAR', 'DAI', 'WBTC', 'SOL'];

    const paymentTokens: PaymentToken[] = tokens
      .filter((t: TokenResponse) => popularSymbols.includes(t.symbol.toUpperCase()))
      .map((t: TokenResponse) => ({
        assetId: t.assetId,
        symbol: t.symbol,
        name: getTokenName(t.symbol, t.blockchain),
        decimals: t.decimals,
        blockchain: t.blockchain,
        priceUsd: t.price,
        iconUrl: getTokenIconUrl(t.symbol),
      }))
      // Sort by blockchain relevance (NEAR first, then popular chains)
      .sort((a, b) => {
        const chainOrder = ['near', 'base', 'eth', 'arb', 'sol'];
        const aOrder = chainOrder.indexOf(a.blockchain);
        const bOrder = chainOrder.indexOf(b.blockchain);
        if (aOrder !== bOrder) return (aOrder === -1 ? 999 : aOrder) - (bOrder === -1 ? 999 : bOrder);
        // Then by symbol
        return a.symbol.localeCompare(b.symbol);
      });

    return c.json({ tokens: paymentTokens });
  } catch (error) {
    console.error('[tokens] Error fetching tokens:', error);
    return c.json({ error: 'Failed to fetch tokens' }, 500);
  }
}

/**
 * POST /api/crypto/quote
 * Get a quote for paying with a specific token
 *
 * Request body:
 * - originAsset: The token asset ID to pay with
 * - amountUsd: The USD amount to pay (e.g., "4.00")
 * - nearAccountId: The user's NEAR account for refunds
 */
export async function handleGetQuote(c: Context<{ Bindings: Env }>): Promise<Response> {
  configureApi(c.env);

  const body = await c.req.json<{
    originAsset: string;
    amountUsd: string;
    nearAccountId: string;
  }>();

  if (!body.originAsset || !body.amountUsd || !body.nearAccountId) {
    return c.json({ error: 'Missing required fields: originAsset, amountUsd, nearAccountId' }, 400);
  }

  try {
    // Convert USD to USDC amount (6 decimals)
    const usdcAmount = Math.floor(parseFloat(body.amountUsd) * 1_000_000).toString();

    // Set deadline 10 minutes from now
    const deadline = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    // Request quote with EXACT_OUTPUT to get how much of origin token is needed
    const quoteRequest: QuoteRequest = {
      dry: true, // Just get pricing, don't create deposit address yet
      swapType: QuoteRequest.swapType.EXACT_OUTPUT,
      slippageTolerance: 100, // 1%
      originAsset: body.originAsset,
      depositType: QuoteRequest.depositType.ORIGIN_CHAIN,
      destinationAsset: USDC_NEAR_ASSET_ID,
      amount: usdcAmount,
      refundTo: body.nearAccountId,
      refundType: QuoteRequest.refundType.ORIGIN_CHAIN,
      recipient: c.env.SETTLEMENT_ACCOUNT,
      recipientType: QuoteRequest.recipientType.DESTINATION_CHAIN, // Send directly to wallet
      deadline,
      referral: 'specflow',
    };

    const quoteResponse = await OneClickService.getQuote(quoteRequest);

    return c.json({
      quote: {
        originAsset: body.originAsset,
        amountIn: quoteResponse.quote.amountIn,
        amountInFormatted: quoteResponse.quote.amountInFormatted,
        amountInUsd: quoteResponse.quote.amountInUsd,
        amountOut: quoteResponse.quote.amountOut,
        amountOutFormatted: quoteResponse.quote.amountOutFormatted,
        amountOutUsd: quoteResponse.quote.amountOutUsd,
        minAmountOut: quoteResponse.quote.minAmountOut,
        timeEstimate: quoteResponse.quote.timeEstimate,
      },
    });
  } catch (error) {
    console.error('[quote] Error getting quote:', error);
    return c.json({ error: 'Failed to get quote' }, 500);
  }
}

/**
 * POST /api/crypto/payment-quote
 * Create an actual payment quote with deposit address
 * Called when user confirms payment with selected token
 *
 * Body:
 * - originAsset: Token asset ID (e.g., nep141:... or erc20:eth:0x...)
 * - amountUsd: Amount in USD (e.g., "4.00")
 * - refundAddress: Wallet address for refunds (NEAR account or EVM address)
 * - chain: Optional chain identifier (near, eth, base, etc.)
 * - intentId: Optional subscription intent ID to update with deposit address
 */
export async function handleCreatePaymentQuote(c: Context<{ Bindings: Env }>): Promise<Response> {
  configureApi(c.env);

  const body = await c.req.json<{
    originAsset: string;
    amountUsd: string;
    nearAccountId?: string; // Legacy - use refundAddress
    refundAddress?: string;
    chain?: string;
    intentId?: string; // Subscription intent ID to update
  }>();

  const refundAddress = body.refundAddress || body.nearAccountId;

  if (!body.originAsset || !body.amountUsd || !refundAddress) {
    return c.json({ error: 'Missing required fields: originAsset, amountUsd, refundAddress' }, 400);
  }

  try {
    // Check if this is native NEAR (which needs to be treated as wNEAR for 1Click)
    const isNativeNear = body.originAsset === 'near:native';

    // Determine if this is a NEAR chain token based on the chain parameter
    // Note: Even ETH tokens have nep141: prefix in the 1Click API (bridged via OMFT)
    // We use the chain parameter to know where the user is actually paying from
    const isNearChain = body.chain === 'near' || isNativeNear || (!body.chain && body.originAsset.startsWith('nep141:') && !body.originAsset.includes('.omft.near'));
    const isNearToken = isNearChain;

    // For native NEAR, use wNEAR's assetId since 1Click doesn't support native NEAR directly
    // The frontend will handle wrapping NEAR to wNEAR before the transfer
    const quoteAssetId = isNativeNear ? 'nep141:wrap.near' : body.originAsset;

    // Convert USD to USDC amount (6 decimals)
    const usdcAmount = Math.floor(parseFloat(body.amountUsd) * 1_000_000).toString();

    // Set deadline 30 minutes from now for actual payment
    const deadline = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    // Create real quote with deposit address
    // Always use ORIGIN_CHAIN deposit type - this gives us a real implicit account address
    // that we can transfer tokens to directly via ft_transfer
    // Using INTENTS requires ft_transfer_call to intents.near which is more complex
    const quoteRequest: QuoteRequest = {
      dry: false, // Create real deposit address
      swapType: QuoteRequest.swapType.EXACT_OUTPUT,
      slippageTolerance: 100,
      originAsset: quoteAssetId, // Use wNEAR for native NEAR
      depositType: QuoteRequest.depositType.ORIGIN_CHAIN, // Always ORIGIN_CHAIN for simpler ft_transfer
      destinationAsset: USDC_NEAR_ASSET_ID,
      amount: usdcAmount,
      refundTo: refundAddress,
      refundType: QuoteRequest.refundType.ORIGIN_CHAIN, // Refund to the same address on origin chain
      recipient: c.env.SETTLEMENT_ACCOUNT, // USDC goes to settlement account
      recipientType: QuoteRequest.recipientType.DESTINATION_CHAIN, // Send directly to wallet, not intents contract
      deadline,
      referral: 'specflow',
    };

    console.log('[payment-quote] Creating quote:', {
      originAsset: body.originAsset,
      isNearToken,
      depositType: quoteRequest.depositType,
      refundAddress,
      settlementAccount: c.env.SETTLEMENT_ACCOUNT,
      destinationAsset: USDC_NEAR_ASSET_ID,
    });

    const quoteResponse = await OneClickService.getQuote(quoteRequest);

    if (!quoteResponse.quote.depositAddress) {
      throw new Error('Failed to get deposit address');
    }

    // CRITICAL: Verify the quote response confirms our recipient and destination
    // The 1Click API echoes back our request - verify it's correct
    const echoedRecipient = quoteResponse.quoteRequest?.recipient;
    const echoedDestAsset = quoteResponse.quoteRequest?.destinationAsset;

    console.log('[payment-quote] Quote verification:', {
      depositAddress: quoteResponse.quote.depositAddress,
      echoedRecipient,
      expectedRecipient: c.env.SETTLEMENT_ACCOUNT,
      echoedDestAsset,
      expectedDestAsset: USDC_NEAR_ASSET_ID,
      amountOut: quoteResponse.quote.amountOut,
      amountOutUsd: quoteResponse.quote.amountOutUsd,
    });

    // Safety check: verify the recipient is our settlement account
    if (echoedRecipient && echoedRecipient !== c.env.SETTLEMENT_ACCOUNT) {
      console.error('[payment-quote] CRITICAL: Recipient mismatch!', {
        expected: c.env.SETTLEMENT_ACCOUNT,
        got: echoedRecipient,
      });
      throw new Error('Quote recipient verification failed');
    }

    // Safety check: verify destination is USDC on NEAR
    if (echoedDestAsset && echoedDestAsset !== USDC_NEAR_ASSET_ID) {
      console.error('[payment-quote] CRITICAL: Destination asset mismatch!', {
        expected: USDC_NEAR_ASSET_ID,
        got: echoedDestAsset,
      });
      throw new Error('Quote destination asset verification failed');
    }

    // CRITICAL: Store the actual deposit address in the subscription record
    // This is needed because the confirm endpoint needs to check payment status
    // on the actual deposit address, not the original intentId
    if (body.intentId) {
      try {
        const subscription = await getCryptoSubscriptionByIntentId(
          c.env.CRYPTO_SUBSCRIPTIONS,
          body.intentId
        );

        if (subscription) {
          subscription.paymentDepositAddress = quoteResponse.quote.depositAddress;
          subscription.updatedAt = new Date().toISOString();
          await saveCryptoSubscription(c.env.CRYPTO_SUBSCRIPTIONS, subscription);
          console.log('[payment-quote] Updated subscription with deposit address:', {
            intentId: body.intentId,
            paymentDepositAddress: quoteResponse.quote.depositAddress,
          });
        } else {
          console.warn('[payment-quote] No subscription found for intentId:', body.intentId);
        }
      } catch (err) {
        // Don't fail the quote if we can't update the subscription
        console.error('[payment-quote] Failed to update subscription with deposit address:', err);
      }
    }

    return c.json({
      quote: {
        depositAddress: quoteResponse.quote.depositAddress,
        depositMemo: quoteResponse.quote.depositMemo,
        originAsset: body.originAsset,
        amountIn: quoteResponse.quote.amountIn,
        amountInFormatted: quoteResponse.quote.amountInFormatted,
        amountInUsd: quoteResponse.quote.amountInUsd,
        amountOut: quoteResponse.quote.amountOut,
        amountOutFormatted: quoteResponse.quote.amountOutFormatted,
        deadline: quoteResponse.quote.deadline,
        timeEstimate: quoteResponse.quote.timeEstimate,
        isNativeNear, // Frontend needs to wrap NEAR to wNEAR before transferring
      },
      signature: quoteResponse.signature,
      correlationId: quoteResponse.correlationId,
    });
  } catch (error) {
    console.error('[payment-quote] Error creating payment quote:', error);
    return c.json({ error: 'Failed to create payment quote' }, 500);
  }
}

/**
 * Supported blockchain chains for balance lookups
 */
type SupportedChain = 'near' | 'eth' | 'base' | 'arb' | 'sol' | 'pol' | 'bsc' | 'avax' | 'op' | 'ton' | 'stellar' | 'tron';

/**
 * Chain RPC endpoints
 */
const CHAIN_RPC_URLS: Partial<Record<SupportedChain, string>> = {
  eth: 'https://eth.llamarpc.com',
  base: 'https://mainnet.base.org',
  arb: 'https://arb1.arbitrum.io/rpc',
  pol: 'https://polygon-rpc.com',
  bsc: 'https://bsc-dataseed.binance.org',
  avax: 'https://api.avax.network/ext/bc/C/rpc',
  op: 'https://mainnet.optimism.io',
  sol: 'https://api.mainnet-beta.solana.com',
  ton: 'https://toncenter.com/api/v2',
  stellar: 'https://horizon.stellar.org',
  tron: 'https://api.trongrid.io',
};

/**
 * GET /api/crypto/wallet-tokens
 * Get tokens the user actually has in their wallet with balances
 * Supports multiple chains - pass the wallet address and chain
 * Query: ?address=xxx&chain=eth&amountUsd=4.00
 * Legacy: ?nearAccountId=xxx (treated as NEAR chain)
 */
export async function handleGetWalletTokens(c: Context<{ Bindings: Env }>): Promise<Response> {
  // Support both new format (address + chain) and legacy (nearAccountId)
  const walletAddress = c.req.query('address') || c.req.query('nearAccountId');
  const chain = (c.req.query('chain') || 'near') as SupportedChain;
  const amountUsd = c.req.query('amountUsd') || c.env.CRYPTO_MONTHLY_USD;

  if (!walletAddress) {
    return c.json({ error: 'Missing address or nearAccountId parameter' }, 400);
  }

  configureApi(c.env);

  try {
    // Get all supported tokens from 1Click API
    const supportedTokens = await OneClickService.getTokens();

    // Filter to tokens on the user's chain
    const chainTokens = supportedTokens.filter(t => t.blockchain === chain);

    if (chainTokens.length === 0) {
      return c.json({
        tokens: [],
        walletAddress,
        chain,
        amountUsd,
        message: `No supported tokens for chain: ${chain}`,
      });
    }

    const walletTokens: WalletToken[] = [];
    const usdcAmount = Math.floor(parseFloat(amountUsd) * 1_000_000).toString();
    const deadline = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    if (chain === 'near') {
      // NEAR chain balance lookup
      await fetchNearTokens(c.env, walletAddress, chainTokens, supportedTokens, walletTokens, usdcAmount, deadline);
    } else if (chain === 'sol') {
      // Solana chain balance lookup
      await fetchSolanaTokens(walletAddress, chainTokens, walletTokens, usdcAmount, deadline, c.env);
    } else if (chain === 'ton') {
      // TON chain balance lookup
      await fetchTonTokens(walletAddress, chainTokens, walletTokens, usdcAmount, deadline, c.env);
    } else if (chain === 'stellar') {
      // Stellar chain balance lookup
      await fetchStellarTokens(walletAddress, chainTokens, walletTokens, usdcAmount, deadline, c.env);
    } else if (chain === 'tron') {
      // TRON chain balance lookup
      await fetchTronTokens(walletAddress, chainTokens, walletTokens, usdcAmount, deadline, c.env);
    } else {
      // EVM chain balance lookup (eth, base, arb, pol, etc.)
      await fetchEvmTokens(chain, walletAddress, chainTokens, walletTokens, usdcAmount, deadline, c.env);
    }

    // Sort: sufficient balance first, then by USD value
    walletTokens.sort((a, b) => {
      if (a.hasSufficientBalance !== b.hasSufficientBalance) {
        return a.hasSufficientBalance ? -1 : 1;
      }
      return b.balanceUsd - a.balanceUsd;
    });

    return c.json({
      tokens: walletTokens,
      walletAddress,
      chain,
      amountUsd,
    });
  } catch (error) {
    console.error('[wallet-tokens] Error:', error);
    return c.json({ error: 'Failed to fetch wallet tokens' }, 500);
  }
}

/**
 * Fetch NEAR chain tokens (native + NEP-141)
 */
async function fetchNearTokens(
  env: Env,
  nearAccountId: string,
  chainTokens: TokenResponse[],
  allTokens: TokenResponse[],
  walletTokens: WalletToken[],
  usdcAmount: string,
  deadline: string
): Promise<void> {
  // Create a map of supported NEAR tokens by contract ID
  const supportedNearTokens = new Map<string, TokenResponse>();
  for (const token of chainTokens) {
    if (token.assetId.startsWith('nep141:')) {
      const contractId = token.assetId.replace('nep141:', '');
      supportedNearTokens.set(contractId, token);
    }
  }

  // Get user's NEAR token balances from FastNEAR API
  const fastnearUrl = env.NEAR_NETWORK === 'testnet'
    ? 'https://test.api.fastnear.com'
    : 'https://api.fastnear.com';

  try {
    const balancesResponse = await fetch(`${fastnearUrl}/v1/account/${nearAccountId}/ft`, {
      headers: env.FASTNEAR_API_KEY ? { 'Authorization': `Bearer ${env.FASTNEAR_API_KEY}` } : {},
    });

    if (balancesResponse.ok) {
      const balancesData = await balancesResponse.json() as {
        account_id: string;
        tokens: Array<{
          contract_id: string;
          balance: string;
          last_update_block_height: number;
        }>;
      };

      for (const userToken of balancesData.tokens || []) {
        const supportedToken = supportedNearTokens.get(userToken.contract_id);
        if (!supportedToken || userToken.balance === '0') continue;

        const walletToken = await createWalletToken(
          supportedToken,
          userToken.balance,
          nearAccountId,
          usdcAmount,
          deadline,
          env
        );
        if (walletToken) walletTokens.push(walletToken);
      }
    }
  } catch (err) {
    console.error('[wallet-tokens] FastNEAR error:', err);
  }

  // Also check native NEAR balance
  // Native NEAR needs to be wrapped to wNEAR before sending to 1Click
  // We'll use wNEAR quote but show as "NEAR (Native)" and handle wrapping on payment
  try {
    // Find wNEAR token to get quote (since 1Click uses wNEAR, not native NEAR)
    const wNearToken = allTokens.find(t => t.symbol === 'wNEAR' && t.blockchain === 'near');

    if (wNearToken) {
      const rpcResponse = await fetch(env.NEAR_RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'near-balance',
          method: 'query',
          params: {
            request_type: 'view_account',
            finality: 'final',
            account_id: nearAccountId,
          },
        }),
      });

      const rpcData = await rpcResponse.json() as {
        result?: { amount: string };
        error?: { message: string };
      };

      if (rpcData.result?.amount) {
        // Create a "Native NEAR" token entry using wNEAR pricing/quote
        // The payment handler will wrap NEAR to wNEAR before sending
        const nativeNearToken: TokenResponse = {
          ...wNearToken,
          assetId: 'near:native', // Special marker for native NEAR
          symbol: 'NEAR',
        };

        const walletToken = await createWalletToken(
          nativeNearToken,
          rpcData.result.amount,
          nearAccountId,
          usdcAmount,
          deadline,
          env,
          true // isNative
        );

        if (walletToken) {
          // Override name to indicate it's native NEAR that will be auto-wrapped
          walletToken.name = 'NEAR (Native)';
          walletToken.assetId = 'near:native';
          walletTokens.unshift(walletToken);
        }
      }
    }
  } catch (err) {
    console.error('[wallet-tokens] NEAR balance error:', err);
  }
}

/**
 * Fetch EVM chain tokens (native + ERC-20)
 */
async function fetchEvmTokens(
  chain: SupportedChain,
  walletAddress: string,
  chainTokens: TokenResponse[],
  walletTokens: WalletToken[],
  usdcAmount: string,
  deadline: string,
  env: Env
): Promise<void> {
  const rpcUrl = CHAIN_RPC_URLS[chain];
  if (!rpcUrl) {
    console.error(`[wallet-tokens] No RPC URL for chain: ${chain}`);
    return;
  }

  // Find native token (ETH, MATIC, BNB, etc.)
  const nativeToken = chainTokens.find(t =>
    t.symbol === 'ETH' || t.symbol === 'MATIC' || t.symbol === 'BNB' ||
    t.symbol === 'AVAX' || (t.symbol === 'OP' && chain === 'op')
  );

  // Get native balance
  if (nativeToken) {
    try {
      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_getBalance',
          params: [walletAddress, 'latest'],
        }),
      });

      const data = await response.json() as { result?: string };
      if (data.result) {
        const balance = BigInt(data.result).toString();
        const walletToken = await createWalletToken(
          nativeToken,
          balance,
          walletAddress,
          usdcAmount,
          deadline,
          env,
          true
        );
        if (walletToken) walletTokens.push(walletToken);
      }
    } catch (err) {
      console.error(`[wallet-tokens] Native balance error for ${chain}:`, err);
    }
  }

  // Get ERC-20 balances
  const erc20Tokens = chainTokens.filter(t => t.contractAddress);

  for (const token of erc20Tokens) {
    try {
      // balanceOf(address) function selector: 0x70a08231
      const data = '0x70a08231' + walletAddress.slice(2).padStart(64, '0');

      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_call',
          params: [{ to: token.contractAddress, data }, 'latest'],
        }),
      });

      const result = await response.json() as { result?: string };
      if (result.result && result.result !== '0x' && result.result !== '0x0') {
        const balance = BigInt(result.result).toString();
        if (balance !== '0') {
          const walletToken = await createWalletToken(
            token,
            balance,
            walletAddress,
            usdcAmount,
            deadline,
            env
          );
          if (walletToken) walletTokens.push(walletToken);
        }
      }
    } catch (err) {
      console.error(`[wallet-tokens] ERC-20 balance error for ${token.symbol}:`, err);
    }
  }
}

/**
 * Fetch Solana chain tokens (native SOL + SPL tokens)
 */
async function fetchSolanaTokens(
  walletAddress: string,
  chainTokens: TokenResponse[],
  walletTokens: WalletToken[],
  usdcAmount: string,
  deadline: string,
  env: Env
): Promise<void> {
  const rpcUrl = CHAIN_RPC_URLS.sol;
  if (!rpcUrl) return;

  // Find native SOL token
  const solToken = chainTokens.find(t => t.symbol === 'SOL');

  // Get native SOL balance
  if (solToken) {
    try {
      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getBalance',
          params: [walletAddress],
        }),
      });

      const data = await response.json() as { result?: { value: number } };
      if (data.result?.value) {
        const balance = data.result.value.toString();
        const walletToken = await createWalletToken(
          solToken,
          balance,
          walletAddress,
          usdcAmount,
          deadline,
          env,
          true
        );
        if (walletToken) walletTokens.push(walletToken);
      }
    } catch (err) {
      console.error('[wallet-tokens] Solana balance error:', err);
    }
  }

  // Get SPL token balances
  // This requires additional RPC calls for each token account
  // For now, we'll focus on native SOL - SPL token support can be added later
}

/**
 * Fetch TON chain tokens (native TON + Jettons)
 */
async function fetchTonTokens(
  walletAddress: string,
  chainTokens: TokenResponse[],
  walletTokens: WalletToken[],
  usdcAmount: string,
  deadline: string,
  env: Env
): Promise<void> {
  const rpcUrl = CHAIN_RPC_URLS.ton;
  if (!rpcUrl) return;

  // Find native TON token
  const tonToken = chainTokens.find(t => t.symbol === 'TON');

  // Get native TON balance
  if (tonToken) {
    try {
      const response = await fetch(`${rpcUrl}/getAddressBalance?address=${walletAddress}`);
      const data = await response.json() as { ok: boolean; result?: string };

      if (data.ok && data.result) {
        const balance = data.result; // Balance in nanotons
        const walletToken = await createWalletToken(
          tonToken,
          balance,
          walletAddress,
          usdcAmount,
          deadline,
          env,
          true
        );
        if (walletToken) walletTokens.push(walletToken);
      }
    } catch (err) {
      console.error('[wallet-tokens] TON balance error:', err);
    }
  }

  // Jetton (TON token standard) balances require separate API calls
  // Can be added later for USDT on TON, etc.
}

/**
 * Fetch Stellar chain tokens (native XLM + Stellar assets)
 */
async function fetchStellarTokens(
  walletAddress: string,
  chainTokens: TokenResponse[],
  walletTokens: WalletToken[],
  usdcAmount: string,
  deadline: string,
  env: Env
): Promise<void> {
  const rpcUrl = CHAIN_RPC_URLS.stellar;
  if (!rpcUrl) return;

  try {
    // Fetch account info from Horizon API
    const response = await fetch(`${rpcUrl}/accounts/${walletAddress}`);

    if (!response.ok) {
      if (response.status === 404) {
        // Account doesn't exist or isn't funded
        console.log('[wallet-tokens] Stellar account not found or not funded');
        return;
      }
      throw new Error(`Stellar API error: ${response.status}`);
    }

    const data = await response.json() as {
      balances: Array<{
        asset_type: string;
        asset_code?: string;
        asset_issuer?: string;
        balance: string;
      }>;
    };

    for (const balance of data.balances || []) {
      // Find matching token
      let matchingToken: TokenResponse | undefined;

      if (balance.asset_type === 'native') {
        matchingToken = chainTokens.find(t => t.symbol === 'XLM');
      } else if (balance.asset_code) {
        matchingToken = chainTokens.find(
          t => t.symbol === balance.asset_code
        );
      }

      if (matchingToken && parseFloat(balance.balance) > 0) {
        // Stellar balances are in stroops (1 XLM = 10^7 stroops) but returned as decimal strings
        // Convert to base units
        const balanceInStroops = Math.floor(parseFloat(balance.balance) * 10_000_000).toString();

        const walletToken = await createWalletToken(
          matchingToken,
          balanceInStroops,
          walletAddress,
          usdcAmount,
          deadline,
          env,
          balance.asset_type === 'native'
        );
        if (walletToken) walletTokens.push(walletToken);
      }
    }
  } catch (err) {
    console.error('[wallet-tokens] Stellar balance error:', err);
  }
}

/**
 * Fetch TRON chain tokens (native TRX + TRC-20)
 */
async function fetchTronTokens(
  walletAddress: string,
  chainTokens: TokenResponse[],
  walletTokens: WalletToken[],
  usdcAmount: string,
  deadline: string,
  env: Env
): Promise<void> {
  const rpcUrl = CHAIN_RPC_URLS.tron;
  if (!rpcUrl) return;

  // Find native TRX token
  const trxToken = chainTokens.find(t => t.symbol === 'TRX');

  // Get native TRX balance
  if (trxToken) {
    try {
      const response = await fetch(`${rpcUrl}/v1/accounts/${walletAddress}`);
      const data = await response.json() as {
        data?: Array<{
          balance?: number;
          trc20?: Array<Record<string, string>>;
        }>;
      };

      if (data.data?.[0]?.balance) {
        const balance = data.data[0].balance.toString(); // Balance in SUN (1 TRX = 10^6 SUN)
        const walletToken = await createWalletToken(
          trxToken,
          balance,
          walletAddress,
          usdcAmount,
          deadline,
          env,
          true
        );
        if (walletToken) walletTokens.push(walletToken);
      }

      // Get TRC-20 token balances
      const trc20Balances = data.data?.[0]?.trc20 || [];
      for (const tokenBalance of trc20Balances) {
        // Each entry is { contractAddress: balance }
        const [contractAddress, balance] = Object.entries(tokenBalance)[0] || [];

        if (contractAddress && balance && balance !== '0') {
          // Find matching token by contract address
          const matchingToken = chainTokens.find(
            t => t.contractAddress?.toLowerCase() === contractAddress.toLowerCase()
          );

          if (matchingToken) {
            const walletToken = await createWalletToken(
              matchingToken,
              balance,
              walletAddress,
              usdcAmount,
              deadline,
              env
            );
            if (walletToken) walletTokens.push(walletToken);
          }
        }
      }
    } catch (err) {
      console.error('[wallet-tokens] TRON balance error:', err);
    }
  }
}

/**
 * Create a WalletToken with quote and balance info
 */
async function createWalletToken(
  token: TokenResponse,
  balance: string,
  refundAddress: string,
  usdcAmount: string,
  deadline: string,
  env: Env,
  isNative = false
): Promise<WalletToken | null> {
  const balanceNum = BigInt(balance);
  const decimals = token.decimals;

  // For tokens with more than 18 decimals (like NEAR with 24), we need to handle carefully
  // to avoid JavaScript number precision issues
  let balanceFormatted: string;
  let balanceUsd: number;

  if (decimals > 18) {
    // For high decimal tokens, divide in steps to maintain precision
    const scaleFactor = BigInt(10 ** 18);
    const remainingDecimals = decimals - 18;
    const scaledBalance = balanceNum / scaleFactor;
    const divisor = 10 ** remainingDecimals;
    balanceFormatted = (Number(scaledBalance) / divisor).toFixed(6);
  } else {
    const divisor = 10 ** decimals;
    balanceFormatted = (Number(balanceNum) / divisor).toFixed(Math.min(decimals, 6));
  }

  balanceUsd = parseFloat(balanceFormatted) * token.price;

  try {
    // For native NEAR, we use wNEAR's assetId since 1Click doesn't support native NEAR
    // The payment flow will handle wrapping NEAR to wNEAR
    const quoteAssetId = token.assetId === 'near:native' ? 'nep141:wrap.near' : token.assetId;

    // Always use ORIGIN_CHAIN deposit type - consistent with payment-quote endpoint
    // This ensures we get a real implicit account address for ft_transfer
    const quoteRequest: QuoteRequest = {
      dry: true,
      swapType: QuoteRequest.swapType.EXACT_OUTPUT,
      slippageTolerance: 100,
      originAsset: quoteAssetId,
      depositType: QuoteRequest.depositType.ORIGIN_CHAIN, // Always ORIGIN_CHAIN
      destinationAsset: USDC_NEAR_ASSET_ID,
      amount: usdcAmount,
      refundTo: refundAddress,
      refundType: QuoteRequest.refundType.ORIGIN_CHAIN, // Consistent with payment-quote
      recipient: env.SETTLEMENT_ACCOUNT,
      recipientType: QuoteRequest.recipientType.DESTINATION_CHAIN, // Send directly to wallet
      deadline,
      referral: 'specflow',
    };

    const quoteResponse = await OneClickService.getQuote(quoteRequest);
    const requiredBigInt = BigInt(quoteResponse.quote.amountIn);

    return {
      assetId: token.assetId,
      symbol: token.symbol,
      name: isNative ? `${token.symbol} (Native)` : getTokenName(token.symbol, token.blockchain),
      decimals: token.decimals,
      blockchain: token.blockchain,
      priceUsd: token.price,
      iconUrl: getTokenIconUrl(token.symbol),
      balance,
      balanceFormatted,
      balanceUsd,
      requiredAmount: quoteResponse.quote.amountIn,
      requiredAmountFormatted: quoteResponse.quote.amountInFormatted,
      hasSufficientBalance: balanceNum >= requiredBigInt,
      contractAddress: token.contractAddress, // Pass through for ERC-20/NEP-141 transfers
    };
  } catch (err) {
    console.error(`[wallet-tokens] Quote error for ${token.symbol}:`, err);
    return null;
  }
}

/**
 * Get human-readable token name
 */
function getTokenName(symbol: string, blockchain: string): string {
  const chainNames: Record<string, string> = {
    near: 'NEAR',
    eth: 'Ethereum',
    base: 'Base',
    arb: 'Arbitrum',
    sol: 'Solana',
    btc: 'Bitcoin',
    pol: 'Polygon',
  };

  const chainName = chainNames[blockchain] || blockchain.toUpperCase();
  return `${symbol} on ${chainName}`;
}

/**
 * Get token icon URL (using common token icon CDNs)
 */
function getTokenIconUrl(symbol: string): string {
  // Use a common token icon service
  const symbolLower = symbol.toLowerCase();
  return `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/${getTokenAddress(symbol)}/logo.png`;
}

/**
 * Get common token contract addresses for icons
 */
function getTokenAddress(symbol: string): string {
  const addresses: Record<string, string> = {
    USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    ETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
    WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    DAI: '0x6B175474E89094C44Da98b954EescdeCB5BE3830',
    WBTC: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
  };
  return addresses[symbol.toUpperCase()] || '';
}

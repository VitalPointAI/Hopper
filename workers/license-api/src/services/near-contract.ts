/**
 * NEAR contract integration using @near-js libraries
 * Handles transaction creation, signing, and broadcasting
 */

import { KeyPair, KeyType } from '@near-js/crypto';
import {
  actionCreators,
  createTransaction,
  SignedTransaction,
  Signature,
} from '@near-js/transactions';
import type { Env } from '../types';

// NEAR RPC endpoints (FastNEAR for production)
const MAINNET_RPC = 'https://rpc.mainnet.fastnear.com';
const TESTNET_RPC = 'https://rpc.testnet.fastnear.com';

// Gas and deposit constants
const DEFAULT_GAS = BigInt('30000000000000'); // 30 TGas

/**
 * Get RPC URL based on network
 */
function getRpcUrl(env: Env): string {
  if (env.NEAR_RPC_URL) {
    return env.NEAR_RPC_URL;
  }
  return env.NEAR_NETWORK === 'testnet' ? TESTNET_RPC : MAINNET_RPC;
}

/**
 * Make a NEAR RPC call with FastNEAR API key authentication
 */
async function rpcCall<T>(
  rpcUrl: string,
  method: string,
  params: unknown,
  apiKey?: string
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  // Add FastNEAR API key as Bearer token if provided
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'dontcare',
      method,
      params,
    }),
  });

  const data = (await response.json()) as {
    result?: T;
    error?: { message: string; data?: unknown };
  };

  if (data.error) {
    throw new Error(`NEAR RPC error: ${data.error.message}`);
  }

  return data.result as T;
}

/**
 * Get access key for an account
 */
interface AccessKeyInfo {
  nonce: number;
  block_hash: string;
}

async function getAccessKey(
  rpcUrl: string,
  accountId: string,
  publicKey: string,
  apiKey?: string
): Promise<AccessKeyInfo> {
  const result = await rpcCall<{ nonce: number; block_hash: string }>(
    rpcUrl,
    'query',
    {
      request_type: 'view_access_key',
      finality: 'final',
      account_id: accountId,
      public_key: publicKey,
    },
    apiKey
  );

  return result;
}

/**
 * Base58 alphabet for NEAR
 */
const BASE58_ALPHABET =
  '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * Decode base58 string to Uint8Array
 */
function base58Decode(str: string): Uint8Array {
  const bytes: number[] = [];

  for (const c of str) {
    let carry = BASE58_ALPHABET.indexOf(c);
    if (carry < 0) {
      throw new Error(`Invalid base58 character: ${c}`);
    }

    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }

    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  // Handle leading zeros
  for (const c of str) {
    if (c === '1') {
      bytes.push(0);
    } else {
      break;
    }
  }

  return new Uint8Array(bytes.reverse());
}

/**
 * SHA-256 hash
 */
async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return new Uint8Array(hashBuffer);
}

/**
 * Grant license on NEAR contract
 * Calls contract.grant_license(wallet_address, duration_days)
 * Supports any wallet address string (NEAR accounts, EVM addresses, Solana pubkeys, etc.)
 */
export async function grantLicense(
  env: Env,
  walletAddress: string,
  durationDays: number
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  try {
    const rpcUrl = getRpcUrl(env);
    const contractId = env.LICENSE_CONTRACT_ID;
    const apiKey = env.FASTNEAR_API_KEY;

    // Parse the private key (cast to expected type)
    const keyPair = KeyPair.fromString(env.NEAR_PRIVATE_KEY as `ed25519:${string}`);
    const publicKey = keyPair.getPublicKey();
    const publicKeyStr = publicKey.toString();

    // The signer account is the admin account (specflow.near), not the contract itself
    // The contract checks predecessor_account_id == admin
    const signerId = env.ADMIN_WALLET;

    // Get access key info (nonce and recent block hash)
    const accessKeyInfo = await getAccessKey(
      rpcUrl,
      signerId,
      publicKeyStr,
      apiKey
    );
    const nonce = BigInt(accessKeyInfo.nonce) + 1n;
    const blockHash = base58Decode(accessKeyInfo.block_hash);

    // Prepare the function call arguments
    // Contract now accepts any wallet address string
    const args = JSON.stringify({
      wallet_address: walletAddress,
      duration_days: durationDays,
    });

    // Create the function call action
    const actions = [
      actionCreators.functionCall(
        'grant_license',
        new TextEncoder().encode(args),
        DEFAULT_GAS,
        BigInt(0)
      ),
    ];

    // Create the transaction
    const transaction = createTransaction(
      signerId,
      publicKey,
      contractId,
      nonce,
      actions,
      blockHash
    );

    // Serialize and hash the transaction for signing
    const serializedTx = transaction.encode();
    const txHash = await sha256(serializedTx);

    // Sign the transaction hash
    const signatureResult = keyPair.sign(txHash);

    // Create the Signature object
    const signature = new Signature({
      keyType: KeyType.ED25519,
      data: signatureResult.signature,
    });

    // Create signed transaction
    const signedTx = new SignedTransaction({
      transaction,
      signature,
    });

    // Serialize the signed transaction
    const serializedSignedTx = signedTx.encode();

    // Encode as base64 for RPC
    const signedTxBase64 = btoa(String.fromCharCode(...serializedSignedTx));

    // Broadcast transaction
    const result = await rpcCall<{ transaction: { hash: string } }>(
      rpcUrl,
      'broadcast_tx_commit',
      [signedTxBase64],
      apiKey
    );

    console.log(
      `License granted to ${walletAddress} for ${durationDays} days, tx: ${result.transaction.hash}`
    );

    return {
      success: true,
      txHash: result.transaction.hash,
    };
  } catch (error) {
    console.error('Failed to grant license:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

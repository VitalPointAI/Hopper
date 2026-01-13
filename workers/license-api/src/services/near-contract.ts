/**
 * NEAR contract integration using direct JSON-RPC
 * near-api-js doesn't work reliably in Cloudflare Workers,
 * so we use direct JSON-RPC calls for transaction signing and broadcasting
 */

import type { Env } from '../types';

// NEAR RPC endpoints (FastNEAR for production)
const MAINNET_RPC = 'https://rpc.mainnet.fastnear.com';
const TESTNET_RPC = 'https://rpc.testnet.fastnear.com';

// Gas and deposit constants
const DEFAULT_GAS = '30000000000000'; // 30 TGas
const NO_DEPOSIT = '0';

/**
 * Base64 encode a string
 */
function base64Encode(str: string): string {
  return btoa(str);
}

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

  const data = await response.json() as { result?: T; error?: { message: string; data?: unknown } };

  if (data.error) {
    throw new Error(`NEAR RPC error: ${data.error.message}`);
  }

  return data.result as T;
}

/**
 * Parse a NEAR private key from string format
 * Supports both ed25519: prefixed and raw base58 formats
 */
function parsePrivateKey(privateKeyStr: string): { publicKey: Uint8Array; secretKey: Uint8Array } {
  // Remove ed25519: prefix if present
  const keyStr = privateKeyStr.replace('ed25519:', '');

  // Decode base58
  const decoded = base58Decode(keyStr);

  // For ed25519, secret key is 64 bytes (32 secret + 32 public)
  // Or just 32 bytes (secret only, need to derive public)
  if (decoded.length === 64) {
    return {
      secretKey: decoded,
      publicKey: decoded.slice(32),
    };
  } else if (decoded.length === 32) {
    // Need to derive public key - for now, require full key
    throw new Error('32-byte private keys not supported, use full 64-byte ed25519 key');
  }

  throw new Error(`Invalid private key length: ${decoded.length}`);
}

/**
 * Base58 alphabet for NEAR
 */
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

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
 * Encode Uint8Array to base58 string
 */
function base58Encode(bytes: Uint8Array): string {
  const digits = [0];

  for (const byte of bytes) {
    let carry = byte;
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }

  // Handle leading zeros
  let result = '';
  for (const byte of bytes) {
    if (byte === 0) {
      result += '1';
    } else {
      break;
    }
  }

  for (let i = digits.length - 1; i >= 0; i--) {
    result += BASE58_ALPHABET[digits[i]];
  }

  return result;
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
 * Serialize a transaction for signing
 * This is a simplified implementation - uses borsh-like encoding
 */
function serializeTransaction(
  signerId: string,
  publicKey: Uint8Array,
  nonce: number,
  receiverId: string,
  blockHash: Uint8Array,
  actions: Array<{ methodName: string; args: string; gas: string; deposit: string }>
): Uint8Array {
  // This is a simplified serialization - in production, use proper borsh
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];

  // Signer ID (length-prefixed string)
  const signerBytes = encoder.encode(signerId);
  parts.push(new Uint8Array([signerBytes.length & 0xff, (signerBytes.length >> 8) & 0xff, 0, 0]));
  parts.push(signerBytes);

  // Public key (1 byte type + 32 bytes key)
  parts.push(new Uint8Array([0])); // ED25519 type
  parts.push(publicKey);

  // Nonce (8 bytes, little endian)
  const nonceBytes = new Uint8Array(8);
  let n = BigInt(nonce);
  for (let i = 0; i < 8; i++) {
    nonceBytes[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  parts.push(nonceBytes);

  // Receiver ID (length-prefixed string)
  const receiverBytes = encoder.encode(receiverId);
  parts.push(new Uint8Array([receiverBytes.length & 0xff, (receiverBytes.length >> 8) & 0xff, 0, 0]));
  parts.push(receiverBytes);

  // Block hash (32 bytes)
  parts.push(blockHash);

  // Actions count (4 bytes)
  parts.push(new Uint8Array([actions.length & 0xff, 0, 0, 0]));

  // Actions
  for (const action of actions) {
    // Action type: FunctionCall = 2
    parts.push(new Uint8Array([2]));

    // Method name (length-prefixed)
    const methodBytes = encoder.encode(action.methodName);
    parts.push(new Uint8Array([methodBytes.length & 0xff, (methodBytes.length >> 8) & 0xff, 0, 0]));
    parts.push(methodBytes);

    // Args (length-prefixed bytes)
    const argsBytes = encoder.encode(action.args);
    parts.push(new Uint8Array([argsBytes.length & 0xff, (argsBytes.length >> 8) & 0xff, 0, 0]));
    parts.push(argsBytes);

    // Gas (8 bytes, little endian)
    const gasBytes = new Uint8Array(8);
    let g = BigInt(action.gas);
    for (let i = 0; i < 8; i++) {
      gasBytes[i] = Number(g & 0xffn);
      g >>= 8n;
    }
    parts.push(gasBytes);

    // Deposit (16 bytes, little endian u128)
    const depositBytes = new Uint8Array(16);
    let d = BigInt(action.deposit);
    for (let i = 0; i < 16; i++) {
      depositBytes[i] = Number(d & 0xffn);
      d >>= 8n;
    }
    parts.push(depositBytes);
  }

  // Concatenate all parts
  const totalLength = parts.reduce((sum, p) => sum + p.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }

  return result;
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
 * Calls contract.grant_license(account_id, duration_days)
 */
export async function grantLicense(
  env: Env,
  nearAccountId: string,
  durationDays: number
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  try {
    const rpcUrl = getRpcUrl(env);
    const contractId = env.LICENSE_CONTRACT_ID;
    const apiKey = env.FASTNEAR_API_KEY;

    // Parse the private key to get signer info
    const { publicKey, secretKey } = parsePrivateKey(env.NEAR_PRIVATE_KEY);
    const publicKeyBase58 = `ed25519:${base58Encode(publicKey)}`;

    // The signer account is derived from the private key
    // For simplicity, we expect the contract ID to also be the admin account
    // or the admin account ID should be stored in env
    // Using contract ID as signer for now (admin = contract deployer pattern)
    const signerId = contractId;

    // Get access key info (nonce and recent block hash)
    const accessKeyInfo = await getAccessKey(rpcUrl, signerId, publicKeyBase58, apiKey);
    const nonce = accessKeyInfo.nonce + 1;
    const blockHash = base58Decode(accessKeyInfo.block_hash);

    // Prepare the function call arguments
    const args = JSON.stringify({
      account_id: nearAccountId,
      duration_days: durationDays,
    });

    // Create and sign the transaction
    const txBytes = serializeTransaction(
      signerId,
      publicKey,
      nonce,
      contractId,
      blockHash,
      [
        {
          methodName: 'grant_license',
          args,
          gas: DEFAULT_GAS,
          deposit: NO_DEPOSIT,
        },
      ]
    );

    // Hash the transaction
    const txHash = await sha256(txBytes);

    // Sign the hash using Web Crypto API
    // Note: Ed25519 signing in Workers requires importing the key
    const keyPair = await crypto.subtle.importKey(
      'raw',
      secretKey.slice(0, 32), // Use first 32 bytes as seed
      { name: 'Ed25519' },
      false,
      ['sign']
    );

    const signature = await crypto.subtle.sign('Ed25519', keyPair, txHash);
    const signatureBytes = new Uint8Array(signature);

    // Create signed transaction (signature + transaction)
    const signedTx = new Uint8Array(64 + txBytes.length);
    signedTx.set(signatureBytes, 0);
    signedTx.set(txBytes, 64);

    // Encode as base64 for RPC
    const signedTxBase64 = btoa(String.fromCharCode(...signedTx));

    // Broadcast transaction
    const result = await rpcCall<{ transaction: { hash: string } }>(
      rpcUrl,
      'broadcast_tx_commit',
      [signedTxBase64],
      apiKey
    );

    console.log(`License granted to ${nearAccountId} for ${durationDays} days, tx: ${result.transaction.hash}`);

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

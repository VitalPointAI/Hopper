import { LicenseConfig } from './types';

/**
 * NEAR RPC response structure
 */
interface NearRpcResponse {
  jsonrpc: string;
  id: string;
  result?: {
    result?: number[];
    error?: string;
  };
  error?: {
    message: string;
    code: number;
  };
}

/**
 * Encode function arguments as base64 JSON
 */
function encodeArgs(args: Record<string, unknown>): string {
  const json = JSON.stringify(args);
  return Buffer.from(json).toString('base64');
}

/**
 * Decode NEAR RPC result from byte array to value
 */
function decodeResult<T>(result: number[]): T {
  const bytes = new Uint8Array(result);
  const json = new TextDecoder().decode(bytes);
  return JSON.parse(json) as T;
}

/**
 * Call a view function on the license contract
 */
async function callViewFunction<T>(
  methodName: string,
  args: Record<string, unknown>,
  config: LicenseConfig
): Promise<T | null> {
  const requestBody = {
    jsonrpc: '2.0',
    id: 'hopper',
    method: 'query',
    params: {
      request_type: 'call_function',
      finality: 'final',
      account_id: config.contractId,
      method_name: methodName,
      args_base64: encodeArgs(args),
    },
  };

  try {
    const response = await fetch(config.rpcUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      console.error(`NEAR RPC request failed: ${response.status} ${response.statusText}`);
      return null;
    }

    const data = (await response.json()) as NearRpcResponse;

    if (data.error) {
      console.error(`NEAR RPC error: ${data.error.message}`);
      return null;
    }

    if (!data.result?.result) {
      console.error('NEAR RPC: No result in response');
      return null;
    }

    return decodeResult<T>(data.result.result);
  } catch (error) {
    console.error('NEAR RPC call failed:', error);
    return null;
  }
}

/**
 * Check if a wallet has a valid license
 * @param walletAddress - Wallet address to check (NEAR account, EVM address, etc.)
 * @param config - License configuration
 * @returns true if licensed, false if not licensed or on error (fail-closed)
 */
export async function viewIsLicensed(
  walletAddress: string,
  config: LicenseConfig
): Promise<boolean> {
  const result = await callViewFunction<boolean>(
    'is_licensed',
    { wallet_address: walletAddress },
    config
  );

  // Fail-closed: treat null/undefined as not licensed
  return result === true;
}

/**
 * Get the license expiry timestamp for a wallet
 * @param walletAddress - Wallet address to check (NEAR account, EVM address, etc.)
 * @param config - License configuration
 * @returns Unix timestamp (nanoseconds) when license expires, or null if not licensed
 */
export async function viewGetExpiry(
  walletAddress: string,
  config: LicenseConfig
): Promise<number | null> {
  const result = await callViewFunction<number | null>(
    'get_expiry',
    { wallet_address: walletAddress },
    config
  );

  return result ?? null;
}

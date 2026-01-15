/**
 * Telemetry service for tracking extension usage and conversions
 * Reports anonymous usage data to the license API for analytics
 */

import * as vscode from 'vscode';
import * as os from 'os';
import * as crypto from 'crypto';

// Storage key for install ID
const INSTALL_ID_KEY = 'specflow.installId';

// Default API URL - matches package.json specflow.licenseApiUrl default
const DEFAULT_API_URL = 'https://specflow-license-api.vitalpointai.workers.dev';

/**
 * Get the API URL from VSCode configuration or use default
 * Uses same setting as phaseGate.ts for consistency
 */
function getApiUrl(): string {
  const config = vscode.workspace.getConfiguration('specflow');
  return config.get<string>('licenseApiUrl') ?? DEFAULT_API_URL;
}

interface TelemetryEvent {
  event: 'install' | 'activate' | 'login' | 'upgrade';
  installId: string;
  extensionVersion: string;
  vscodeVersion: string;
  platform: string;
  nearAccountId?: string;
  source?: string;
}

/**
 * Get or create a unique installation ID
 * Uses globalState for persistence across sessions
 */
export async function getInstallId(context: vscode.ExtensionContext): Promise<string> {
  let installId = context.globalState.get<string>(INSTALL_ID_KEY);

  if (!installId) {
    // Generate a new unique ID
    // Use machine ID + random for uniqueness
    const machineId = getMachineId();
    const random = crypto.randomBytes(8).toString('hex');
    installId = `${machineId}-${random}`;
    await context.globalState.update(INSTALL_ID_KEY, installId);
  }

  return installId;
}

/**
 * Get a hash of the machine ID for anonymity
 */
function getMachineId(): string {
  try {
    // Use vscode's machine ID if available, otherwise generate from hostname
    const hostname = os.hostname();
    const hash = crypto.createHash('sha256').update(hostname).digest('hex');
    return hash.substring(0, 16);
  } catch {
    return crypto.randomBytes(8).toString('hex');
  }
}

/**
 * Get extension version from package.json
 */
function getExtensionVersion(): string {
  const ext = vscode.extensions.getExtension('vitalpoint.specflow');
  return ext?.packageJSON?.version || 'unknown';
}

/**
 * Send telemetry event to the API
 * Fails silently - telemetry should never block the user
 */
async function sendTelemetryEvent(event: TelemetryEvent): Promise<boolean> {
  try {
    const apiUrl = getApiUrl();
    const response = await fetch(`${apiUrl}/api/telemetry`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(event),
    });

    if (!response.ok) {
      console.debug('Telemetry event failed:', response.status);
      return false;
    }

    return true;
  } catch (error) {
    // Silently fail - don't disrupt user experience
    console.debug('Telemetry error:', error);
    return false;
  }
}

/**
 * Track extension activation
 * Called on extension.activate()
 */
export async function trackActivation(context: vscode.ExtensionContext): Promise<void> {
  const installId = await getInstallId(context);
  const isFirstRun = !context.globalState.get<boolean>('specflow.hasActivatedBefore');

  const event: TelemetryEvent = {
    event: isFirstRun ? 'install' : 'activate',
    installId,
    extensionVersion: getExtensionVersion(),
    vscodeVersion: vscode.version,
    platform: process.platform,
    source: 'marketplace', // Default assumption
  };

  await sendTelemetryEvent(event);

  if (isFirstRun) {
    await context.globalState.update('specflow.hasActivatedBefore', true);
  }
}

/**
 * Track user login with NEAR wallet
 * Called when user successfully authenticates
 */
export async function trackLogin(
  context: vscode.ExtensionContext,
  nearAccountId: string
): Promise<void> {
  const installId = await getInstallId(context);

  const event: TelemetryEvent = {
    event: 'login',
    installId,
    extensionVersion: getExtensionVersion(),
    vscodeVersion: vscode.version,
    platform: process.platform,
    nearAccountId,
  };

  await sendTelemetryEvent(event);
}

/**
 * Track user upgrade (subscription purchase)
 * Called when user successfully subscribes
 */
export async function trackUpgrade(
  context: vscode.ExtensionContext,
  nearAccountId: string
): Promise<void> {
  const installId = await getInstallId(context);

  const event: TelemetryEvent = {
    event: 'upgrade',
    installId,
    extensionVersion: getExtensionVersion(),
    vscodeVersion: vscode.version,
    platform: process.platform,
    nearAccountId,
  };

  await sendTelemetryEvent(event);
}

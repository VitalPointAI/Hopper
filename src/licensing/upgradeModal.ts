import * as vscode from 'vscode';
import type { AuthSession } from './types';

/**
 * Upgrade modal panel for showing pricing and checkout options
 *
 * Supports both authenticated and unauthenticated users:
 * - Authenticated (OAuth): Uses JWT for Stripe checkout
 * - Authenticated (wallet): Uses NEAR account ID
 * - Unauthenticated: Prompts for sign-in before checkout
 */
export class UpgradeModalPanel {
  public static currentPanel: UpgradeModalPanel | undefined;
  private static readonly viewType = 'specflowUpgrade';

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly authSession: AuthSession | null;
  private readonly context: vscode.ExtensionContext;
  private disposables: vscode.Disposable[] = [];

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    authSession: AuthSession | null,
    context: vscode.ExtensionContext
  ) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.authSession = authSession;
    this.context = context;

    // Set the webview's initial html content
    this.update();

    // Listen for when the panel is disposed
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    // Handle messages from the webview
    this.panel.webview.onDidReceiveMessage(
      async (message) => {
        console.log('UpgradeModal received message:', message);
        switch (message.command) {
          case 'stripe-checkout':
            await this.handleStripeCheckout();
            break;
          case 'crypto-checkout':
            await this.handleCryptoCheckout();
            break;
          case 'sign-in':
            await this.handleSignIn(message.paymentType);
            break;
          case 'close':
            this.dispose();
            break;
          default:
            console.log('Unknown command:', message.command);
        }
      },
      null,
      this.disposables
    );
  }

  /**
   * Show the upgrade modal panel
   *
   * @param context - Extension context
   * @param authSession - Current auth session (null if not authenticated)
   */
  public static show(context: vscode.ExtensionContext, authSession: AuthSession | null): void {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    // If we already have a panel, show it
    if (UpgradeModalPanel.currentPanel) {
      UpgradeModalPanel.currentPanel.panel.reveal(column);
      return;
    }

    // Otherwise, create a new panel
    const panel = vscode.window.createWebviewPanel(
      UpgradeModalPanel.viewType,
      'Upgrade to SpecFlow Pro',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [context.extensionUri],
      }
    );

    UpgradeModalPanel.currentPanel = new UpgradeModalPanel(
      panel,
      context.extensionUri,
      authSession,
      context
    );
  }

  /**
   * Handle Stripe checkout button click
   */
  private async handleStripeCheckout(): Promise<void> {
    // If not authenticated, prompt for sign-in
    if (!this.authSession) {
      await this.handleSignIn('stripe');
      return;
    }

    const config = vscode.workspace.getConfiguration('specflow');
    const apiUrl = config.get<string>('licenseApiUrl') ?? 'https://specflow-license-api.vitalpointai.workers.dev';

    try {
      vscode.window.showInformationMessage('Starting Stripe checkout...');

      // Build request headers and body based on auth type
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      const body: Record<string, string> = {};

      if (this.authSession.authType === 'oauth') {
        // OAuth users: Include JWT in Authorization header
        headers['Authorization'] = `Bearer ${this.authSession.token}`;
      } else {
        // Wallet users: Include NEAR account ID in body
        body['near_account_id'] = this.authSession.userId;
      }

      const response = await fetch(`${apiUrl}/api/checkout`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Checkout failed: ${error}`);
      }

      const data = await response.json() as { url: string };
      await vscode.env.openExternal(vscode.Uri.parse(data.url));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('Stripe checkout error:', errorMessage);
      vscode.window.showErrorMessage(
        `Failed to start checkout: ${errorMessage}. Make sure the license API is deployed.`
      );
    }
  }

  /**
   * Handle crypto checkout button click
   */
  private async handleCryptoCheckout(): Promise<void> {
    // Crypto checkout requires wallet authentication (NEAR account)
    if (!this.authSession || this.authSession.authType !== 'wallet') {
      vscode.window.showInformationMessage(
        'Crypto payments require a NEAR wallet. Please sign in with NEAR wallet first.'
      );
      await this.handleSignIn('crypto');
      return;
    }

    const config = vscode.workspace.getConfiguration('specflow');
    const apiUrl = config.get<string>('licenseApiUrl') ?? 'https://specflow-license-api.vitalpointai.workers.dev';

    try {
      vscode.window.showInformationMessage('Starting crypto checkout...');

      const response = await fetch(`${apiUrl}/api/crypto/subscribe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          nearAccountId: this.authSession.userId,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Crypto checkout failed: ${error}`);
      }

      const data = await response.json() as { authorizationUrl: string };
      await vscode.env.openExternal(vscode.Uri.parse(data.authorizationUrl));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('Crypto checkout error:', errorMessage);
      vscode.window.showErrorMessage(
        `Failed to start crypto checkout: ${errorMessage}. Make sure the license API is deployed.`
      );
    }
  }

  /**
   * Handle sign-in request
   * Shows quick pick for auth method selection
   *
   * @param paymentType - The payment type that triggered sign-in ('stripe' or 'crypto')
   */
  private async handleSignIn(paymentType: 'stripe' | 'crypto'): Promise<void> {
    // Store pending payment intent so we can resume after auth
    await this.context.globalState.update('specflow.pendingPayment', paymentType);

    // For crypto payments, only offer NEAR wallet
    if (paymentType === 'crypto') {
      vscode.commands.executeCommand('specflow.signIn');
      this.dispose();
      return;
    }

    // For Stripe payments, offer all auth options
    const authOptions = [
      { label: '$(globe) Sign in with Google', value: 'google' },
      { label: '$(github) Sign in with GitHub', value: 'github' },
      { label: '$(wallet) Sign in with NEAR Wallet', value: 'near' },
    ];

    const selected = await vscode.window.showQuickPick(authOptions, {
      placeHolder: 'Choose sign-in method to continue with payment',
      title: 'Sign In Required',
    });

    if (!selected) {
      // User cancelled - clear pending payment
      await this.context.globalState.update('specflow.pendingPayment', undefined);
      return;
    }

    // Trigger the appropriate auth flow
    switch (selected.value) {
      case 'google':
        vscode.commands.executeCommand('specflow.signInWithGoogle');
        break;
      case 'github':
        vscode.commands.executeCommand('specflow.signInWithGitHub');
        break;
      case 'near':
        vscode.commands.executeCommand('specflow.signIn');
        break;
    }

    // Close the modal - auth callback will reopen checkout if needed
    this.dispose();
  }

  /**
   * Update the webview content
   */
  private update(): void {
    this.panel.webview.html = this.getHtmlContent();
  }

  /**
   * Get the display name for the account info section
   */
  private getAccountDisplay(): string {
    if (!this.authSession) {
      return 'Sign in to subscribe';
    }

    // Prefer displayName, then email, then userId
    return this.authSession.displayName ?? this.authSession.email ?? this.authSession.userId;
  }

  /**
   * Get the HTML content for the webview
   */
  private getHtmlContent(): string {
    const nonce = getNonce();
    const isAuthenticated = this.authSession !== null;
    const accountDisplay = this.getAccountDisplay();

    // Determine button text based on auth state
    const stripeButtonText = isAuthenticated ? 'Subscribe with Card' : 'Sign in to Subscribe';
    const cryptoButtonText = isAuthenticated ? 'Pay with Crypto' : 'Sign in with NEAR';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>Upgrade to SpecFlow Pro</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background-color: var(--vscode-editor-background);
      padding: 24px;
      min-height: 100vh;
    }

    .container {
      max-width: 800px;
      margin: 0 auto;
    }

    .header {
      text-align: center;
      margin-bottom: 32px;
    }

    .header h1 {
      font-size: 28px;
      font-weight: 600;
      margin-bottom: 8px;
      color: var(--vscode-foreground);
    }

    .header p {
      color: var(--vscode-descriptionForeground);
      font-size: 14px;
    }

    .close-btn {
      position: absolute;
      top: 16px;
      right: 16px;
      background: none;
      border: none;
      color: var(--vscode-foreground);
      font-size: 24px;
      cursor: pointer;
      opacity: 0.7;
      transition: opacity 0.2s;
      padding: 8px;
      line-height: 1;
    }

    .close-btn:hover {
      opacity: 1;
    }

    .pricing-cards {
      display: flex;
      gap: 24px;
      justify-content: center;
      flex-wrap: wrap;
    }

    .pricing-card {
      background-color: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      padding: 24px;
      width: 320px;
      display: flex;
      flex-direction: column;
      transition: border-color 0.2s;
    }

    .pricing-card:hover {
      border-color: var(--vscode-focusBorder);
    }

    .pricing-card.recommended {
      border-color: var(--vscode-button-background);
      position: relative;
    }

    .recommended-badge {
      position: absolute;
      top: -12px;
      left: 50%;
      transform: translateX(-50%);
      background-color: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      padding: 4px 12px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
    }

    .card-header {
      text-align: center;
      padding-bottom: 20px;
      border-bottom: 1px solid var(--vscode-panel-border);
      margin-bottom: 20px;
    }

    .card-title {
      font-size: 18px;
      font-weight: 600;
      margin-bottom: 4px;
    }

    .card-subtitle {
      color: var(--vscode-descriptionForeground);
      font-size: 13px;
    }

    .price {
      font-size: 36px;
      font-weight: 700;
      margin: 12px 0 4px;
    }

    .price-period {
      color: var(--vscode-descriptionForeground);
      font-size: 14px;
    }

    .discount {
      display: inline-block;
      background-color: var(--vscode-testing-iconPassed);
      color: white;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 600;
      margin-top: 8px;
    }

    .features {
      flex-grow: 1;
      margin-bottom: 20px;
    }

    .feature {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 0;
      font-size: 14px;
    }

    .feature-icon {
      color: var(--vscode-testing-iconPassed);
      font-weight: bold;
    }

    .checkout-btn {
      width: 100%;
      padding: 12px 20px;
      font-size: 14px;
      font-weight: 600;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      transition: opacity 0.2s;
    }

    .checkout-btn:hover {
      opacity: 0.9;
    }

    .checkout-btn.primary {
      background-color: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }

    .checkout-btn.secondary {
      background-color: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }

    .footer {
      text-align: center;
      margin-top: 32px;
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
    }

    .footer a {
      color: var(--vscode-textLink-foreground);
      text-decoration: none;
    }

    .footer a:hover {
      text-decoration: underline;
    }

    .account-info {
      text-align: center;
      margin-bottom: 24px;
      padding: 12px;
      background-color: var(--vscode-textBlockQuote-background);
      border-radius: 4px;
      font-size: 13px;
    }

    .account-info strong {
      color: var(--vscode-foreground);
    }

    .account-info.not-signed-in {
      color: var(--vscode-descriptionForeground);
      font-style: italic;
    }
  </style>
</head>
<body>
  <button class="close-btn" id="close-btn" title="Close">&times;</button>

  <div class="container">
    <div class="header">
      <h1>Upgrade to SpecFlow Pro</h1>
      <p>Unlock unlimited phases and the full SpecFlow workflow</p>
    </div>

    <div class="account-info${isAuthenticated ? '' : ' not-signed-in'}">
      ${isAuthenticated ? `Licensing for: <strong>${this.escapeHtml(accountDisplay)}</strong>` : accountDisplay}
    </div>

    <div class="pricing-cards">
      <div class="pricing-card">
        <div class="card-header">
          <div class="card-title">Credit Card</div>
          <div class="card-subtitle">Pay with Stripe</div>
          <div class="price">$5</div>
          <div class="price-period">per month</div>
        </div>
        <div class="features">
          <div class="feature">
            <span class="feature-icon">&#10003;</span>
            <span>Unlimited phases</span>
          </div>
          <div class="feature">
            <span class="feature-icon">&#10003;</span>
            <span>Full SpecFlow workflow</span>
          </div>
          <div class="feature">
            <span class="feature-icon">&#10003;</span>
            <span>Priority support</span>
          </div>
          <div class="feature">
            <span class="feature-icon">&#10003;</span>
            <span>Cancel anytime</span>
          </div>
        </div>
        <button class="checkout-btn secondary" id="stripe-btn">
          ${stripeButtonText}
        </button>
      </div>

      <div class="pricing-card recommended">
        <span class="recommended-badge">Save 20%</span>
        <div class="card-header">
          <div class="card-title">Crypto</div>
          <div class="card-subtitle">Pay with NEAR or USDC</div>
          <div class="price">$4</div>
          <div class="price-period">per month</div>
          <div class="discount">20% OFF</div>
        </div>
        <div class="features">
          <div class="feature">
            <span class="feature-icon">&#10003;</span>
            <span>Unlimited phases</span>
          </div>
          <div class="feature">
            <span class="feature-icon">&#10003;</span>
            <span>Full SpecFlow workflow</span>
          </div>
          <div class="feature">
            <span class="feature-icon">&#10003;</span>
            <span>Priority support</span>
          </div>
          <div class="feature">
            <span class="feature-icon">&#10003;</span>
            <span>No card required</span>
          </div>
        </div>
        <button class="checkout-btn primary" id="crypto-btn">
          ${cryptoButtonText}
        </button>
      </div>
    </div>

    <div class="footer">
      <p>Secure payment processing. <a href="https://specflow.dev/terms">Terms of Service</a> | <a href="https://specflow.dev/privacy">Privacy Policy</a></p>
    </div>
  </div>

  <script nonce="${nonce}">
    (function() {
      const vscode = acquireVsCodeApi();
      const isAuthenticated = ${isAuthenticated};
      console.log('Webview script loaded, vscode API acquired, authenticated:', isAuthenticated);

      document.getElementById('stripe-btn').addEventListener('click', function() {
        if (isAuthenticated) {
          console.log('stripeCheckout called');
          vscode.postMessage({ command: 'stripe-checkout' });
        } else {
          console.log('sign-in for stripe called');
          vscode.postMessage({ command: 'sign-in', paymentType: 'stripe' });
        }
      });

      document.getElementById('crypto-btn').addEventListener('click', function() {
        if (isAuthenticated) {
          console.log('cryptoCheckout called');
          vscode.postMessage({ command: 'crypto-checkout' });
        } else {
          console.log('sign-in for crypto called');
          vscode.postMessage({ command: 'sign-in', paymentType: 'crypto' });
        }
      });

      document.getElementById('close-btn').addEventListener('click', function() {
        console.log('closeModal called');
        vscode.postMessage({ command: 'close' });
      });
    })();
  </script>
</body>
</html>`;
  }

  /**
   * Escape HTML special characters to prevent XSS
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Dispose of the panel
   */
  public dispose(): void {
    UpgradeModalPanel.currentPanel = undefined;

    // Clean up resources
    this.panel.dispose();

    while (this.disposables.length) {
      const disposable = this.disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }
}

/**
 * Generate a nonce for content security policy
 */
function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

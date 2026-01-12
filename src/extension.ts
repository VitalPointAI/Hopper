import * as vscode from 'vscode';

/**
 * Called when the extension is activated.
 * @param context - The extension context provided by VSCode
 */
export function activate(context: vscode.ExtensionContext): void {
  console.log('SpecFlow extension activated');

  // Register the management command
  const manageCommand = vscode.commands.registerCommand(
    'specflow.manageNearAi',
    () => {
      vscode.window.showInformationMessage('NEAR AI management coming soon');
    }
  );

  context.subscriptions.push(manageCommand);
}

/**
 * Called when the extension is deactivated.
 */
export function deactivate(): void {
  // Cleanup if needed
}

/**
 * Cryptography remediation transforms
 *
 * Provides jscodeshift transforms for fixing crypto vulnerabilities:
 * - Math.random() → crypto.randomBytes()
 * - === on secrets → crypto.timingSafeEqual()
 */

import { Transform, Identifier, MemberExpression, CallExpression } from 'jscodeshift';
import { registerTransform } from './index';

/**
 * Pattern for identifying secret-like variable names
 * Used to detect timing attack vulnerabilities
 */
const SECRET_PATTERNS = /secret|token|key|hash|password|signature|apikey|api_key/i;

/**
 * Helper: Add crypto import to file
 *
 * @param j - jscodeshift API
 * @param root - AST root
 * @param specifiers - Import specifiers to add (e.g., 'randomBytes', 'timingSafeEqual')
 */
function addCryptoImport(
  j: ReturnType<typeof import('jscodeshift').withParser>,
  root: ReturnType<typeof import('jscodeshift')>,
  specifiers: string[]
): void {
  const imports = root.find(j.ImportDeclaration);

  // Check if crypto import already exists
  const cryptoImport = imports.filter(
    (p) => p.node.source.value === 'crypto'
  );

  if (cryptoImport.length) {
    // Add specifiers to existing import
    const existing = cryptoImport.at(0).get();
    const existingSpecifiers = existing.node.specifiers || [];
    const existingNames = new Set(
      existingSpecifiers
        .filter((s: { type: string }) => s.type === 'ImportSpecifier')
        .map((s: { imported: { name: string } }) => s.imported.name)
    );

    for (const spec of specifiers) {
      if (!existingNames.has(spec)) {
        existingSpecifiers.push(
          j.importSpecifier(j.identifier(spec), j.identifier(spec))
        );
      }
    }
  } else {
    // Create new crypto import
    const newImport = j.importDeclaration(
      specifiers.map((s) => j.importSpecifier(j.identifier(s), j.identifier(s))),
      j.literal('crypto')
    );

    // Insert after last import or at top
    const lastImport = imports.at(-1);
    if (lastImport.length) {
      lastImport.insertAfter(newImport);
    } else {
      root.find(j.Program).get('body', 0).insertBefore(newImport);
    }
  }
}

/**
 * Transform: Replace Math.random() with cryptographically secure random
 *
 * Before: Math.random()
 * After:  crypto.randomBytes(4).readUInt32LE() / 0xffffffff
 *
 * This produces a floating-point number in [0, 1) like Math.random(),
 * but uses cryptographically secure randomness.
 *
 * Note: For security-sensitive contexts (tokens, IDs, etc.), consider
 * using crypto.randomUUID() or crypto.randomBytes() directly instead.
 */
export const mathRandomToCrypto: Transform = (file, api) => {
  const j = api.jscodeshift;
  const root = j(file.source);
  let modified = false;

  // Find Math.random() calls
  root
    .find(j.CallExpression, {
      callee: {
        type: 'MemberExpression',
        object: { type: 'Identifier', name: 'Math' },
        property: { type: 'Identifier', name: 'random' },
      },
    })
    .forEach((path) => {
      // Replace with: crypto.randomBytes(4).readUInt32LE() / 0xffffffff
      // This is: randomBytes(4).readUInt32LE() / 4294967295
      path.replace(
        j.binaryExpression(
          '/',
          j.callExpression(
            j.memberExpression(
              j.callExpression(j.identifier('randomBytes'), [j.literal(4)]),
              j.identifier('readUInt32LE')
            ),
            []
          ),
          j.literal(0xffffffff)
        )
      );
      modified = true;
    });

  // Add crypto import if we made changes
  if (modified) {
    addCryptoImport(j, root, ['randomBytes']);
  }

  return modified ? root.toSource() : null;
};

/**
 * Transform: Replace === on secrets with timing-safe comparison
 *
 * Before: userToken === storedToken
 * After:  crypto.timingSafeEqual(Buffer.from(userToken), Buffer.from(storedToken))
 *
 * Only applies when one or both operands have secret-like names:
 * - secret, token, key, hash, password, signature, apikey, api_key
 *
 * This prevents timing attacks where an attacker can measure comparison
 * time to guess secret values character by character.
 */
export const equalToTimingSafe: Transform = (file, api) => {
  const j = api.jscodeshift;
  const root = j(file.source);
  let modified = false;

  // Find equality comparisons (=== or ==)
  root
    .find(j.BinaryExpression)
    .filter((path) => {
      const op = path.node.operator;
      return op === '===' || op === '==';
    })
    .forEach((path) => {
      const { left, right } = path.node;

      // Get variable names if identifiers
      const leftName = left.type === 'Identifier' ? (left as Identifier).name : '';
      const rightName = right.type === 'Identifier' ? (right as Identifier).name : '';

      // Check if either operand looks like a secret
      if (SECRET_PATTERNS.test(leftName) || SECRET_PATTERNS.test(rightName)) {
        // Replace with crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))
        path.replace(
          j.callExpression(j.identifier('timingSafeEqual'), [
            j.callExpression(
              j.memberExpression(j.identifier('Buffer'), j.identifier('from')),
              [left]
            ),
            j.callExpression(
              j.memberExpression(j.identifier('Buffer'), j.identifier('from')),
              [right]
            ),
          ])
        );
        modified = true;
      }
    });

  // Add crypto import if we made changes
  if (modified) {
    addCryptoImport(j, root, ['timingSafeEqual']);
  }

  return modified ? root.toSource() : null;
};

/**
 * Register crypto transforms in the registry
 */
export function registerCryptoTransforms(): void {
  // Map to ESLint rule: security/detect-pseudoRandomBytes
  registerTransform('security/detect-pseudoRandomBytes', {
    transform: mathRandomToCrypto,
    description: 'Replace Math.random() with crypto.randomBytes()',
    confidence: 'high',
  });

  // Map to ESLint rule: security/detect-possible-timing-attacks
  registerTransform('security/detect-possible-timing-attacks', {
    transform: equalToTimingSafe,
    description: 'Replace === with crypto.timingSafeEqual()',
    confidence: 'high',
  });
}

// Auto-register transforms when module is imported
registerCryptoTransforms();

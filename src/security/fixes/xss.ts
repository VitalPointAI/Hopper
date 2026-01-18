/**
 * XSS remediation transforms
 *
 * Provides jscodeshift transforms for fixing XSS vulnerabilities:
 * - innerHTML → DOMPurify.sanitize()
 * - innerHTML → textContent (for simple cases)
 */

import { Transform } from 'jscodeshift';
import { registerTransform } from './index';

/**
 * Transform: Wrap innerHTML assignments with DOMPurify.sanitize()
 *
 * Before: element.innerHTML = userInput
 * After:  element.innerHTML = DOMPurify.sanitize(userInput)
 *
 * - Skips if already wrapped with DOMPurify
 * - Adds import if not present
 */
export const innerHTMLToDOMPurify: Transform = (file, api) => {
  const j = api.jscodeshift;
  const root = j(file.source);
  let modified = false;

  // Find innerHTML assignments: element.innerHTML = value
  root
    .find(j.AssignmentExpression, {
      left: {
        type: 'MemberExpression',
        property: { name: 'innerHTML' },
      },
    })
    .forEach((path) => {
      const right = path.node.right;

      // Skip if already wrapped with DOMPurify.sanitize()
      if (right.type === 'CallExpression') {
        const callee = right.callee;
        if (
          callee.type === 'MemberExpression' &&
          callee.object.type === 'Identifier' &&
          callee.object.name === 'DOMPurify' &&
          callee.property.type === 'Identifier' &&
          callee.property.name === 'sanitize'
        ) {
          return;
        }
      }

      // Wrap with DOMPurify.sanitize()
      path.node.right = j.callExpression(
        j.memberExpression(j.identifier('DOMPurify'), j.identifier('sanitize')),
        [right]
      );
      modified = true;
    });

  // Add import if we made changes
  if (modified) {
    const imports = root.find(j.ImportDeclaration);
    const hasDOMPurify = imports.some(
      (p) => p.node.source.value === 'dompurify'
    );

    if (!hasDOMPurify) {
      const newImport = j.importDeclaration(
        [j.importDefaultSpecifier(j.identifier('DOMPurify'))],
        j.literal('dompurify')
      );

      // Insert after last import or at top of file
      const lastImport = imports.at(-1);
      if (lastImport.length) {
        lastImport.insertAfter(newImport);
      } else {
        root.find(j.Program).get('body', 0).insertBefore(newImport);
      }
    }
  }

  return modified ? root.toSource() : null;
};

/**
 * Transform: Convert innerHTML to textContent for simple cases
 *
 * Before: element.innerHTML = plainTextVariable
 * After:  element.textContent = plainTextVariable
 *
 * Only applies when right-hand side is:
 * - String literal
 * - Simple identifier (not containing 'html' in name)
 *
 * Does NOT apply for:
 * - Template literals (may contain HTML)
 * - Concatenation expressions
 * - Function calls
 */
export const innerHTMLToTextContent: Transform = (file, api) => {
  const j = api.jscodeshift;
  const root = j(file.source);
  let modified = false;

  root
    .find(j.AssignmentExpression, {
      left: {
        type: 'MemberExpression',
        property: { name: 'innerHTML' },
      },
    })
    .forEach((path) => {
      const right = path.node.right;

      // Only convert simple cases:
      // - String literals (definitely not HTML)
      // - Simple variables without 'html' in name (probably plain text)
      const isStringLiteral =
        right.type === 'StringLiteral' || right.type === 'Literal';
      const isSimpleVariable =
        right.type === 'Identifier' &&
        !right.name.toLowerCase().includes('html');

      if (isStringLiteral || isSimpleVariable) {
        // Change innerHTML to textContent
        if (
          path.node.left.type === 'MemberExpression' &&
          path.node.left.property.type === 'Identifier'
        ) {
          path.node.left.property = j.identifier('textContent');
          modified = true;
        }
      }
    });

  return modified ? root.toSource() : null;
};

/**
 * Register XSS transforms in the registry
 */
export function registerXssTransforms(): void {
  // Map to ESLint rule: no-unsanitized/property
  registerTransform('no-unsanitized/property', {
    transform: innerHTMLToDOMPurify,
    description: 'Wrap innerHTML with DOMPurify.sanitize()',
    confidence: 'medium',
    requiresPackage: 'dompurify',
  });

  // Alternative transform for simpler innerHTML → textContent cases
  // Registered under a different ID since it's not always appropriate
  registerTransform('xss-innerHTML-to-textContent', {
    transform: innerHTMLToTextContent,
    description: 'Convert innerHTML to textContent for plain text',
    confidence: 'high',
  });
}

// Auto-register transforms when module is imported
registerXssTransforms();

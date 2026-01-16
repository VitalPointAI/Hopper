/**
 * Telemetry endpoint handlers
 * Public endpoints for extension to report installation/activation events
 */

import type { Context } from 'hono';
import type { Env, TelemetryRequest } from '../types';
import {
  recordInstallation,
  recordLogin,
  recordUpgrade,
} from '../services/telemetry-store';

/**
 * POST /api/telemetry
 * Record telemetry events from the extension
 * This is a public endpoint (no auth required)
 */
export async function handleTelemetry(
  c: Context<{ Bindings: Env }>
): Promise<Response> {
  try {
    const body = await c.req.json<TelemetryRequest>();

    // Validate required fields
    if (!body.event || !body.installId) {
      return c.json({ error: 'Missing required fields: event, installId' }, 400);
    }

    // Basic validation of installId format (should be UUID-like or machine ID)
    if (body.installId.length < 8 || body.installId.length > 128) {
      return c.json({ error: 'Invalid installId format' }, 400);
    }

    switch (body.event) {
      case 'install':
      case 'activate': {
        // Record installation or activation
        if (!body.extensionVersion || !body.vscodeVersion || !body.platform) {
          return c.json(
            { error: 'Missing required fields for install/activate event' },
            400
          );
        }

        const record = await recordInstallation(c.env.TELEMETRY, {
          installId: body.installId,
          extensionVersion: body.extensionVersion,
          vscodeVersion: body.vscodeVersion,
          platform: body.platform,
          source: body.source,
        });

        return c.json({
          success: true,
          isNew: record.firstSeen === record.lastSeen,
        });
      }

      case 'login': {
        // Record user login (associate NEAR account with installation)
        if (!body.nearAccountId) {
          return c.json({ error: 'nearAccountId required for login event' }, 400);
        }

        const record = await recordLogin(
          c.env.TELEMETRY,
          body.installId,
          body.nearAccountId
        );

        if (!record) {
          // Installation not found - create it first
          if (!body.extensionVersion || !body.vscodeVersion || !body.platform) {
            return c.json({ error: 'Installation not found and missing fields to create' }, 400);
          }

          await recordInstallation(c.env.TELEMETRY, {
            installId: body.installId,
            extensionVersion: body.extensionVersion,
            vscodeVersion: body.vscodeVersion,
            platform: body.platform,
            source: body.source,
          });

          await recordLogin(c.env.TELEMETRY, body.installId, body.nearAccountId);
        }

        return c.json({ success: true });
      }

      case 'upgrade': {
        // Record upgrade event (free -> pro conversion)
        if (!body.nearAccountId) {
          return c.json({ error: 'nearAccountId required for upgrade event' }, 400);
        }

        const record = await recordUpgrade(
          c.env.TELEMETRY,
          body.installId,
          body.nearAccountId
        );

        if (!record) {
          return c.json({ error: 'Installation not found' }, 404);
        }

        return c.json({
          success: true,
          alreadyUpgraded: record.upgradedAt !== undefined,
        });
      }

      default:
        return c.json({ error: `Unknown event type: ${body.event}` }, 400);
    }
  } catch (error) {
    console.error('Telemetry error:', error);
    return c.json(
      { error: error instanceof Error ? error.message : 'Telemetry failed' },
      500
    );
  }
}

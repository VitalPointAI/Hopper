/**
 * Admin stats endpoint handler
 * GET /admin/api/stats
 */

import type { Context } from 'hono';
import type { Env } from '../../types';
import { getSubscriptionStats } from '../../services/admin-stats';
import { statsFragment } from './ui';

/**
 * Get subscription statistics
 * Returns counts of active/cancelled subscriptions and estimated revenue
 * Returns HTML fragment if HX-Request header is present (htmx), otherwise JSON
 */
export async function handleAdminStats(c: Context<{ Bindings: Env }>): Promise<Response> {
  try {
    const stats = await getSubscriptionStats(c.env);

    // Check if request is from htmx
    const isHtmx = c.req.header('HX-Request') === 'true';

    if (isHtmx) {
      return c.html(statsFragment(stats));
    }

    return c.json({
      success: true,
      data: stats,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error fetching admin stats:', errorMessage);
    return c.json({ error: 'Failed to fetch statistics' }, 500);
  }
}

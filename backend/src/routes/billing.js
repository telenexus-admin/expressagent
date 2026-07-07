const express = require('express');
const router = express.Router();
const db = require('../db');
const { authMiddleware, scopeMiddleware } = require('../middleware/auth');

router.use(authMiddleware, scopeMiddleware);

const DEFAULT_BASE_FEE = 800;
const DEFAULT_INCLUDED_MESSAGES = 500;
const DEFAULT_OVERAGE_UNIT_MESSAGES = 2;
const DEFAULT_OVERAGE_UNIT_PRICE = 1;

function pricing() {
  const baseFee = Number(process.env.NEXA_BILLING_BASE_FEE || DEFAULT_BASE_FEE);
  const includedMessages = Number(process.env.NEXA_BILLING_INCLUDED_AI_MESSAGES || DEFAULT_INCLUDED_MESSAGES);
  const overageUnitMessages = Number(process.env.NEXA_BILLING_OVERAGE_UNIT_MESSAGES || DEFAULT_OVERAGE_UNIT_MESSAGES);
  const overageUnitPrice = Number(process.env.NEXA_BILLING_OVERAGE_UNIT_PRICE || DEFAULT_OVERAGE_UNIT_PRICE);
  return {
    currency: 'KES',
    base_fee: Number.isFinite(baseFee) && baseFee >= 0 ? baseFee : DEFAULT_BASE_FEE,
    included_ai_messages: Number.isFinite(includedMessages) && includedMessages >= 0 ? includedMessages : DEFAULT_INCLUDED_MESSAGES,
    overage_unit_messages: Number.isFinite(overageUnitMessages) && overageUnitMessages > 0 ? overageUnitMessages : DEFAULT_OVERAGE_UNIT_MESSAGES,
    overage_unit_price: Number.isFinite(overageUnitPrice) && overageUnitPrice >= 0 ? overageUnitPrice : DEFAULT_OVERAGE_UNIT_PRICE,
  };
}

function money(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

router.get('/usage', async (req, res) => {
  try {
    const clientId = req.scope.clientId;
    if (!clientId) return res.status(400).json({ error: 'client_id is required' });

    const monthStart = req.query.month
      ? db.query(`SELECT date_trunc('month', $1::date) AS start_at`, [req.query.month])
      : db.query(`SELECT date_trunc('month', NOW()) AS start_at`);
    const resolvedMonth = (await monthStart).rows[0].start_at;

    const [usageRes, dailyRes, clientRes] = await Promise.all([
      db.query(
        `SELECT
           COALESCE(SUM(CASE WHEN m.role = 'assistant' THEN 1 ELSE 0 END), 0)::int AS ai_messages,
           COALESCE(SUM(CASE WHEN m.role = 'user' THEN 1 ELSE 0 END), 0)::int AS customer_messages,
           COALESCE(SUM(CASE WHEN m.role = 'admin' THEN 1 ELSE 0 END), 0)::int AS admin_messages,
           COUNT(DISTINCT m.conversation_id)::int AS active_conversations
         FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
         WHERE c.client_id = $1
           AND m.timestamp >= $2
           AND m.timestamp < ($2::timestamp + INTERVAL '1 month')`,
        [clientId, resolvedMonth]
      ),
      db.query(
        `WITH days AS (
           SELECT generate_series($2::date, ($2::date + INTERVAL '1 month - 1 day')::date, '1 day'::interval)::date AS day
         )
         SELECT d.day,
                COALESCE(COUNT(m.id), 0)::int AS ai_messages
         FROM days d
         LEFT JOIN messages m ON m.timestamp::date = d.day
           AND m.role = 'assistant'
           AND m.conversation_id IN (SELECT id FROM conversations WHERE client_id = $1)
         GROUP BY d.day
         ORDER BY d.day ASC`,
        [clientId, resolvedMonth]
      ),
      db.query(`SELECT id, name, business_name FROM clients WHERE id = $1 LIMIT 1`, [clientId]),
    ]);

    const usage = usageRes.rows[0] || {};
    const plan = pricing();
    const aiMessages = Number(usage.ai_messages) || 0;
    const included = plan.included_ai_messages;
    const overageMessages = Math.max(0, aiMessages - included);
    const overageCost = money((overageMessages / plan.overage_unit_messages) * plan.overage_unit_price);
    const totalDue = money(plan.base_fee + overageCost);
    const allowanceUsedPercent = included > 0 ? Math.min(100, Math.round((aiMessages / included) * 100)) : 100;
    const daysElapsed = Math.max(1, Math.ceil((Date.now() - new Date(resolvedMonth).getTime()) / 86400000));
    const avgDailyAi = money(aiMessages / daysElapsed);
    const projectedAiMessages = Math.round(avgDailyAi * 30);
    const projectedOverage = Math.max(0, projectedAiMessages - included);
    const projectedTotal = money(plan.base_fee + (projectedOverage / plan.overage_unit_messages) * plan.overage_unit_price);

    res.json({
      client: clientRes.rows[0] || { id: clientId },
      month: {
        start: resolvedMonth,
        label: new Date(resolvedMonth).toLocaleDateString('en-KE', { month: 'long', year: 'numeric' }),
      },
      pricing: plan,
      usage: {
        ai_messages: aiMessages,
        included_messages: included,
        remaining_included_messages: Math.max(0, included - aiMessages),
        overage_messages: overageMessages,
        customer_messages: Number(usage.customer_messages) || 0,
        admin_messages: Number(usage.admin_messages) || 0,
        active_conversations: Number(usage.active_conversations) || 0,
        allowance_used_percent: allowanceUsedPercent,
        average_daily_ai_messages: avgDailyAi,
        projected_ai_messages: projectedAiMessages,
      },
      charges: {
        base_fee: plan.base_fee,
        overage_cost: overageCost,
        total_due: totalDue,
        projected_total_due: projectedTotal,
      },
      daily_usage: dailyRes.rows,
    });
  } catch (err) {
    console.error('GET /billing/usage error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;

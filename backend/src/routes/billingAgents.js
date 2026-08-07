const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const db = require('../db');

const {
  authMiddleware,
  scopeMiddleware,
} = require('../middleware/auth');

const {
  cleanPhone,
  initiatePayHeroPayment,
  ensurePayHeroSchema,
} = require('../services/payhero');

const {
  sendSMS,
  hasSMSConfig,
} = require('../services/sms');

const adminRouter =
  express.Router();

const portalRouter =
  express.Router();

let schemaPromise = null;

function money(value) {
  return Math.round(
    Number(value || 0) * 100
  ) / 100;
}

function normalizeEmail(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function normalizeKenyanPhone(value) {
  let phone =
    String(value || '')
      .replace(/\D/g, '');

  if (phone.startsWith('0')) {
    phone =
      `254${phone.slice(1)}`;
  }

  if (
    phone.startsWith('7') ||
    phone.startsWith('1')
  ) {
    phone =
      `254${phone}`;
  }

  return phone;
}

function metadataObject(value) {
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value)
  ) {
    return value;
  }

  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch (_) {
      return {};
    }
  }

  return {};
}

async function ensureAgentSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await ensurePayHeroSchema();

      await db.query(`
        CREATE TABLE IF NOT EXISTS
        billing_agent_settings (
          client_id INTEGER PRIMARY KEY
            REFERENCES clients(id)
            ON DELETE CASCADE,

          bonus_percent NUMERIC(8,2)
            NOT NULL DEFAULT 50,

          default_device_limit INTEGER
            NOT NULL DEFAULT 1,

          minimum_funding_amount INTEGER
            NOT NULL DEFAULT 10,

          maximum_funding_amount INTEGER
            NOT NULL DEFAULT 500000,

          sms_enabled BOOLEAN
            NOT NULL DEFAULT TRUE,

          created_at TIMESTAMPTZ
            NOT NULL DEFAULT NOW(),

          updated_at TIMESTAMPTZ
            NOT NULL DEFAULT NOW()
        )
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS
        billing_agents (
          id BIGSERIAL PRIMARY KEY,

          client_id INTEGER NOT NULL
            REFERENCES clients(id)
            ON DELETE CASCADE,

          name VARCHAR(180) NOT NULL,

          business_name VARCHAR(180),

          email VARCHAR(255) NOT NULL,

          phone VARCHAR(40) NOT NULL,

          password_hash TEXT NOT NULL,

          status VARCHAR(20)
            NOT NULL DEFAULT 'active'
            CHECK (
              status IN (
                'active',
                'suspended'
              )
            ),

          voucher_balance NUMERIC(14,2)
            NOT NULL DEFAULT 0,

          total_funded NUMERIC(14,2)
            NOT NULL DEFAULT 0,

          total_credit_issued NUMERIC(14,2)
            NOT NULL DEFAULT 0,

          total_generated NUMERIC(14,2)
            NOT NULL DEFAULT 0,

          last_login_at TIMESTAMPTZ,

          created_at TIMESTAMPTZ
            NOT NULL DEFAULT NOW(),

          updated_at TIMESTAMPTZ
            NOT NULL DEFAULT NOW()
        )
      `);

      await db.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS
          idx_billing_agents_email
        ON billing_agents (
          client_id,
          LOWER(email)
        )
      `);

      await db.query(`
        CREATE INDEX IF NOT EXISTS
          idx_billing_agents_client
        ON billing_agents (
          client_id,
          created_at DESC
        )
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS
        billing_agent_denominations (
          id BIGSERIAL PRIMARY KEY,

          client_id INTEGER NOT NULL
            REFERENCES clients(id)
            ON DELETE CASCADE,

          face_value NUMERIC(12,2)
            NOT NULL,

          plan_id INTEGER NOT NULL,

          device_limit INTEGER
            NOT NULL DEFAULT 1,

          is_active BOOLEAN
            NOT NULL DEFAULT TRUE,

          created_at TIMESTAMPTZ
            NOT NULL DEFAULT NOW(),

          updated_at TIMESTAMPTZ
            NOT NULL DEFAULT NOW(),

          UNIQUE (
            client_id,
            face_value
          )
        )
      `);

      await db.query(`
        ALTER TABLE
          billing_hotspot_vouchers

        ADD COLUMN IF NOT EXISTS
          agent_id BIGINT
      `);

      await db.query(`
        ALTER TABLE
          billing_hotspot_vouchers

        ADD COLUMN IF NOT EXISTS
          face_value NUMERIC(12,2)
      `);

      await db.query(`
        ALTER TABLE
          billing_hotspot_vouchers

        ADD COLUMN IF NOT EXISTS
          max_devices INTEGER
      `);

      await db.query(`
        ALTER TABLE
          billing_hotspot_vouchers

        ADD COLUMN IF NOT EXISTS
          generation_source VARCHAR(30)
          NOT NULL DEFAULT 'admin'
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS
        billing_agent_wallet_ledger (
          id BIGSERIAL PRIMARY KEY,

          client_id INTEGER NOT NULL
            REFERENCES clients(id)
            ON DELETE CASCADE,

          agent_id BIGINT NOT NULL
            REFERENCES billing_agents(id)
            ON DELETE CASCADE,

          entry_type VARCHAR(40)
            NOT NULL,

          funding_amount NUMERIC(14,2)
            NOT NULL DEFAULT 0,

          credit_delta NUMERIC(14,2)
            NOT NULL DEFAULT 0,

          balance_after NUMERIC(14,2)
            NOT NULL,

          payment_request_id INTEGER,

          voucher_id BIGINT,

          reference VARCHAR(180),

          metadata JSONB
            NOT NULL DEFAULT '{}'::jsonb,

          created_at TIMESTAMPTZ
            NOT NULL DEFAULT NOW()
        )
      `);

      await db.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS
          idx_agent_wallet_payment_once

        ON billing_agent_wallet_ledger (
          payment_request_id
        )

        WHERE payment_request_id
          IS NOT NULL
      `);

      await db.query(`
        CREATE INDEX IF NOT EXISTS
          idx_agent_wallet_agent

        ON billing_agent_wallet_ledger (
          agent_id,
          created_at DESC
        )
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS
        billing_agent_generations (
          id BIGSERIAL PRIMARY KEY,

          client_id INTEGER NOT NULL
            REFERENCES clients(id)
            ON DELETE CASCADE,

          agent_id BIGINT NOT NULL
            REFERENCES billing_agents(id)
            ON DELETE CASCADE,

          voucher_id BIGINT NOT NULL,

          plan_id INTEGER NOT NULL,

          face_value NUMERIC(12,2)
            NOT NULL,

          device_limit INTEGER
            NOT NULL,

          sms_phone VARCHAR(40),

          sms_sent_at TIMESTAMPTZ,

          created_at TIMESTAMPTZ
            NOT NULL DEFAULT NOW()
        )
      `);

      await db.query(`
        CREATE INDEX IF NOT EXISTS
          idx_agent_generations_agent

        ON billing_agent_generations (
          agent_id,
          created_at DESC
        )
      `);
    })().catch(error => {
      schemaPromise = null;
      throw error;
    });
  }

  return schemaPromise;
}

async function ensureClientSettings(
  clientId
) {
  await ensureAgentSchema();

  await db.query(`
    INSERT INTO billing_agent_settings (
      client_id
    )
    VALUES ($1)
    ON CONFLICT (client_id)
    DO NOTHING
  `, [
    clientId,
  ]);

  const result =
    await db.query(`
      SELECT *
      FROM billing_agent_settings
      WHERE client_id = $1
      LIMIT 1
    `, [
      clientId,
    ]);

  return result.rows[0];
}

async function requireBillingAdmin(
  req,
  res,
  next
) {
  try {
    const clientId =
      req.scope?.clientId;

    if (
      !clientId ||
      req.scope?.isSuperadmin
    ) {
      return res.status(403).json({
        error:
          'Billing administrator access required',
      });
    }

    const result =
      await db.query(`
        SELECT account_type
        FROM clients
        WHERE id = $1
        LIMIT 1
      `, [
        clientId,
      ]);

    if (
      result.rows[0]?.account_type !==
      'billing'
    ) {
      return res.status(403).json({
        error:
          'Billing administrator access required',
      });
    }

    await ensureClientSettings(
      clientId
    );

    return next();
  } catch (error) {
    return res.status(500).json({
      error:
        'Could not validate billing administrator',
    });
  }
}

function agentToken(agent) {
  if (!process.env.JWT_SECRET) {
    throw new Error(
      'JWT_SECRET is not configured'
    );
  }

  return jwt.sign(
    {
      kind:
        'billing_agent',

      agent_id:
        agent.id,

      client_id:
        agent.client_id,

      name:
        agent.name,

      email:
        agent.email,
    },

    process.env.JWT_SECRET,

    {
      expiresIn:
        '12h',
    }
  );
}

async function requireAgent(
  req,
  res,
  next
) {
  try {
    const header =
      String(
        req.headers.authorization ||
        ''
      );

    if (
      !header.startsWith(
        'Bearer '
      )
    ) {
      return res.status(401).json({
        error:
          'Agent login required',
      });
    }

    const token =
      header.slice(7);

    const decoded =
      jwt.verify(
        token,
        process.env.JWT_SECRET
      );

    if (
      decoded.kind !==
      'billing_agent'
    ) {
      return res.status(401).json({
        error:
          'Invalid agent session',
      });
    }

    await ensureAgentSchema();

    const result =
      await db.query(`
        SELECT
          agent.*,
          client.name
            AS network_name,
          client.business_name
            AS network_business_name

        FROM billing_agents agent

        JOIN clients client
          ON client.id =
             agent.client_id

        WHERE agent.id = $1
          AND agent.client_id = $2
        LIMIT 1
      `, [
        decoded.agent_id,
        decoded.client_id,
      ]);

    const agent =
      result.rows[0];

    if (
      !agent ||
      agent.status !== 'active'
    ) {
      return res.status(403).json({
        error:
          'This agent account is not active',
      });
    }

    req.agent =
      agent;

    return next();
  } catch (_) {
    return res.status(401).json({
      error:
        'Agent session expired',
    });
  }
}

async function fulfillAgentWalletPayment(
  suppliedPayment
) {
  const suppliedMetadata =
    metadataObject(
      suppliedPayment?.metadata
    );

  if (
    suppliedMetadata.purpose !==
    'agent_wallet'
  ) {
    return null;
  }

  await ensureAgentSchema();

  const connection =
    await db.connect();

  try {
    await connection.query(
      'BEGIN'
    );

    await connection.query(
      `
        SELECT
          pg_advisory_xact_lock(
            hashtext($1)
          )
      `,
      [
        `agent-wallet-payment:${
          suppliedPayment.id
        }`,
      ]
    );

    const paymentResult =
      await connection.query(`
        SELECT *
        FROM payhero_payment_requests
        WHERE id = $1
          AND client_id = $2
        FOR UPDATE
      `, [
        suppliedPayment.id,
        suppliedPayment.client_id,
      ]);

    const payment =
      paymentResult.rows[0];

    if (!payment) {
      await connection.query(
        'ROLLBACK'
      );

      return {
        status:
          'missing',
      };
    }

    if (
      payment.status !== 'paid'
    ) {
      await connection.query(
        'COMMIT'
      );

      return {
        status:
          'pending',

        payment_status:
          payment.status,
      };
    }

    const metadata =
      metadataObject(
        payment.metadata
      );

    if (
      metadata.purpose !==
      'agent_wallet'
    ) {
      await connection.query(
        'COMMIT'
      );

      return null;
    }

    const agentId =
      Number(
        metadata.agent_id
      );

    if (
      !Number.isInteger(agentId) ||
      agentId < 1
    ) {
      throw new Error(
        'Agent wallet payment has invalid metadata'
      );
    }

    const existing =
      await connection.query(`
        SELECT
          id,
          balance_after

        FROM billing_agent_wallet_ledger

        WHERE payment_request_id =
          $1

        LIMIT 1
      `, [
        payment.id,
      ]);

    if (existing.rows[0]) {
      await connection.query(
        'COMMIT'
      );

      return {
        status:
          'already_credited',

        balance:
          Number(
            existing.rows[0]
              .balance_after
          ),
      };
    }

    const agentResult =
      await connection.query(`
        SELECT *
        FROM billing_agents
        WHERE id = $1
          AND client_id = $2
        FOR UPDATE
      `, [
        agentId,
        payment.client_id,
      ]);

    const agent =
      agentResult.rows[0];

    if (!agent) {
      throw new Error(
        'Agent account for this payment no longer exists'
      );
    }

    const fundingAmount =
      money(
        payment.amount
      );

    const bonusPercent =
      Number(
        metadata.bonus_percent ||
        0
      );

    const requestedCredit =
      Number(
        metadata.credit_amount
      );

    const creditAmount =
      Number.isFinite(
        requestedCredit
      )
        ? money(
            requestedCredit
          )
        : money(
            fundingAmount *
            (
              1 +
              bonusPercent / 100
            )
          );

    if (
      fundingAmount <= 0 ||
      creditAmount <= 0
    ) {
      throw new Error(
        'Invalid agent wallet credit'
      );
    }

    const updated =
      await connection.query(`
        UPDATE billing_agents

        SET
          voucher_balance =
            voucher_balance + $1,

          total_funded =
            total_funded + $2,

          total_credit_issued =
            total_credit_issued + $1,

          updated_at =
            NOW()

        WHERE id = $3
          AND client_id = $4

        RETURNING *
      `, [
        creditAmount,
        fundingAmount,
        agent.id,
        payment.client_id,
      ]);

    const balance =
      Number(
        updated.rows[0]
          .voucher_balance
      );

    await connection.query(`
      INSERT INTO
        billing_agent_wallet_ledger
      (
        client_id,
        agent_id,
        entry_type,
        funding_amount,
        credit_delta,
        balance_after,
        payment_request_id,
        reference,
        metadata
      )

      VALUES (
        $1,
        $2,
        'wallet_funding',
        $3,
        $4,
        $5,
        $6,
        $7,
        $8::jsonb
      )
    `, [
      payment.client_id,
      agent.id,
      fundingAmount,
      creditAmount,
      balance,
      payment.id,
      payment.mpesa_receipt_number ||
        payment.external_reference,
      JSON.stringify({
        bonus_percent:
          bonusPercent,

        external_reference:
          payment.external_reference,

        receipt:
          payment.mpesa_receipt_number ||
          null,
      }),
    ]);

    await connection.query(
      'COMMIT'
    );

    return {
      status:
        'credited',

      funding_amount:
        fundingAmount,

      credit_amount:
        creditAmount,

      balance,
    };
  } catch (error) {
    await connection.query(
      'ROLLBACK'
    ).catch(() => {});

    throw error;
  } finally {
    connection.release();
  }
}

async function generateVoucher({
  clientId,
  agentId,
  amount,
}) {
  await ensureAgentSchema();

  const faceValue =
    money(amount);

  if (
    !Number.isFinite(faceValue) ||
    faceValue <= 0
  ) {
    throw new Error(
      'Enter a valid voucher amount'
    );
  }

  const connection =
    await db.connect();

  try {
    await connection.query(
      'BEGIN'
    );

    const agentResult =
      await connection.query(`
        SELECT *
        FROM billing_agents

        WHERE id = $1
          AND client_id = $2

        FOR UPDATE
      `, [
        agentId,
        clientId,
      ]);

    const agent =
      agentResult.rows[0];

    if (
      !agent ||
      agent.status !== 'active'
    ) {
      throw new Error(
        'Agent account is not active'
      );
    }

    const denominationResult =
      await connection.query(`
        SELECT
          denomination.*,

          plan.name
            AS plan_name,

          plan.duration_minutes,

          plan.data_limit_mb,

          plan.mikrotik_rate_limit

        FROM
          billing_agent_denominations
          denomination

        JOIN billing_hotspot_plans
          plan
          ON plan.id =
             denomination.plan_id
         AND plan.client_id =
             denomination.client_id

        WHERE denomination.client_id =
                $1

          AND denomination.face_value =
                $2

          AND denomination.is_active =
                TRUE

          AND plan.is_active =
                TRUE

        LIMIT 1
      `, [
        clientId,
        faceValue,
      ]);

    const denomination =
      denominationResult.rows[0];

    if (!denomination) {
      throw new Error(
        `KES ${faceValue.toLocaleString()} has not been configured as an agent voucher denomination`
      );
    }

    const currentBalance =
      Number(
        agent.voucher_balance ||
        0
      );

    if (
      currentBalance <
      faceValue
    ) {
      throw new Error(
        `Insufficient voucher credit. Available KES ${currentBalance.toLocaleString()}`
      );
    }

    const code = [
      'AG',
      Number(agent.id)
        .toString(36)
        .toUpperCase(),

      crypto
        .randomBytes(4)
        .toString('hex')
        .toUpperCase(),
    ].join('-');

    const voucherResult =
      await connection.query(`
        INSERT INTO
          billing_hotspot_vouchers
        (
          client_id,
          plan_id,
          code,
          status,
          agent_id,
          face_value,
          max_devices,
          generation_source
        )

        VALUES (
          $1,
          $2,
          $3,
          'available',
          $4,
          $5,
          $6,
          'agent'
        )

        RETURNING *
      `, [
        clientId,
        denomination.plan_id,
        code,
        agent.id,
        faceValue,
        denomination.device_limit,
      ]);

    const voucher =
      voucherResult.rows[0];

    const updatedAgent =
      await connection.query(`
        UPDATE billing_agents

        SET
          voucher_balance =
            voucher_balance - $1,

          total_generated =
            total_generated + $1,

          updated_at =
            NOW()

        WHERE id = $2
          AND client_id = $3

        RETURNING *
      `, [
        faceValue,
        agent.id,
        clientId,
      ]);

    const balanceAfter =
      Number(
        updatedAgent.rows[0]
          .voucher_balance
      );

    const generationResult =
      await connection.query(`
        INSERT INTO
          billing_agent_generations
        (
          client_id,
          agent_id,
          voucher_id,
          plan_id,
          face_value,
          device_limit
        )

        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6
        )

        RETURNING *
      `, [
        clientId,
        agent.id,
        voucher.id,
        denomination.plan_id,
        faceValue,
        denomination.device_limit,
      ]);

    await connection.query(`
      INSERT INTO
        billing_agent_wallet_ledger
      (
        client_id,
        agent_id,
        entry_type,
        funding_amount,
        credit_delta,
        balance_after,
        voucher_id,
        reference,
        metadata
      )

      VALUES (
        $1,
        $2,
        'voucher_generation',
        0,
        $3,
        $4,
        $5,
        $6,
        $7::jsonb
      )
    `, [
      clientId,
      agent.id,
      -faceValue,
      balanceAfter,
      voucher.id,
      voucher.code,
      JSON.stringify({
        plan_id:
          denomination.plan_id,

        plan_name:
          denomination.plan_name,

        device_limit:
          denomination.device_limit,

        duration_minutes:
          denomination.duration_minutes,
      }),
    ]);

    await connection.query(
      'COMMIT'
    );

    return {
      generation_id:
        generationResult.rows[0].id,

      voucher_id:
        voucher.id,

      code:
        voucher.code,

      amount:
        faceValue,

      plan_id:
        denomination.plan_id,

      plan_name:
        denomination.plan_name,

      duration_minutes:
        Number(
          denomination.duration_minutes
        ),

      device_limit:
        Number(
          denomination.device_limit
        ),

      data_limit_mb:
        denomination.data_limit_mb,

      rate_limit:
        denomination.mikrotik_rate_limit,

      balance:
        balanceAfter,
    };
  } catch (error) {
    await connection.query(
      'ROLLBACK'
    ).catch(() => {});

    throw error;
  } finally {
    connection.release();
  }
}


adminRouter.use(
  authMiddleware,
  scopeMiddleware,
  requireBillingAdmin
);


adminRouter.get(
  '/summary',
  async (req, res) => {
    try {
      const clientId =
        req.scope.clientId;

      const result =
        await db.query(`
          SELECT
            COUNT(*)::int
              AS total_agents,

            COUNT(*) FILTER (
              WHERE status = 'active'
            )::int
              AS active_agents,

            COALESCE(
              SUM(voucher_balance),
              0
            )::numeric
              AS outstanding_credit,

            COALESCE(
              SUM(total_funded),
              0
            )::numeric
              AS total_funded,

            COALESCE(
              SUM(total_credit_issued),
              0
            )::numeric
              AS total_credit_issued,

            COALESCE(
              SUM(total_generated),
              0
            )::numeric
              AS total_generated

          FROM billing_agents

          WHERE client_id = $1
        `, [
          clientId,
        ]);

      const vouchers =
        await db.query(`
          SELECT
            COUNT(*)::int
              AS vouchers_generated,

            COUNT(*) FILTER (
              WHERE sms_sent_at
                IS NOT NULL
            )::int
              AS vouchers_shared_sms

          FROM billing_agent_generations

          WHERE client_id = $1
        `, [
          clientId,
        ]);

      return res.json({
        ...result.rows[0],
        ...vouchers.rows[0],
      });
    } catch (error) {
      return res.status(500).json({
        error:
          'Could not load agent statistics',
      });
    }
  }
);


adminRouter.get(
  '/',
  async (req, res) => {
    try {
      const result =
        await db.query(`
          SELECT
            agent.*,

            (
              SELECT COUNT(*)::int
              FROM billing_agent_generations
              generation
              WHERE generation.agent_id =
                agent.id
            ) AS vouchers_generated

          FROM billing_agents
            agent

          WHERE agent.client_id =
            $1

          ORDER BY
            agent.created_at DESC
        `, [
          req.scope.clientId,
        ]);

      return res.json(
        result.rows
      );
    } catch (error) {
      return res.status(500).json({
        error:
          'Could not load agents',
      });
    }
  }
);


adminRouter.post(
  '/',
  async (req, res) => {
    try {
      const name =
        String(
          req.body.name || ''
        ).trim();

      const businessName =
        String(
          req.body.business_name ||
          ''
        ).trim();

      const email =
        normalizeEmail(
          req.body.email
        );

      const phone =
        normalizeKenyanPhone(
          req.body.phone
        );

      const password =
        String(
          req.body.password || ''
        );

      if (!name) {
        return res.status(400).json({
          error:
            'Agent name is required',
        });
      }

      if (
        !email ||
        !email.includes('@')
      ) {
        return res.status(400).json({
          error:
            'Enter a valid agent email address',
        });
      }

      if (
        !/^254[17]\d{8}$/
          .test(phone)
      ) {
        return res.status(400).json({
          error:
            'Enter a valid Kenyan agent phone number',
        });
      }

      if (
        password.length < 8
      ) {
        return res.status(400).json({
          error:
            'Agent password must contain at least 8 characters',
        });
      }

      const passwordHash =
        await bcrypt.hash(
          password,
          12
        );

      const result =
        await db.query(`
          INSERT INTO billing_agents
          (
            client_id,
            name,
            business_name,
            email,
            phone,
            password_hash
          )

          VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6
          )

          RETURNING
            id,
            client_id,
            name,
            business_name,
            email,
            phone,
            status,
            voucher_balance,
            total_funded,
            total_generated,
            created_at
        `, [
          req.scope.clientId,
          name,
          businessName || null,
          email,
          phone,
          passwordHash,
        ]);

      return res
        .status(201)
        .json(
          result.rows[0]
        );
    } catch (error) {
      if (
        error.code ===
        '23505'
      ) {
        return res.status(409).json({
          error:
            'An agent with that email already exists',
        });
      }

      console.error(
        'Create billing agent error:',
        error.message
      );

      return res.status(500).json({
        error:
          'Could not create agent',
      });
    }
  }
);


adminRouter.patch(
  '/:id',
  async (req, res) => {
    try {
      const agentId =
        Number(
          req.params.id
        );

      const existing =
        await db.query(`
          SELECT *
          FROM billing_agents

          WHERE id = $1
            AND client_id = $2

          LIMIT 1
        `, [
          agentId,
          req.scope.clientId,
        ]);

      if (!existing.rows[0]) {
        return res.status(404).json({
          error:
            'Agent not found',
        });
      }

      const updates = [];
      const params = [];

      function add(
        expression,
        value
      ) {
        params.push(value);

        updates.push(
          expression.replace(
            '?',
            `$${params.length}`
          )
        );
      }

      if (
        req.body.status !==
        undefined
      ) {
        const status =
          String(
            req.body.status
          );

        if (
          ![
            'active',
            'suspended',
          ].includes(status)
        ) {
          return res.status(400).json({
            error:
              'Invalid agent status',
          });
        }

        add(
          'status = ?',
          status
        );
      }

      if (
        req.body.password
      ) {
        const password =
          String(
            req.body.password
          );

        if (
          password.length < 8
        ) {
          return res.status(400).json({
            error:
              'Password must contain at least 8 characters',
          });
        }

        add(
          'password_hash = ?',
          await bcrypt.hash(
            password,
            12
          )
        );
      }

      if (!updates.length) {
        return res.json(
          existing.rows[0]
        );
      }

      params.push(
        agentId,
        req.scope.clientId
      );

      const result =
        await db.query(`
          UPDATE billing_agents

          SET
            ${updates.join(', ')},
            updated_at = NOW()

          WHERE id =
            $${params.length - 1}

            AND client_id =
            $${params.length}

          RETURNING
            id,
            name,
            business_name,
            email,
            phone,
            status,
            voucher_balance,
            total_funded,
            total_credit_issued,
            total_generated,
            updated_at
        `, params);

      return res.json(
        result.rows[0]
      );
    } catch (error) {
      return res.status(500).json({
        error:
          'Could not update agent',
      });
    }
  }
);


adminRouter.get(
  '/settings',
  async (req, res) => {
    try {
      const clientId =
        req.scope.clientId;

      const settings =
        await ensureClientSettings(
          clientId
        );

      const [
        denominations,
        plans,
      ] = await Promise.all([
        db.query(`
          SELECT
            denomination.*,

            plan.name
              AS plan_name,

            plan.duration_minutes,

            plan.price
              AS normal_price

          FROM
            billing_agent_denominations
            denomination

          LEFT JOIN
            billing_hotspot_plans
            plan

            ON plan.id =
               denomination.plan_id

           AND plan.client_id =
               denomination.client_id

          WHERE denomination.client_id =
            $1

          ORDER BY
            denomination.face_value ASC
        `, [
          clientId,
        ]),

        db.query(`
          SELECT
            id,
            name,
            price,
            duration_minutes,
            mikrotik_rate_limit

          FROM billing_hotspot_plans

          WHERE client_id = $1
            AND is_active = TRUE

          ORDER BY
            price ASC,
            duration_minutes ASC
        `, [
          clientId,
        ]),
      ]);

      const origin =
        String(
          process.env.FRONTEND_URL ||
          process.env.PUBLIC_BACKEND_URL ||
          'https://nexa.telenexustechnologies.com'
        ).replace(/\/$/, '');

      return res.json({
        settings,
        denominations:
          denominations.rows,

        plans:
          plans.rows,

        portal_url:
          `${origin}/agent`,
      });
    } catch (error) {
      console.error(
        'Agent settings error:',
        error.message
      );

      return res.status(500).json({
        error:
          'Could not load agent settings',
      });
    }
  }
);


adminRouter.put(
  '/settings',
  async (req, res) => {
    try {
      const bonusPercent =
        Number(
          req.body.bonus_percent
        );

      const devices =
        Number(
          req.body.default_device_limit
        );

      const minimum =
        Number(
          req.body.minimum_funding_amount
        );

      const maximum =
        Number(
          req.body.maximum_funding_amount
        );

      if (
        !Number.isFinite(
          bonusPercent
        ) ||
        bonusPercent < 0 ||
        bonusPercent > 500
      ) {
        return res.status(400).json({
          error:
            'Bonus percentage must be between 0% and 500%',
        });
      }

      if (
        !Number.isInteger(devices) ||
        devices < 1 ||
        devices > 50
      ) {
        return res.status(400).json({
          error:
            'Default devices must be between 1 and 50',
        });
      }

      if (
        !Number.isInteger(minimum) ||
        minimum < 10
      ) {
        return res.status(400).json({
          error:
            'Minimum funding amount must be at least KES 10',
        });
      }

      if (
        !Number.isInteger(maximum) ||
        maximum < minimum ||
        maximum > 500000
      ) {
        return res.status(400).json({
          error:
            'Maximum funding amount is invalid',
        });
      }

      const result =
        await db.query(`
          INSERT INTO
            billing_agent_settings
          (
            client_id,
            bonus_percent,
            default_device_limit,
            minimum_funding_amount,
            maximum_funding_amount,
            sms_enabled,
            updated_at
          )

          VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            NOW()
          )

          ON CONFLICT (client_id)
          DO UPDATE SET
            bonus_percent =
              EXCLUDED.bonus_percent,

            default_device_limit =
              EXCLUDED.default_device_limit,

            minimum_funding_amount =
              EXCLUDED.minimum_funding_amount,

            maximum_funding_amount =
              EXCLUDED.maximum_funding_amount,

            sms_enabled =
              EXCLUDED.sms_enabled,

            updated_at =
              NOW()

          RETURNING *
        `, [
          req.scope.clientId,
          bonusPercent,
          devices,
          minimum,
          maximum,
          req.body.sms_enabled !==
            false,
        ]);

      return res.json(
        result.rows[0]
      );
    } catch (error) {
      return res.status(500).json({
        error:
          'Could not save agent settings',
      });
    }
  }
);


adminRouter.post(
  '/denominations',
  async (req, res) => {
    try {
      const faceValue =
        money(
          req.body.face_value
        );

      const planId =
        Number(
          req.body.plan_id
        );

      const deviceLimit =
        Number(
          req.body.device_limit
        );

      if (
        !Number.isFinite(
          faceValue
        ) ||
        faceValue < 1
      ) {
        return res.status(400).json({
          error:
            'Enter a valid voucher value',
        });
      }

      if (
        !Number.isInteger(
          planId
        ) ||
        planId < 1
      ) {
        return res.status(400).json({
          error:
            'Choose a hotspot package',
        });
      }

      if (
        !Number.isInteger(
          deviceLimit
        ) ||
        deviceLimit < 1 ||
        deviceLimit > 50
      ) {
        return res.status(400).json({
          error:
            'Device limit must be between 1 and 50',
        });
      }

      const plan =
        await db.query(`
          SELECT id
          FROM billing_hotspot_plans

          WHERE id = $1
            AND client_id = $2
            AND is_active = TRUE

          LIMIT 1
        `, [
          planId,
          req.scope.clientId,
        ]);

      if (!plan.rows[0]) {
        return res.status(400).json({
          error:
            'Choose an active hotspot package',
        });
      }

      const result =
        await db.query(`
          INSERT INTO
            billing_agent_denominations
          (
            client_id,
            face_value,
            plan_id,
            device_limit,
            is_active,
            updated_at
          )

          VALUES (
            $1,
            $2,
            $3,
            $4,
            TRUE,
            NOW()
          )

          ON CONFLICT (
            client_id,
            face_value
          )

          DO UPDATE SET
            plan_id =
              EXCLUDED.plan_id,

            device_limit =
              EXCLUDED.device_limit,

            is_active =
              TRUE,

            updated_at =
              NOW()

          RETURNING *
        `, [
          req.scope.clientId,
          faceValue,
          planId,
          deviceLimit,
        ]);

      return res.json(
        result.rows[0]
      );
    } catch (error) {
      return res.status(500).json({
        error:
          'Could not save voucher denomination',
      });
    }
  }
);


adminRouter.delete(
  '/denominations/:id',
  async (req, res) => {
    try {
      const result =
        await db.query(`
          DELETE FROM
            billing_agent_denominations

          WHERE id = $1
            AND client_id = $2

          RETURNING id
        `, [
          req.params.id,
          req.scope.clientId,
        ]);

      if (!result.rows[0]) {
        return res.status(404).json({
          error:
            'Voucher denomination not found',
        });
      }

      return res.json({
        deleted:
          true,
      });
    } catch (error) {
      return res.status(500).json({
        error:
          'Could not delete denomination',
      });
    }
  }
);


portalRouter.post(
  '/login',
  async (req, res) => {
    try {
      await ensureAgentSchema();

      const identity =
        String(
          req.body.identity ||
          ''
        ).trim();

      const password =
        String(
          req.body.password ||
          ''
        );

      const email =
        normalizeEmail(
          identity
        );

      const phone =
        normalizeKenyanPhone(
          identity
        );

      const result =
        await db.query(`
          SELECT
            agent.*,

            client.name
              AS network_name,

            client.business_name
              AS network_business_name

          FROM billing_agents agent

          JOIN clients client
            ON client.id =
               agent.client_id

          WHERE
            LOWER(agent.email) =
              LOWER($1)

            OR agent.phone =
              $2

          LIMIT 1
        `, [
          email,
          phone,
        ]);

      const agent =
        result.rows[0];

      if (!agent) {
        return res.status(401).json({
          error:
            'Invalid agent credentials',
        });
      }

      if (
        agent.status !==
        'active'
      ) {
        return res.status(403).json({
          error:
            'This agent account is suspended',
        });
      }

      const valid =
        await bcrypt.compare(
          password,
          agent.password_hash
        );

      if (!valid) {
        return res.status(401).json({
          error:
            'Invalid agent credentials',
        });
      }

      await db.query(`
        UPDATE billing_agents
        SET last_login_at = NOW()
        WHERE id = $1
      `, [
        agent.id,
      ]);

      return res.json({
        token:
          agentToken(agent),

        agent: {
          id:
            agent.id,

          name:
            agent.name,

          business_name:
            agent.business_name,

          email:
            agent.email,

          phone:
            agent.phone,

          network_name:
            agent.network_business_name ||
            agent.network_name,
        },
      });
    } catch (error) {
      console.error(
        'Agent login error:',
        error.message
      );

      return res.status(500).json({
        error:
          'Could not sign in',
      });
    }
  }
);


portalRouter.use(
  requireAgent
);


portalRouter.get(
  '/dashboard',
  async (req, res) => {
    try {
      const [
        settings,
        denominations,
        generations,
        ledger,
      ] = await Promise.all([
        ensureClientSettings(
          req.agent.client_id
        ),

        db.query(`
          SELECT
            denomination.id,
            denomination.face_value,
            denomination.device_limit,
            denomination.plan_id,

            plan.name
              AS plan_name,

            plan.duration_minutes,

            plan.mikrotik_rate_limit

          FROM
            billing_agent_denominations
            denomination

          JOIN billing_hotspot_plans
            plan
            ON plan.id =
               denomination.plan_id

           AND plan.client_id =
               denomination.client_id

          WHERE denomination.client_id =
                  $1

            AND denomination.is_active =
                  TRUE

            AND plan.is_active =
                  TRUE

          ORDER BY
            denomination.face_value ASC
        `, [
          req.agent.client_id,
        ]),

        db.query(`
          SELECT
            generation.*,

            voucher.code,
            voucher.status
              AS voucher_status,

            plan.name
              AS plan_name,

            plan.duration_minutes

          FROM
            billing_agent_generations
            generation

          JOIN billing_hotspot_vouchers
            voucher
            ON voucher.id =
               generation.voucher_id

          JOIN billing_hotspot_plans
            plan
            ON plan.id =
               generation.plan_id

          WHERE generation.agent_id =
            $1

          ORDER BY
            generation.created_at DESC

          LIMIT 50
        `, [
          req.agent.id,
        ]),

        db.query(`
          SELECT *
          FROM billing_agent_wallet_ledger

          WHERE agent_id = $1

          ORDER BY
            created_at DESC

          LIMIT 50
        `, [
          req.agent.id,
        ]),
      ]);

      const agent =
        await db.query(`
          SELECT
            id,
            name,
            business_name,
            email,
            phone,
            voucher_balance,
            total_funded,
            total_credit_issued,
            total_generated,
            created_at

          FROM billing_agents

          WHERE id = $1
          LIMIT 1
        `, [
          req.agent.id,
        ]);

      return res.json({
        agent:
          agent.rows[0],

        network: {
          name:
            req.agent.network_business_name ||
            req.agent.network_name,
        },

        settings: {
          bonus_percent:
            Number(
              settings.bonus_percent
            ),

          minimum_funding_amount:
            Number(
              settings.minimum_funding_amount
            ),

          maximum_funding_amount:
            Number(
              settings.maximum_funding_amount
            ),

          sms_enabled:
            settings.sms_enabled ===
            true,
        },

        denominations:
          denominations.rows,

        generations:
          generations.rows,

        ledger:
          ledger.rows,

        statistics: {
          voucher_count:
            generations.rowCount,

          sms_shared:
            generations.rows.filter(
              row =>
                row.sms_sent_at
            ).length,
        },
      });
    } catch (error) {
      console.error(
        'Agent dashboard error:',
        error.message
      );

      return res.status(500).json({
        error:
          'Could not load agent dashboard',
      });
    }
  }
);


portalRouter.post(
  '/wallet/fund',
  async (req, res) => {
    try {
      const amount =
        Number(
          req.body.amount
        );

      if (
        !Number.isInteger(amount)
      ) {
        return res.status(400).json({
          error:
            'Wallet funding amount must be a whole KES amount',
        });
      }

      const settings =
        await ensureClientSettings(
          req.agent.client_id
        );

      const minimum =
        Number(
          settings.minimum_funding_amount
        );

      const maximum =
        Number(
          settings.maximum_funding_amount
        );

      if (
        amount < minimum ||
        amount > maximum
      ) {
        return res.status(400).json({
          error:
            `Wallet funding must be between KES ${minimum.toLocaleString()} and KES ${maximum.toLocaleString()}`,
        });
      }

      const phone =
        cleanPhone(
          req.body.phone ||
          req.agent.phone
        );

      if (
        !/^254[17]\d{8}$/
          .test(phone)
      ) {
        return res.status(400).json({
          error:
            'Enter a valid Safaricom M-Pesa number',
        });
      }

      const bonusPercent =
        Number(
          settings.bonus_percent ||
          0
        );

      const creditAmount =
        money(
          amount *
          (
            1 +
            bonusPercent / 100
          )
        );

      const clientResult =
        await db.query(`
          SELECT
            id,
            name,
            business_name

          FROM clients

          WHERE id = $1
            AND account_type =
              'billing'

          LIMIT 1
        `, [
          req.agent.client_id,
        ]);

      const client =
        clientResult.rows[0];

      if (!client) {
        return res.status(404).json({
          error:
            'Network account not found',
        });
      }

      const payment =
        await initiatePayHeroPayment({
          client,

          conversationId:
            null,

          customerPhone:
            phone,

          customerName:
            `${req.agent.name} agent wallet`,

          amount,

          metadata: {
            purpose:
              'agent_wallet',

            agent_id:
              req.agent.id,

            funding_amount:
              amount,

            bonus_percent:
              bonusPercent,

            credit_amount:
              creditAmount,
          },
        });

      if (!payment.success) {
        return res.status(502).json({
          error:
            payment.error ||
            'Could not send M-Pesa prompt',
        });
      }

      return res.json({
        success:
          true,

        reference:
          payment.externalReference,

        funding_amount:
          amount,

        bonus_percent:
          bonusPercent,

        credit_amount:
          creditAmount,

        status:
          payment.status,
      });
    } catch (error) {
      console.error(
        'Agent funding error:',
        error.message
      );

      return res.status(500).json({
        error:
          'Could not fund agent wallet',
      });
    }
  }
);


portalRouter.get(
  '/wallet/funding/:reference',
  async (req, res) => {
    try {
      const result =
        await db.query(`
          SELECT *
          FROM payhero_payment_requests

          WHERE client_id = $1
            AND external_reference = $2
            AND metadata->>'purpose' =
                'agent_wallet'

            AND metadata->>'agent_id' =
                $3

          LIMIT 1
        `, [
          req.agent.client_id,
          req.params.reference,
          String(req.agent.id),
        ]);

      const payment =
        result.rows[0];

      if (!payment) {
        return res.status(404).json({
          error:
            'Wallet funding request not found',
        });
      }

      let fulfillment =
        null;

      if (
        payment.status ===
        'paid'
      ) {
        fulfillment =
          await fulfillAgentWalletPayment(
            payment
          );
      }

      const agent =
        await db.query(`
          SELECT voucher_balance
          FROM billing_agents
          WHERE id = $1
          LIMIT 1
        `, [
          req.agent.id,
        ]);

      return res.json({
        status:
          payment.status,

        receipt:
          payment.mpesa_receipt_number,

        result_description:
          payment.result_description,

        balance:
          Number(
            agent.rows[0]
              ?.voucher_balance ||
            0
          ),

        fulfillment,
      });
    } catch (error) {
      return res.status(500).json({
        error:
          'Could not check wallet funding',
      });
    }
  }
);


portalRouter.post(
  '/vouchers/generate',
  async (req, res) => {
    try {
      const generated =
        await generateVoucher({
          clientId:
            req.agent.client_id,

          agentId:
            req.agent.id,

          amount:
            req.body.amount,
        });

      return res
        .status(201)
        .json(generated);
    } catch (error) {
      return res.status(400).json({
        error:
          error.message ||
          'Could not generate voucher',
      });
    }
  }
);


portalRouter.post(
  '/vouchers/:id/sms',
  async (req, res) => {
    try {
      const settings =
        await ensureClientSettings(
          req.agent.client_id
        );

      if (
        settings.sms_enabled !==
        true
      ) {
        return res.status(403).json({
          error:
            'Voucher SMS sharing is disabled by the administrator',
        });
      }

      const phone =
        normalizeKenyanPhone(
          req.body.phone
        );

      if (
        !/^254[17]\d{8}$/
          .test(phone)
      ) {
        return res.status(400).json({
          error:
            'Enter a valid recipient phone number',
        });
      }

      const result =
        await db.query(`
          SELECT
            generation.*,

            voucher.code,

            plan.name
              AS plan_name,

            plan.duration_minutes,

            client.*

          FROM
            billing_agent_generations
            generation

          JOIN billing_hotspot_vouchers
            voucher
            ON voucher.id =
               generation.voucher_id

          JOIN billing_hotspot_plans
            plan
            ON plan.id =
               generation.plan_id

          JOIN clients client
            ON client.id =
               generation.client_id

          WHERE generation.id = $1
            AND generation.agent_id = $2
            AND generation.client_id = $3

          LIMIT 1
        `, [
          req.params.id,
          req.agent.id,
          req.agent.client_id,
        ]);

      const voucher =
        result.rows[0];

      if (!voucher) {
        return res.status(404).json({
          error:
            'Generated voucher not found',
        });
      }

      if (
        !hasSMSConfig({
          client:
            voucher,
        })
      ) {
        return res.status(503).json({
          error:
            'The network SMS provider has not been configured',
        });
      }

      const duration =
        Number(
          voucher.duration_minutes
        );

      const durationText =
        duration % 1440 === 0
          ? `${
              duration / 1440
            } day(s)`

          : duration % 60 === 0
            ? `${
                duration / 60
              } hour(s)`

            : `${duration} minutes`;

      const message = [
        req.agent.network_business_name ||
          req.agent.network_name ||
          'Internet Voucher',

        `Voucher: ${voucher.code}`,

        `Value: KES ${Number(
          voucher.face_value
        ).toLocaleString()}`,

        `Package: ${voucher.plan_name}`,

        `Time: ${durationText}`,

        `Devices: ${voucher.device_limit}`,

        'Enter this voucher on the hotspot login page.',
      ].join('\n');

      await sendSMS(
        phone,
        message,
        {
          client:
            voucher,
        }
      );

      await db.query(`
        UPDATE billing_agent_generations

        SET
          sms_phone = $1,
          sms_sent_at = NOW()

        WHERE id = $2
          AND agent_id = $3
      `, [
        phone,
        voucher.id,
        req.agent.id,
      ]);

      return res.json({
        sent:
          true,

        phone,
      });
    } catch (error) {
      console.error(
        'Agent voucher SMS error:',
        error.message
      );

      return res.status(500).json({
        error:
          error.message ||
          'Could not send voucher by SMS',
      });
    }
  }
);


module.exports = {
  adminRouter,
  portalRouter,
  ensureAgentSchema,
  fulfillAgentWalletPayment,
};

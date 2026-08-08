const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const db = require('../db');

const {
  authMiddleware,
  scopeMiddleware,
} = require('../middleware/auth');

const {
  cleanPhone,
  ensurePayHeroSchema,
  initiatePayHeroPayment,
  loadPayHeroConfig,
} = require('../services/payhero');

const {
  getSubscriberUsage,
} = require('../services/radiusSync');

const {
  enqueueRadiusSyncJob,
  processRadiusSyncJobs,
} = require('../services/radiusJobs');


const adminRouter =
  express.Router();

const portalRouter =
  express.Router();

let schemaPromise = null;
let scheduler = null;


function integer(
  value
) {
  const result =
    Number(value);

  return Number.isInteger(
    result
  )
    ? result
    : null;
}


function moneyNumber(
  value
) {
  const result =
    Number(value);

  return Number.isFinite(
    result
  )
    ? result
    : 0;
}


function normalEmail(
  value
) {
  return String(
    value || ''
  )
    .trim()
    .toLowerCase();
}


async function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise =
      (async () => {
        await ensurePayHeroSchema();


        await db.query(`
          CREATE TABLE IF NOT EXISTS
          billing_pppoe_portal_accounts (
            id BIGSERIAL PRIMARY KEY,

            client_id INTEGER
              NOT NULL,

            subscriber_id BIGINT
              NOT NULL,

            login VARCHAR(160)
              NOT NULL,

            password_hash TEXT
              NOT NULL,

            enabled BOOLEAN
              NOT NULL
              DEFAULT TRUE,

            last_login_at
              TIMESTAMPTZ,

            created_at
              TIMESTAMPTZ
              NOT NULL
              DEFAULT NOW(),

            updated_at
              TIMESTAMPTZ
              NOT NULL
              DEFAULT NOW(),

            UNIQUE (
              client_id,
              subscriber_id
            )
          )
        `);


        await db.query(`
          CREATE UNIQUE INDEX
          IF NOT EXISTS
          idx_pppoe_portal_login

          ON billing_pppoe_portal_accounts (
            client_id,
            LOWER(login)
          )
        `);


        await db.query(`
          CREATE TABLE IF NOT EXISTS
          billing_pppoe_portal_payments (
            id BIGSERIAL PRIMARY KEY,

            client_id INTEGER
              NOT NULL,

            subscriber_id BIGINT
              NOT NULL,

            payment_request_id
              INTEGER,

            external_reference
              VARCHAR(160)
              NOT NULL,

            target_plan_id BIGINT
              NOT NULL,

            action VARCHAR(30)
              NOT NULL,

            amount INTEGER
              NOT NULL,

            status VARCHAR(40)
              NOT NULL
              DEFAULT 'initiated',

            mpesa_receipt_number
              VARCHAR(120),

            applied_at
              TIMESTAMPTZ,

            created_at
              TIMESTAMPTZ
              NOT NULL
              DEFAULT NOW(),

            updated_at
              TIMESTAMPTZ
              NOT NULL
              DEFAULT NOW(),

            metadata JSONB
              NOT NULL
              DEFAULT '{}'::jsonb,

            UNIQUE (
              external_reference
            )
          )
        `);


        await db.query(`
          CREATE UNIQUE INDEX
          IF NOT EXISTS
          idx_pppoe_portal_payment_request

          ON billing_pppoe_portal_payments (
            payment_request_id
          )

          WHERE payment_request_id
            IS NOT NULL
        `);


        await db.query(`
          CREATE TABLE IF NOT EXISTS
          billing_pppoe_pause_events (
            id BIGSERIAL PRIMARY KEY,

            client_id INTEGER
              NOT NULL,

            subscriber_id BIGINT
              NOT NULL,

            started_at
              TIMESTAMPTZ
              NOT NULL
              DEFAULT NOW(),

            scheduled_resume_at
              TIMESTAMPTZ
              NOT NULL,

            resumed_at
              TIMESTAMPTZ,

            requested_days
              INTEGER
              NOT NULL,

            previous_status
              VARCHAR(40)
              NOT NULL
              DEFAULT 'active',

            status VARCHAR(30)
              NOT NULL
              DEFAULT 'active',

            created_at
              TIMESTAMPTZ
              NOT NULL
              DEFAULT NOW()
          )
        `);


        await db.query(`
          CREATE INDEX IF NOT EXISTS
          idx_pppoe_pause_due

          ON billing_pppoe_pause_events (
            status,
            scheduled_resume_at
          )
        `);


        await db.query(`
          CREATE TABLE IF NOT EXISTS
          billing_pppoe_traffic_usage (
            id BIGSERIAL PRIMARY KEY,

            client_id INTEGER
              NOT NULL,

            subscriber_id BIGINT
              NOT NULL,

            bucket_start
              TIMESTAMPTZ
              NOT NULL,

            category VARCHAR(80)
              NOT NULL,

            application VARCHAR(120)
              NOT NULL,

            upload_bytes BIGINT
              NOT NULL
              DEFAULT 0,

            download_bytes BIGINT
              NOT NULL
              DEFAULT 0,

            source VARCHAR(80)
              NOT NULL
              DEFAULT 'dpi',

            created_at
              TIMESTAMPTZ
              NOT NULL
              DEFAULT NOW()
          )
        `);


        await db.query(`
          CREATE INDEX IF NOT EXISTS
          idx_pppoe_traffic_subscriber

          ON billing_pppoe_traffic_usage (
            client_id,
            subscriber_id,
            bucket_start DESC
          )
        `);
      })()
      .catch(
        error => {
          schemaPromise =
            null;

          throw error;
        }
      );
  }

  return schemaPromise;
}


function signToken(
  account
) {
  if (
    !process.env.JWT_SECRET
  ) {
    throw new Error(
      'JWT_SECRET is not configured'
    );
  }

  return jwt.sign(
    {
      kind:
        'pppoe_portal',

      portal_account_id:
        account.portal_account_id,

      client_id:
        account.client_id,

      subscriber_id:
        account.subscriber_id,
    },

    process.env.JWT_SECRET,

    {
      expiresIn:
        '12h',
    }
  );
}


async function getPortalContext(
  token
) {
  const decoded =
    jwt.verify(
      token,
      process.env.JWT_SECRET
    );

  if (
    decoded.kind !==
    'pppoe_portal'
  ) {
    throw new Error(
      'Invalid customer portal session'
    );
  }

  await ensureSchema();

  const result =
    await db.query(`
      SELECT
        subscriber.*,

        account.id
          AS portal_account_id,

        account.login
          AS portal_login,

        account.password_hash
          AS portal_password_hash,

        account.enabled
          AS portal_enabled,

        client.name
          AS network_name,

        client.business_name
          AS network_business_name

      FROM billing_pppoe_portal_accounts
        account

      JOIN billing_subscribers
        subscriber

        ON subscriber.id =
           account.subscriber_id

       AND subscriber.client_id =
           account.client_id

      JOIN clients
        client

        ON client.id =
           account.client_id

      WHERE account.id = $1
        AND account.client_id = $2
        AND account.subscriber_id = $3
        AND account.enabled = TRUE
        AND client.account_type =
            'billing'

      LIMIT 1
    `, [
      decoded.portal_account_id,
      decoded.client_id,
      decoded.subscriber_id,
    ]);

  if (
    !result.rows[0]
  ) {
    const error =
      new Error(
        'Customer portal access is no longer active'
      );

    error.status =
      401;

    throw error;
  }

  return result.rows[0];
}


async function portalAuth(
  req,
  res,
  next
) {
  try {
    const authorization =
      String(
        req.headers
          .authorization ||
        ''
      );

    if (
      !authorization
        .startsWith(
          'Bearer '
        )
    ) {
      return res
        .status(401)
        .json({
          error:
            'Login required',
        });
    }

    req.pppoe =
      await getPortalContext(
        authorization.slice(
          7
        )
      );

    return next();
  } catch (
    error
  ) {
    return res
      .status(
        error.status ||
        401
      )
      .json({
        error:
          error.message ||
          'Portal session expired',
      });
  }
}


async function requireBillingAdmin(
  req,
  res,
  next
) {
  if (
    req.scope
      .isSuperadmin ||
    !req.scope.clientId
  ) {
    return res
      .status(403)
      .json({
        error:
          'Billing workspace access required',
      });
  }

  const result =
    await db.query(`
      SELECT
        id

      FROM clients

      WHERE id = $1
        AND account_type =
            'billing'

      LIMIT 1
    `, [
      req.scope.clientId,
    ]);

  if (!result.rows[0]) {
    return res
      .status(403)
      .json({
        error:
          'Billing workspace access required',
      });
  }

  return next();
}


async function adminSubscriber(
  subscriberId,
  clientId
) {
  const result =
    await db.query(`
      SELECT
        id,
        client_id,
        full_name,
        phone,
        email,
        account_number,
        radius_username,
        access_mode,
        service_status

      FROM billing_subscribers

      WHERE id = $1
        AND client_id = $2

        AND COALESCE(
          access_mode,
          'pppoe'
        ) IN (
          'pppoe',
          'pppoe_static'
        )

      LIMIT 1
    `, [
      subscriberId,
      clientId,
    ]);

  return (
    result.rows[0] ||
    null
  );
}


adminRouter.use(
  authMiddleware,
  scopeMiddleware,
  requireBillingAdmin
);


adminRouter.get(
  '/subscribers/:id/access',
  async (
    req,
    res
  ) => {
    try {
      await ensureSchema();

      const subscriber =
        await adminSubscriber(
          req.params.id,
          req.scope.clientId
        );

      if (!subscriber) {
        return res
          .status(404)
          .json({
            error:
              'PPPoE subscriber not found',
          });
      }

      const result =
        await db.query(`
          SELECT
            id,
            login,
            enabled,
            last_login_at,
            created_at,
            updated_at

          FROM billing_pppoe_portal_accounts

          WHERE client_id = $1
            AND subscriber_id = $2

          LIMIT 1
        `, [
          req.scope.clientId,
          subscriber.id,
        ]);

      const account =
        result.rows[0] ||
        null;

      return res.json({
        subscriber: {
          id:
            subscriber.id,

          full_name:
            subscriber.full_name,

          account_number:
            subscriber.account_number,
        },

        account,

        suggested_login:
          account?.login ||
          subscriber.account_number ||
          subscriber.radius_username ||
          '',

        portal_url:
          '/pppoe',
      });
    } catch (
      error
    ) {
      console.error(
        'PPPoE portal access load error:',
        error.message
      );

      return res
        .status(500)
        .json({
          error:
            'Could not load customer portal access',
        });
    }
  }
);


adminRouter.put(
  '/subscribers/:id/access',
  async (
    req,
    res
  ) => {
    try {
      await ensureSchema();

      const subscriber =
        await adminSubscriber(
          req.params.id,
          req.scope.clientId
        );

      if (!subscriber) {
        return res
          .status(404)
          .json({
            error:
              'PPPoE subscriber not found',
          });
      }

      const login =
        String(
          req.body.login ||
          subscriber.account_number ||
          subscriber.radius_username ||
          ''
        )
          .trim()
          .slice(
            0,
            160
          );

      const password =
        String(
          req.body.password ||
          ''
        );

      const enabled =
        req.body.enabled !==
        false;

      if (
        login.length <
        3
      ) {
        return res
          .status(400)
          .json({
            error:
              'Portal username must contain at least 3 characters',
          });
      }

      const existing =
        await db.query(`
          SELECT *
          FROM billing_pppoe_portal_accounts

          WHERE client_id = $1
            AND subscriber_id = $2

          LIMIT 1
        `, [
          req.scope.clientId,
          subscriber.id,
        ]);

      if (
        !existing.rows[0] &&
        password.length <
          8
      ) {
        return res
          .status(400)
          .json({
            error:
              'Create a portal password containing at least 8 characters',
          });
      }

      if (
        password &&
        password.length <
          8
      ) {
        return res
          .status(400)
          .json({
            error:
              'Portal password must contain at least 8 characters',
          });
      }

      const passwordHash =
        password
          ? await bcrypt.hash(
              password,
              12
            )
          : existing.rows[0]
              ?.password_hash;

      const result =
        await db.query(`
          INSERT INTO
            billing_pppoe_portal_accounts
          (
            client_id,
            subscriber_id,
            login,
            password_hash,
            enabled
          )

          VALUES (
            $1,
            $2,
            $3,
            $4,
            $5
          )

          ON CONFLICT (
            client_id,
            subscriber_id
          )

          DO UPDATE SET
            login =
              EXCLUDED.login,

            password_hash =
              EXCLUDED.password_hash,

            enabled =
              EXCLUDED.enabled,

            updated_at =
              NOW()

          RETURNING
            id,
            login,
            enabled,
            last_login_at,
            created_at,
            updated_at
        `, [
          req.scope.clientId,
          subscriber.id,
          login,
          passwordHash,
          enabled,
        ]);

      return res.json({
        account:
          result.rows[0],

        portal_url:
          '/pppoe',
      });
    } catch (
      error
    ) {
      if (
        error.code ===
        '23505'
      ) {
        return res
          .status(409)
          .json({
            error:
              'That portal username is already used by another customer',
          });
      }

      console.error(
        'Save PPPoE portal access error:',
        error.message
      );

      return res
        .status(500)
        .json({
          error:
            'Could not save customer portal access',
        });
    }
  }
);


portalRouter.post(
  '/login',
  async (
    req,
    res
  ) => {
    try {
      await ensureSchema();

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

      if (
        !identity ||
        !password
      ) {
        return res
          .status(400)
          .json({
            error:
              'Enter your username and password',
          });
      }

      const result =
        await db.query(`
          SELECT
            account.id
              AS portal_account_id,

            account.client_id,

            account.subscriber_id,

            account.login,

            account.password_hash,

            account.enabled,

            subscriber.full_name,

            subscriber.account_number,

            subscriber.access_mode,

            client.name
              AS network_name,

            client.business_name
              AS network_business_name

          FROM billing_pppoe_portal_accounts
            account

          JOIN billing_subscribers
            subscriber

            ON subscriber.id =
               account.subscriber_id

           AND subscriber.client_id =
               account.client_id

          JOIN clients
            client

            ON client.id =
               account.client_id

          WHERE LOWER(
                  account.login
                ) =
                LOWER($1)

            AND account.enabled =
                TRUE

            AND COALESCE(
                  subscriber.access_mode,
                  'pppoe'
                ) IN (
                  'pppoe',
                  'pppoe_static'
                )

            AND client.account_type =
                'billing'

          LIMIT 1
        `, [
          identity,
        ]);

      const account =
        result.rows[0];

      if (!account) {
        return res
          .status(401)
          .json({
            error:
              'Invalid portal username or password',
          });
      }

      const valid =
        await bcrypt.compare(
          password,
          account.password_hash
        );

      if (!valid) {
        return res
          .status(401)
          .json({
            error:
              'Invalid portal username or password',
          });
      }

      await db.query(`
        UPDATE billing_pppoe_portal_accounts

        SET
          last_login_at =
            NOW(),

          updated_at =
            NOW()

        WHERE id = $1
      `, [
        account.portal_account_id,
      ]);

      return res.json({
        token:
          signToken(
            account
          ),

        customer: {
          full_name:
            account.full_name,

          account_number:
            account.account_number,

          network_name:
            account.network_business_name ||
            account.network_name,
        },
      });
    } catch (
      error
    ) {
      console.error(
        'PPPoE customer login error:',
        error.message
      );

      return res
        .status(500)
        .json({
          error:
            'Could not sign in',
        });
    }
  }
);


portalRouter.use(
  portalAuth
);


async function dashboardPayload(
  subscriber
) {
  let usage = {
    available:
      false,

    days:
      30,

    total: {},

    daily: [],

    sessions: [],
  };

  try {
    usage =
      await getSubscriberUsage(
        subscriber.radius_username,
        30
      );
  } catch (
    error
  ) {
    console.error(
      'PPPoE portal RADIUS usage error:',
      error.message
    );
  }


  const [
    planResult,
    plansResult,
    invoicesResult,
    paymentsResult,
    pauseResult,
    pauseUsageResult,
    trafficResult,
    portalPaymentsResult,
  ] =
    await Promise.all([
      subscriber.plan_id
        ? db.query(`
            SELECT *
            FROM billing_plans

            WHERE id = $1
              AND client_id = $2

            LIMIT 1
          `, [
            subscriber.plan_id,
            subscriber.client_id,
          ])
        : Promise.resolve({
            rows: [],
          }),

      db.query(`
        SELECT
          id,
          name,
          description,
          download_speed_mbps,
          upload_speed_mbps,
          price,
          validity_days,
          fup_enabled,
          fup_threshold_mb,
          fup_download_speed_mbps,
          fup_upload_speed_mbps

        FROM billing_plans

        WHERE client_id = $1
          AND is_active = TRUE

        ORDER BY
          price ASC,
          name ASC
      `, [
        subscriber.client_id,
      ]),

      db.query(`
        SELECT
          invoice_number,
          amount,
          status,
          due_date,
          paid_at,
          created_at

        FROM billing_invoices

        WHERE client_id = $1
          AND subscriber_id = $2

        ORDER BY
          created_at DESC

        LIMIT 20
      `, [
        subscriber.client_id,
        subscriber.id,
      ]),

      db.query(`
        SELECT
          amount,
          method,
          reference,
          status,
          paid_at,
          created_at

        FROM billing_payments

        WHERE client_id = $1
          AND subscriber_id = $2

        ORDER BY
          created_at DESC

        LIMIT 20
      `, [
        subscriber.client_id,
        subscriber.id,
      ]),

      db.query(`
        SELECT *
        FROM billing_pppoe_pause_events

        WHERE client_id = $1
          AND subscriber_id = $2
          AND status =
              'active'

        ORDER BY
          started_at DESC

        LIMIT 1
      `, [
        subscriber.client_id,
        subscriber.id,
      ]),

      db.query(`
        SELECT
          COALESCE(
            SUM(
              EXTRACT(
                EPOCH FROM (
                  COALESCE(
                    resumed_at,
                    LEAST(
                      scheduled_resume_at,
                      NOW()
                    )
                  ) -
                  started_at
                )
              )
            ),
            0
          )::bigint
          AS used_seconds

        FROM billing_pppoe_pause_events

        WHERE client_id = $1
          AND subscriber_id = $2

          AND started_at >=
              NOW() -
              INTERVAL '30 days'
      `, [
        subscriber.client_id,
        subscriber.id,
      ]),

      db.query(`
        SELECT
          category,
          application,

          COALESCE(
            SUM(upload_bytes),
            0
          )::bigint
          AS upload_bytes,

          COALESCE(
            SUM(download_bytes),
            0
          )::bigint
          AS download_bytes

        FROM billing_pppoe_traffic_usage

        WHERE client_id = $1
          AND subscriber_id = $2

          AND bucket_start >=
              NOW() -
              INTERVAL '30 days'

        GROUP BY
          category,
          application

        ORDER BY
          (
            SUM(upload_bytes) +
            SUM(download_bytes)
          ) DESC

        LIMIT 20
      `, [
        subscriber.client_id,
        subscriber.id,
      ]),

      db.query(`
        SELECT
          portal_payment.external_reference,
          portal_payment.action,
          portal_payment.amount,
          portal_payment.status,
          portal_payment.applied_at,
          portal_payment.created_at,

          plan.name
            AS plan_name

        FROM billing_pppoe_portal_payments
          portal_payment

        LEFT JOIN billing_plans
          plan

          ON plan.id =
             portal_payment.target_plan_id

         AND plan.client_id =
             portal_payment.client_id

        WHERE portal_payment.client_id = $1
          AND portal_payment.subscriber_id = $2

        ORDER BY
          portal_payment.created_at DESC

        LIMIT 10
      `, [
        subscriber.client_id,
        subscriber.id,
      ]),
    ]);


  const currentPlan =
    planResult.rows[0] ||
    null;

  const currentPrice =
    Number(
      currentPlan?.price ||
      0
    );

  const availablePlans =
    plansResult.rows.map(
      plan => {
        const price =
          Number(
            plan.price ||
            0
          );

        let direction =
          'current';

        if (
          Number(plan.id) !==
          Number(
            subscriber.plan_id
          )
        ) {
          direction =
            price >
            currentPrice
              ? 'upgrade'
              : 'downgrade';
        }

        return {
          ...plan,
          direction,
        };
      }
    );


  const paymentConfig =
    await loadPayHeroConfig(
      subscriber.client_id
    )
      .catch(
        () => null
      );

  const paymentsEnabled =
    Boolean(
      paymentConfig &&
      paymentConfig.enabled &&
      (
        paymentConfig.paymentProvider ===
          'daraja'
          ? (
              paymentConfig.mpesa
                ?.consumerKey &&
              paymentConfig.mpesa
                ?.consumerSecret &&
              paymentConfig.mpesa
                ?.shortcode &&
              paymentConfig.mpesa
                ?.passkey
            )
          : (
              paymentConfig.basicAuth &&
              paymentConfig.channelId
            )
      )
    );


  const expiry =
    subscriber.expires_at
      ? new Date(
          subscriber.expires_at
        )
      : null;

  const remainingMs =
    expiry &&
    !Number.isNaN(
      expiry.getTime()
    )
      ? expiry.getTime() -
        Date.now()
      : null;

  const daysRemaining =
    remainingMs ===
      null
      ? null
      : Math.max(
          0,
          Math.ceil(
            remainingMs /
            86400000
          )
        );


  const usedPauseSeconds =
    Number(
      pauseUsageResult
        .rows[0]
        ?.used_seconds ||
      0
    );

  const maximumPauseSeconds =
    7 *
    86400;


  const online =
    Boolean(
      usage.available &&
      usage.sessions
        .some(
          session =>
            session.is_active
        )
    );


  const traffic =
    trafficResult.rows.map(
      row => ({
        category:
          row.category,

        application:
          row.application,

        upload_bytes:
          Number(
            row.upload_bytes ||
            0
          ),

        download_bytes:
          Number(
            row.download_bytes ||
            0
          ),

        total_bytes:
          Number(
            row.upload_bytes ||
            0
          ) +
          Number(
            row.download_bytes ||
            0
          ),
      })
    );


  return {
    customer: {
      id:
        subscriber.id,

      full_name:
        subscriber.full_name,

      account_number:
        subscriber.account_number,

      phone:
        subscriber.phone,

      email:
        subscriber.email,

      radius_username:
        subscriber.radius_username,

      service_status:
        subscriber.service_status,

      radius_status:
        subscriber.radius_status,

      expires_at:
        subscriber.expires_at,

      days_remaining:
        daysRemaining,

      is_online:
        online,

      router_name:
        subscriber.router_name,

      network_name:
        subscriber.network_business_name ||
        subscriber.network_name,
    },

    subscription: {
      current_plan:
        currentPlan,

      plans:
        availablePlans,

      paused:
        Boolean(
          pauseResult.rows[0]
        ),

      pause:
        pauseResult.rows[0] ||
        null,

      pause_policy: {
        max_days_per_30_days:
          7,

        used_days:
          Number(
            (
              usedPauseSeconds /
              86400
            ).toFixed(2)
          ),

        remaining_days:
          Number(
            (
              Math.max(
                0,
                maximumPauseSeconds -
                usedPauseSeconds
              ) /
              86400
            ).toFixed(2)
          ),
      },
    },

    usage,

    traffic: {
      classification_available:
        traffic.length >
        0,

      items:
        traffic,

      message:
        traffic.length
          ? null
          : 'Application classification is not enabled yet. RADIUS provides accurate total bandwidth, but YouTube, TikTok, Facebook and Netflix require DPI/IPFIX telemetry.',
    },

    billing: {
      payments_enabled:
        paymentsEnabled,

      invoices:
        invoicesResult.rows,

      payments:
        paymentsResult.rows,

      portal_payments:
        portalPaymentsResult.rows,
    },
  };
}


portalRouter.get(
  '/dashboard',
  async (
    req,
    res
  ) => {
    try {
      return res.json(
        await dashboardPayload(
          req.pppoe
        )
      );
    } catch (
      error
    ) {
      console.error(
        'PPPoE portal dashboard error:',
        error.message
      );

      return res
        .status(500)
        .json({
          error:
            'Could not load your internet dashboard',
        });
    }
  }
);


portalRouter.put(
  '/profile',
  async (
    req,
    res
  ) => {
    try {
      let phone =
        String(
          req.body.phone ||
          ''
        ).trim();

      const email =
        normalEmail(
          req.body.email
        );

      if (phone) {
        phone =
          cleanPhone(
            phone
          );

        if (
          !/^254[17]\d{8}$/
            .test(
              phone
            )
        ) {
          return res
            .status(400)
            .json({
              error:
                'Enter a valid Kenyan phone number',
            });
        }
      }

      if (
        email &&
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/
          .test(
            email
          )
      ) {
        return res
          .status(400)
          .json({
            error:
              'Enter a valid email address',
          });
      }

      const result =
        await db.query(`
          UPDATE billing_subscribers

          SET
            phone = $1,
            email = $2,
            updated_at =
              NOW()

          WHERE id = $3
            AND client_id = $4

          RETURNING
            id,
            phone,
            email
        `, [
          phone ||
          null,

          email ||
          null,

          req.pppoe.id,

          req.pppoe.client_id,
        ]);

      return res.json(
        result.rows[0]
      );
    } catch (
      error
    ) {
      return res
        .status(500)
        .json({
          error:
            'Could not update profile',
        });
    }
  }
);


portalRouter.put(
  '/password',
  async (
    req,
    res
  ) => {
    try {
      const currentPassword =
        String(
          req.body.current_password ||
          ''
        );

      const newPassword =
        String(
          req.body.new_password ||
          ''
        );

      if (
        newPassword.length <
        8
      ) {
        return res
          .status(400)
          .json({
            error:
              'New password must contain at least 8 characters',
          });
      }

      const valid =
        await bcrypt.compare(
          currentPassword,
          req.pppoe
            .portal_password_hash
        );

      if (!valid) {
        return res
          .status(400)
          .json({
            error:
              'Current password is incorrect',
          });
      }

      await db.query(`
        UPDATE billing_pppoe_portal_accounts

        SET
          password_hash = $1,
          updated_at =
            NOW()

        WHERE id = $2
          AND client_id = $3
      `, [
        await bcrypt.hash(
          newPassword,
          12
        ),

        req.pppoe
          .portal_account_id,

        req.pppoe
          .client_id,
      ]);

      return res.json({
        success:
          true,
      });
    } catch (
      error
    ) {
      return res
        .status(500)
        .json({
          error:
            'Could not change portal password',
        });
    }
  }
);


portalRouter.post(
  '/payments/initiate',
  async (
    req,
    res
  ) => {
    try {
      await ensureSchema();

      const planId =
        integer(
          req.body.plan_id
        );

      if (!planId) {
        return res
          .status(400)
          .json({
            error:
              'Choose an internet package',
          });
      }

      const planResult =
        await db.query(`
          SELECT *
          FROM billing_plans

          WHERE id = $1
            AND client_id = $2
            AND is_active = TRUE

          LIMIT 1
        `, [
          planId,
          req.pppoe.client_id,
        ]);

      const plan =
        planResult.rows[0];

      if (!plan) {
        return res
          .status(400)
          .json({
            error:
              'That internet package is no longer available',
          });
      }

      const amount =
        Math.round(
          Number(
            plan.price ||
            0
          )
        );

      if (
        !Number.isInteger(
          amount
        ) ||
        amount <
          10
      ) {
        return res
          .status(400)
          .json({
            error:
              'This package needs a valid price of at least KES 10 before online payment can be used',
          });
      }

      const phone =
        cleanPhone(
          req.body.phone ||
          req.pppoe.phone
        );

      if (
        !/^254[17]\d{8}$/
          .test(
            phone
          )
      ) {
        return res
          .status(400)
          .json({
            error:
              'Enter a valid Safaricom M-Pesa phone number',
          });
      }

      const currentPlan =
        req.pppoe.plan_id
          ? await db.query(`
              SELECT
                id,
                price

              FROM billing_plans

              WHERE id = $1
                AND client_id = $2

              LIMIT 1
            `, [
              req.pppoe.plan_id,
              req.pppoe.client_id,
            ])
          : {
              rows: [],
            };

      const currentPrice =
        Number(
          currentPlan
            .rows[0]
            ?.price ||
          0
        );

      const action =
        Number(plan.id) ===
        Number(
          req.pppoe.plan_id
        )
          ? 'renew'
          : Number(
                plan.price ||
                0
              ) >
              currentPrice
              ? 'upgrade'
              : 'downgrade';

      const clientResult =
        await db.query(`
          SELECT *
          FROM clients

          WHERE id = $1
            AND account_type =
                'billing'

          LIMIT 1
        `, [
          req.pppoe.client_id,
        ]);

      const client =
        clientResult.rows[0];

      if (!client) {
        return res
          .status(404)
          .json({
            error:
              'Network account not found',
          });
      }

      const result =
        await initiatePayHeroPayment({
          client,

          conversationId:
            null,

          customerPhone:
            phone,

          customerName:
            req.pppoe.full_name,

          amount,

          metadata: {
            purpose:
              'pppoe_portal',

            version:
              1,

            subscriber_id:
              Number(
                req.pppoe.id
              ),

            portal_account_id:
              Number(
                req.pppoe
                  .portal_account_id
              ),

            current_plan_id:
              req.pppoe.plan_id
                ? Number(
                    req.pppoe.plan_id
                  )
                : null,

            target_plan_id:
              Number(
                plan.id
              ),

            plan_name_snapshot:
              plan.name,

            amount_snapshot:
              amount,

            action,
          },
        });

      if (!result.success) {
        return res
          .status(400)
          .json({
            error:
              result.error ||
              'Could not send M-Pesa prompt',
          });
      }

      const paymentRequest =
        await db.query(`
          SELECT
            id

          FROM payhero_payment_requests

          WHERE client_id = $1
            AND external_reference = $2

          LIMIT 1
        `, [
          req.pppoe.client_id,
          result.externalReference,
        ]);

      await db.query(`
        INSERT INTO
          billing_pppoe_portal_payments
        (
          client_id,
          subscriber_id,
          payment_request_id,
          external_reference,
          target_plan_id,
          action,
          amount,
          status,
          metadata
        )

        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9::jsonb
        )

        ON CONFLICT (
          external_reference
        )

        DO UPDATE SET
          status =
            EXCLUDED.status,

          updated_at =
            NOW()
      `, [
        req.pppoe.client_id,
        req.pppoe.id,
        paymentRequest
          .rows[0]
          ?.id ||
        null,

        result.externalReference,
        plan.id,
        action,
        amount,

        String(
          result.status ||
          'queued'
        ).toLowerCase(),

        JSON.stringify({
          plan_name:
            plan.name,

          phone,
        }),
      ]);

      return res
        .status(201)
        .json({
          reference:
            result.externalReference,

          status:
            result.status,

          plan: {
            id:
              plan.id,

            name:
              plan.name,

            price:
              plan.price,
          },

          action,
        });
    } catch (
      error
    ) {
      console.error(
        'PPPoE portal payment initiation error:',
        error.message
      );

      return res
        .status(500)
        .json({
          error:
            'Could not start package payment',
        });
    }
  }
);


portalRouter.get(
  '/payments/:reference',
  async (
    req,
    res
  ) => {
    try {
      const reference =
        String(
          req.params.reference ||
          ''
        ).trim();

      const result =
        await db.query(`
          SELECT
            portal_payment.*,

            payhero.status
              AS provider_status,

            payhero.result_description,

            payhero.mpesa_receipt_number
              AS provider_receipt

          FROM billing_pppoe_portal_payments
            portal_payment

          LEFT JOIN payhero_payment_requests
            payhero

            ON payhero.id =
               portal_payment.payment_request_id

          WHERE portal_payment.client_id = $1
            AND portal_payment.subscriber_id = $2
            AND portal_payment.external_reference = $3

          LIMIT 1
        `, [
          req.pppoe.client_id,
          req.pppoe.id,
          reference,
        ]);

      const payment =
        result.rows[0];

      if (!payment) {
        return res
          .status(404)
          .json({
            error:
              'Payment request not found',
          });
      }

      if (
        payment.provider_status ===
          'paid' &&
        !payment.applied_at
      ) {
        const provider =
          await db.query(`
            SELECT *
            FROM payhero_payment_requests

            WHERE id = $1

            LIMIT 1
          `, [
            payment.payment_request_id,
          ]);

        if (provider.rows[0]) {
          await fulfillPppoePortalPayment(
            provider.rows[0]
          );
        }
      }

      const refreshed =
        await db.query(`
          SELECT
            portal_payment.status,
            portal_payment.applied_at,
            portal_payment.mpesa_receipt_number,

            payhero.status
              AS provider_status,

            payhero.result_description

          FROM billing_pppoe_portal_payments
            portal_payment

          LEFT JOIN payhero_payment_requests
            payhero

            ON payhero.id =
               portal_payment.payment_request_id

          WHERE portal_payment.client_id = $1
            AND portal_payment.subscriber_id = $2
            AND portal_payment.external_reference = $3

          LIMIT 1
        `, [
          req.pppoe.client_id,
          req.pppoe.id,
          reference,
        ]);

      const row =
        refreshed.rows[0];

      return res.json({
        ...row,

        effective_status:
          row.applied_at
            ? 'applied'
            : row.provider_status ||
              row.status,
      });
    } catch (
      error
    ) {
      return res
        .status(500)
        .json({
          error:
            'Could not check payment status',
        });
    }
  }
);


async function rollingPauseSeconds(
  client,
  subscriberId,
  clientId
) {
  const result =
    await client.query(`
      SELECT
        COALESCE(
          SUM(
            EXTRACT(
              EPOCH FROM (
                COALESCE(
                  resumed_at,
                  LEAST(
                    scheduled_resume_at,
                    NOW()
                  )
                ) -
                started_at
              )
            )
          ),
          0
        )::bigint
        AS used_seconds

      FROM billing_pppoe_pause_events

      WHERE client_id = $1
        AND subscriber_id = $2

        AND started_at >=
            NOW() -
            INTERVAL '30 days'
    `, [
      clientId,
      subscriberId,
    ]);

  return Number(
    result.rows[0]
      ?.used_seconds ||
    0
  );
}


portalRouter.post(
  '/subscription/pause',
  async (
    req,
    res
  ) => {
    const days =
      integer(
        req.body.days
      );

    if (
      !days ||
      days <
        1 ||
      days >
        7
    ) {
      return res
        .status(400)
        .json({
          error:
            'Choose a pause between 1 and 7 days',
        });
    }

    const client =
      await db.connect();

    try {
      await client.query(
        'BEGIN'
      );

      const subscriberResult =
        await client.query(`
          SELECT *
          FROM billing_subscribers

          WHERE id = $1
            AND client_id = $2

          FOR UPDATE
        `, [
          req.pppoe.id,
          req.pppoe.client_id,
        ]);

      const subscriber =
        subscriberResult.rows[0];

      if (!subscriber) {
        await client.query(
          'ROLLBACK'
        );

        return res
          .status(404)
          .json({
            error:
              'Subscription not found',
          });
      }

      if (
        subscriber.service_status !==
        'active'
      ) {
        await client.query(
          'ROLLBACK'
        );

        return res
          .status(400)
          .json({
            error:
              'Only an active subscription can be paused',
          });
      }

      const existing =
        await client.query(`
          SELECT id
          FROM billing_pppoe_pause_events

          WHERE client_id = $1
            AND subscriber_id = $2
            AND status =
                'active'

          LIMIT 1
        `, [
          subscriber.client_id,
          subscriber.id,
        ]);

      if (existing.rows[0]) {
        await client.query(
          'ROLLBACK'
        );

        return res
          .status(409)
          .json({
            error:
              'This subscription is already paused',
          });
      }

      const usedSeconds =
        await rollingPauseSeconds(
          client,
          subscriber.id,
          subscriber.client_id
        );

      const requestedSeconds =
        days *
        86400;

      if (
        usedSeconds +
        requestedSeconds >
        7 *
        86400
      ) {
        await client.query(
          'ROLLBACK'
        );

        const remaining =
          Math.max(
            0,
            (
              7 *
              86400 -
              usedSeconds
            ) /
            86400
          );

        return res
          .status(400)
          .json({
            error:
              `You have ${remaining.toFixed(1)} pause day(s) remaining in the current 30-day window`,
          });
      }

      const resumeAt =
        new Date(
          Date.now() +
          requestedSeconds *
          1000
        );

      const pause =
        await client.query(`
          INSERT INTO
            billing_pppoe_pause_events
          (
            client_id,
            subscriber_id,
            scheduled_resume_at,
            requested_days,
            previous_status
          )

          VALUES (
            $1,
            $2,
            $3,
            $4,
            $5
          )

          RETURNING *
        `, [
          subscriber.client_id,
          subscriber.id,
          resumeAt,
          days,
          subscriber.service_status,
        ]);

      await client.query(`
        UPDATE billing_subscribers

        SET
          service_status =
            'suspended',

          updated_at =
            NOW()

        WHERE id = $1
          AND client_id = $2
      `, [
        subscriber.id,
        subscriber.client_id,
      ]);

      await enqueueRadiusSyncJob(
        client,
        subscriber.client_id,
        subscriber.id,
        'customer_portal_pause'
      );

      await client.query(
        'COMMIT'
      );

      processRadiusSyncJobs()
        .catch(
          error =>
            console.error(
              'PPPoE pause RADIUS sync error:',
              error.message
            )
        );

      return res.json({
        paused:
          true,

        resume_at:
          pause.rows[0]
            .scheduled_resume_at,
      });
    } catch (
      error
    ) {
      await client
        .query(
          'ROLLBACK'
        )
        .catch(
          () => {}
        );

      console.error(
        'PPPoE subscription pause error:',
        error.message
      );

      return res
        .status(500)
        .json({
          error:
            'Could not pause subscription',
        });
    } finally {
      client.release();
    }
  }
);


async function resumePauseEvent(
  pauseId,
  automatic =
    false
) {
  const client =
    await db.connect();

  try {
    await client.query(
      'BEGIN'
    );

    const result =
      await client.query(`
        SELECT
          pause_event.*,

          subscriber.expires_at

        FROM billing_pppoe_pause_events
          pause_event

        JOIN billing_subscribers
          subscriber

          ON subscriber.id =
             pause_event.subscriber_id

         AND subscriber.client_id =
             pause_event.client_id

        WHERE pause_event.id = $1

        FOR UPDATE OF
          pause_event,
          subscriber
      `, [
        pauseId,
      ]);

    const pause =
      result.rows[0];

    if (
      !pause ||
      pause.status !==
        'active'
    ) {
      await client.query(
        'ROLLBACK'
      );

      return {
        resumed:
          false,
      };
    }

    const started =
      new Date(
        pause.started_at
      );

    const scheduled =
      new Date(
        pause.scheduled_resume_at
      );

    const resumedAt =
      automatic
        ? scheduled
        : new Date();

    const seconds =
      Math.max(
        0,
        Math.floor(
          (
            resumedAt.getTime() -
            started.getTime()
          ) /
          1000
        )
      );

    await client.query(`
      UPDATE billing_subscribers

      SET
        service_status =
          'active',

        radius_status =
          'active',

        expires_at =
          CASE
            WHEN expires_at
                 IS NULL
            THEN NULL

            ELSE expires_at +
                 (
                   $1 *
                   INTERVAL '1 second'
                 )
          END,

        updated_at =
          NOW()

      WHERE id = $2
        AND client_id = $3
    `, [
      seconds,
      pause.subscriber_id,
      pause.client_id,
    ]);

    await client.query(`
      UPDATE billing_pppoe_pause_events

      SET
        status = $1,
        resumed_at = $2

      WHERE id = $3
    `, [
      automatic
        ? 'auto_resumed'
        : 'resumed',

      resumedAt,

      pause.id,
    ]);

    await enqueueRadiusSyncJob(
      client,
      pause.client_id,
      pause.subscriber_id,
      automatic
        ? 'customer_portal_auto_resume'
        : 'customer_portal_resume'
    );

    await client.query(
      'COMMIT'
    );

    processRadiusSyncJobs()
      .catch(
        error =>
          console.error(
            'PPPoE resume RADIUS sync error:',
            error.message
          )
      );

    return {
      resumed:
        true,

      resumed_at:
        resumedAt,
    };
  } catch (
    error
  ) {
    await client
      .query(
        'ROLLBACK'
      )
      .catch(
        () => {}
      );

    throw error;
  } finally {
    client.release();
  }
}


portalRouter.post(
  '/subscription/resume',
  async (
    req,
    res
  ) => {
    try {
      const result =
        await db.query(`
          SELECT id
          FROM billing_pppoe_pause_events

          WHERE client_id = $1
            AND subscriber_id = $2
            AND status =
                'active'

          ORDER BY
            started_at DESC

          LIMIT 1
        `, [
          req.pppoe.client_id,
          req.pppoe.id,
        ]);

      if (!result.rows[0]) {
        return res
          .status(400)
          .json({
            error:
              'This subscription is not paused',
          });
      }

      return res.json(
        await resumePauseEvent(
          result.rows[0].id,
          false
        )
      );
    } catch (
      error
    ) {
      console.error(
        'PPPoE manual resume error:',
        error.message
      );

      return res
        .status(500)
        .json({
          error:
            'Could not resume subscription',
        });
    }
  }
);


async function fulfillPppoePortalPayment(
  payment
) {
  await ensureSchema();

  const metadata =
    payment?.metadata &&
    typeof payment.metadata ===
      'object'
      ? payment.metadata
      : {};

  if (
    metadata.purpose !==
    'pppoe_portal'
  ) {
    return {
      ignored:
        true,
    };
  }

  if (
    payment.status !==
    'paid'
  ) {
    return {
      ignored:
        true,
    };
  }

  const subscriberId =
    integer(
      metadata.subscriber_id
    );

  const targetPlanId =
    integer(
      metadata.target_plan_id
    );

  const expectedAmount =
    integer(
      metadata.amount_snapshot
    );

  if (
    !subscriberId ||
    !targetPlanId ||
    !expectedAmount
  ) {
    throw new Error(
      'PPPoE portal payment metadata is incomplete'
    );
  }

  const client =
    await db.connect();

  try {
    await client.query(
      'BEGIN'
    );

    await client.query(`
      INSERT INTO
        billing_pppoe_portal_payments
      (
        client_id,
        subscriber_id,
        payment_request_id,
        external_reference,
        target_plan_id,
        action,
        amount,
        status,
        mpesa_receipt_number,
        metadata
      )

      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        'paid',
        $8,
        $9::jsonb
      )

      ON CONFLICT (
        external_reference
      )

      DO UPDATE SET
        payment_request_id =
          COALESCE(
            billing_pppoe_portal_payments
              .payment_request_id,
            EXCLUDED.payment_request_id
          ),

        status =
          'paid',

        mpesa_receipt_number =
          COALESCE(
            EXCLUDED.mpesa_receipt_number,
            billing_pppoe_portal_payments
              .mpesa_receipt_number
          ),

        updated_at =
          NOW()
    `, [
      payment.client_id,
      subscriberId,
      payment.id,
      payment.external_reference,
      targetPlanId,
      String(
        metadata.action ||
        'renew'
      ),
      expectedAmount,
      payment.mpesa_receipt_number ||
      null,
      JSON.stringify(
        metadata
      ),
    ]);

    const portalPayment =
      await client.query(`
        SELECT *
        FROM billing_pppoe_portal_payments

        WHERE external_reference = $1

        FOR UPDATE
      `, [
        payment.external_reference,
      ]);

    const portalRow =
      portalPayment.rows[0];

    if (
      portalRow.applied_at
    ) {
      await client.query(
        'COMMIT'
      );

      return {
        already_applied:
          true,
      };
    }

    if (
      Number(
        payment.amount
      ) <
      expectedAmount
    ) {
      await client.query(`
        UPDATE billing_pppoe_portal_payments

        SET
          status =
            'underpaid',

          updated_at =
            NOW()

        WHERE id = $1
      `, [
        portalRow.id,
      ]);

      await client.query(
        'COMMIT'
      );

      return {
        applied:
          false,

        reason:
          'underpaid',
      };
    }

    const subscriberResult =
      await client.query(`
        SELECT *
        FROM billing_subscribers

        WHERE id = $1
          AND client_id = $2

        FOR UPDATE
      `, [
        subscriberId,
        payment.client_id,
      ]);

    const subscriber =
      subscriberResult.rows[0];

    if (!subscriber) {
      throw new Error(
        'PPPoE subscriber no longer exists'
      );
    }

    const planResult =
      await client.query(`
        SELECT *
        FROM billing_plans

        WHERE id = $1
          AND client_id = $2

        LIMIT 1
      `, [
        targetPlanId,
        payment.client_id,
      ]);

    const plan =
      planResult.rows[0];

    if (!plan) {
      throw new Error(
        'Paid PPPoE package no longer exists'
      );
    }

    let packageRouter =
      null;

    if (plan.router_id) {
      const router =
        await client.query(`
          SELECT
            id,
            name

          FROM mikrotik_routers

          WHERE id = $1
            AND client_id = $2
            AND is_active =
                TRUE

          LIMIT 1
        `, [
          plan.router_id,
          payment.client_id,
        ]);

      packageRouter =
        router.rows[0] ||
        null;
    }

    const invoiceNumber =
      `INV-${payment.client_id}-PORTAL-${payment.id}`;

    let invoice =
      await client.query(`
        SELECT *
        FROM billing_invoices

        WHERE client_id = $1
          AND invoice_number = $2

        LIMIT 1
      `, [
        payment.client_id,
        invoiceNumber,
      ]);

    if (!invoice.rows[0]) {
      invoice =
        await client.query(`
          INSERT INTO
            billing_invoices
          (
            client_id,
            subscriber_id,
            invoice_number,
            amount,
            status,
            due_date,
            paid_at
          )

          VALUES (
            $1,
            $2,
            $3,
            $4,
            'paid',
            CURRENT_DATE,
            NOW()
          )

          RETURNING *
        `, [
          payment.client_id,
          subscriber.id,
          invoiceNumber,
          expectedAmount,
        ]);
    }

    const billingReference =
      payment.mpesa_receipt_number ||
      payment.external_reference;

    const existingBillingPayment =
      await client.query(`
        SELECT id
        FROM billing_payments

        WHERE client_id = $1
          AND reference = $2

        LIMIT 1
      `, [
        payment.client_id,
        billingReference,
      ]);

    if (
      !existingBillingPayment
        .rows[0]
    ) {
      await client.query(`
        INSERT INTO
          billing_payments
        (
          client_id,
          subscriber_id,
          invoice_id,
          amount,
          method,
          reference,
          status
        )

        VALUES (
          $1,
          $2,
          $3,
          $4,
          'M-Pesa',
          $5,
          'completed'
        )
      `, [
        payment.client_id,
        subscriber.id,
        invoice.rows[0].id,
        expectedAmount,
        billingReference,
      ]);
    }

    const currentExpiry =
      subscriber.expires_at
        ? new Date(
            subscriber.expires_at
          )
        : null;

    const base =
      currentExpiry &&
      currentExpiry >
        new Date()
        ? currentExpiry
        : new Date();

    const validityDays =
      Math.max(
        1,
        Number(
          plan.validity_days ||
          30
        )
      );

    const expiresAt =
      new Date(
        base.getTime() +
        validityDays *
        86400000
      );

    await client.query(`
      UPDATE billing_subscribers

      SET
        plan_id = $1,

        service_status =
          'active',

        radius_status =
          'active',

        expires_at =
          $2,

        router_id =
          COALESCE(
            $3,
            router_id
          ),

        router_name =
          COALESCE(
            $4,
            router_name
          ),

        updated_at =
          NOW()

      WHERE id = $5
        AND client_id = $6
    `, [
      plan.id,
      expiresAt,
      packageRouter?.id ||
      null,
      packageRouter?.name ||
      null,
      subscriber.id,
      payment.client_id,
    ]);

    await enqueueRadiusSyncJob(
      client,
      payment.client_id,
      subscriber.id,
      `customer_portal_${
        metadata.action ||
        'renew'
      }`
    );

    await client.query(`
      UPDATE billing_pppoe_portal_payments

      SET
        status =
          'applied',

        mpesa_receipt_number =
          COALESCE(
            $1,
            mpesa_receipt_number
          ),

        applied_at =
          NOW(),

        updated_at =
          NOW()

      WHERE id = $2
    `, [
      payment.mpesa_receipt_number ||
      null,

      portalRow.id,
    ]);

    await client.query(
      'COMMIT'
    );

    processRadiusSyncJobs()
      .catch(
        error =>
          console.error(
            'PPPoE portal payment RADIUS sync error:',
            error.message
          )
      );

    return {
      applied:
        true,

      subscriber_id:
        subscriber.id,

      plan_id:
        plan.id,

      expires_at:
        expiresAt,
    };
  } catch (
    error
  ) {
    await client
      .query(
        'ROLLBACK'
      )
      .catch(
        () => {}
      );

    throw error;
  } finally {
    client.release();
  }
}


function startPppoePortalScheduler() {
  if (scheduler) {
    return scheduler;
  }

  const run =
    async () => {
      try {
        await ensureSchema();

        const due =
          await db.query(`
            SELECT id
            FROM billing_pppoe_pause_events

            WHERE status =
              'active'

              AND scheduled_resume_at <=
                  NOW()

            ORDER BY
              scheduled_resume_at ASC

            LIMIT 50
          `);

        for (
          const pause
          of due.rows
        ) {
          try {
            await resumePauseEvent(
              pause.id,
              true
            );
          } catch (
            error
          ) {
            console.error(
              `PPPoE auto-resume ${pause.id} failed:`,
              error.message
            );
          }
        }
      } catch (
        error
      ) {
        console.error(
          'PPPoE portal scheduler error:',
          error.message
        );
      }
    };

  void run();

  scheduler =
    setInterval(
      run,
      60000
    );

  scheduler.unref?.();

  return scheduler;
}


module.exports = {
  adminRouter,
  portalRouter,
  ensureSchema,
  fulfillPppoePortalPayment,
  startPppoePortalScheduler,
};

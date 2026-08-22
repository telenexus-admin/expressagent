const express = require('express');
const crypto = require('crypto');
const http = require('http');

const db = require('../db');
const {
  authMiddleware,
  scopeMiddleware,
} = require('../middleware/auth');

const router = express.Router();

router.use(
  authMiddleware,
  scopeMiddleware
);


/* ========================================================
 * NEXA BILLING ACTION ENGINE
 *
 * Nexa may operate billing/admin APIs.
 *
 * Direct network-control APIs are NEVER allowed here.
 * ======================================================== */


/* --------------------------------------------------------
 * HARD NETWORK WRITE BLOCK
 * -------------------------------------------------------- */

const BLOCKED_PREFIXES = [
  '/api/mikrotik',
  '/api/network-agent',
  '/api/noc',
  '/api/tr069',
  '/api/public/mikrotik',
];


/*
 * Only these application domains are eligible.
 *
 * The actual endpoint must ALSO pass the method/path
 * allow-list below.
 */

const SAFE_PREFIXES = [
  '/api/billing-workspace',
  '/api/invoices',
  '/api/inventory',
  '/api/tickets',
  '/api/employees',
  '/api/workflows',
  '/api/billing-agents',
  '/api/agent-portal/extensions',
  '/api/settings',
  '/api/ai-tasks',
  '/api/operator-access',
  '/api/operator-agent',
];


/* --------------------------------------------------------
 * ROUTE ALLOW LIST
 *
 * Generated from the live production inventory.
 * -------------------------------------------------------- */

const ALLOWED = [

  // Billing workspace
  ['POST', /^\/api\/billing-workspace\/ip-pools$/],
  ['POST', /^\/api\/billing-workspace\/plans$/],

  ['POST', /^\/api\/billing-workspace\/subscribers$/],
  ['PATCH', /^\/api\/billing-workspace\/subscribers\/\d+$/],
  ['DELETE', /^\/api\/billing-workspace\/subscribers\/\d+$/],

  ['POST', /^\/api\/billing-workspace\/subscribers\/\d+\/recharge$/],
  ['POST', /^\/api\/billing-workspace\/subscribers\/\d+\/extend$/],
  ['POST', /^\/api\/billing-workspace\/subscribers\/\d+\/radius$/],
  ['POST', /^\/api\/billing-workspace\/subscribers\/\d+\/radius\/sync$/],

  ['PATCH', /^\/api\/billing-workspace\/hotspot\/subscribers\/\d+$/],
  ['POST', /^\/api\/billing-workspace\/hotspot\/subscribers\/\d+\/extend$/],
  ['POST', /^\/api\/billing-workspace\/hotspot\/subscribers\/\d+\/sync$/],
  ['DELETE', /^\/api\/billing-workspace\/hotspot\/subscribers\/\d+$/],

  ['POST', /^\/api\/billing-workspace\/invoices$/],
  ['POST', /^\/api\/billing-workspace\/payments$/],

  ['POST', /^\/api\/billing-workspace\/hotspot\/plans$/],
  ['PATCH', /^\/api\/billing-workspace\/hotspot\/plans\/\d+\/status$/],
  ['DELETE', /^\/api\/billing-workspace\/hotspot\/plans\/\d+$/],

  ['POST', /^\/api\/billing-workspace\/hotspot\/vouchers$/],
  ['DELETE', /^\/api\/billing-workspace\/hotspot\/vouchers\/\d+$/],

  ['PUT', /^\/api\/billing-workspace\/hotspot\/portal-settings$/],
  ['POST', /^\/api\/billing-workspace\/hotspot\/publish$/],


  // Employees
  ['POST', /^\/api\/employees\/?$/],
  ['PUT', /^\/api\/employees\/\d+$/],
  ['DELETE', /^\/api\/employees\/\d+$/],


  // Inventory
  ['POST', /^\/api\/inventory\/?$/],
  ['PUT', /^\/api\/inventory\/\d+$/],
  ['PATCH', /^\/api\/inventory\/\d+\/status$/],


  // Invoice system
  ['PUT', /^\/api\/invoices\/profile$/],
  ['POST', /^\/api\/invoices\/products$/],
  ['PUT', /^\/api\/invoices\/products\/\d+$/],
  ['DELETE', /^\/api\/invoices\/products\/\d+$/],
  ['POST', /^\/api\/invoices\/?$/],
  ['POST', /^\/api\/invoices\/autofill$/],
  ['POST', /^\/api\/invoices\/\d+\/send$/],
  ['POST', /^\/api\/invoices\/send-due\/bulk$/],


  // Tickets / installations
  ['POST', /^\/api\/tickets\/?$/],
  ['POST', /^\/api\/tickets\/installations$/],
  ['POST', /^\/api\/tickets\/installations\/\d+\/reschedule$/],
  ['PATCH', /^\/api\/tickets\/\d+$/],
  ['POST', /^\/api\/tickets\/\d+\/events$/],
  ['DELETE', /^\/api\/tickets\/\d+$/],


  // Workflows
  ['PUT', /^\/api\/workflows\/[^/]+$/],


  // AI tasks
  ['POST', /^\/api\/ai-tasks\/?$/],
  ['POST', /^\/api\/ai-tasks\/\d+\/run$/],
  ['PATCH', /^\/api\/ai-tasks\/\d+\/status$/],


  // Billing agents
  ['POST', /^\/api\/billing-agents\/?$/],
  ['PATCH', /^\/api\/billing-agents\/\d+$/],
  ['PUT', /^\/api\/billing-agents\/settings$/],
  ['POST', /^\/api\/billing-agents\/denominations$/],
  ['DELETE', /^\/api\/billing-agents\/denominations\/\d+$/],
  ['POST', /^\/api\/billing-agents\/wallet\/fund$/],
  ['POST', /^\/api\/billing-agents\/vouchers\/generate$/],
  ['POST', /^\/api\/billing-agents\/vouchers\/\d+\/sms$/],


  // Billing agent portal extensions
  ['POST', /^\/api\/agent-portal\/extensions\/products$/],
  ['PATCH', /^\/api\/agent-portal\/extensions\/products\/\d+$/],
  ['PUT', /^\/api\/agent-portal\/extensions\/profile$/],
  ['POST', /^\/api\/agent-portal\/extensions\/administrators$/],
  ['PATCH', /^\/api\/agent-portal\/extensions\/administrators\/\d+$/],
  ['POST', /^\/api\/agent-portal\/extensions\/vouchers\/generate$/],
  ['POST', /^\/api\/agent-portal\/extensions\/vouchers\/\d+\/sms$/],


  // Approved settings
  ['POST', /^\/api\/settings\/blocked-numbers$/],
  ['DELETE', /^\/api\/settings\/blocked-numbers\/\d+$/],

  ['PUT', /^\/api\/settings\/?$/],
  ['PUT', /^\/api\/settings\/billing$/],
  ['PUT', /^\/api\/settings\/communication$/],
  ['PUT', /^\/api\/settings\/communication\/email$/],
  ['PUT', /^\/api\/settings\/installation-form$/],

  ['POST', /^\/api\/settings\/communication\/send$/],
  ['POST', /^\/api\/settings\/communication\/direct$/],


  // Operator conversations/config
  ['PUT', /^\/api\/operator-agent\/config$/],
  ['PATCH', /^\/api\/operator-agent\/conversations\/\d+$/],
  ['POST', /^\/api\/operator-agent\/conversations\/\d+\/send$/],
];


/*
 * Intentionally NOT exposed initially:
 *
 * - login endpoints
 * - webhook-secret regeneration
 * - PayHero credential changes
 * - credential test endpoints
 * - CSV import deletion
 * - simulated hotspot login
 *
 * They can be added later as high-risk actions.
 */


function normalizeMethod(value) {
  return String(
    value || ''
  )
    .trim()
    .toUpperCase();
}


function normalizePath(value) {

  let path =
    String(
      value || ''
    ).trim();


  if (!path.startsWith('/')) {
    path = `/${path}`;
  }


  /*
   * Prevent URL tricks and query based path bypasses.
   */

  path =
    path.split('?')[0]
      .replace(/\/+/g, '/');


  return path;
}


function routeAllowed(method, path) {

  if (
    BLOCKED_PREFIXES.some(
      prefix =>
        path === prefix ||
        path.startsWith(
          `${prefix}/`
        )
    )
  ) {
    return false;
  }


  if (
    !SAFE_PREFIXES.some(
      prefix =>
        path === prefix ||
        path.startsWith(
          `${prefix}/`
        )
    )
  ) {
    return false;
  }


  return ALLOWED.some(
    ([allowedMethod, pattern]) =>
      allowedMethod === method &&
      pattern.test(path)
  );
}


function riskLevel(method, path) {

  if (
    method === 'DELETE'
  ) {
    return 'critical';
  }


  if (
    /\/payments$/.test(path) ||
    /\/wallet\/fund$/.test(path) ||
    /\/send-due\/bulk$/.test(path)
  ) {
    return 'critical';
  }


  if (
    /\/status$/.test(path) ||
    /\/subscribers\/\d+$/.test(path) ||
    /\/settings/.test(path) ||
    /\/workflows/.test(path)
  ) {
    return 'high';
  }


  return 'standard';
}


/* --------------------------------------------------------
 * SECRET REDACTION
 * -------------------------------------------------------- */

const SECRET_KEY =
  /password|secret|token|api.?key|private.?key|authorization|credential|encrypted/i;


function redact(value) {

  if (
    Array.isArray(value)
  ) {
    return value.map(redact);
  }


  if (
    value &&
    typeof value === 'object'
  ) {

    const result = {};

    for (
      const [key, item]
      of Object.entries(value)
    ) {

      result[key] =
        SECRET_KEY.test(key)
          ? '[REDACTED]'
          : redact(item);
    }

    return result;
  }


  return value;
}


/* --------------------------------------------------------
 * INTERNAL REQUEST
 * -------------------------------------------------------- */

function internalRequest({
  method,
  path,
  body,
  authorization,
}) {

  return new Promise(
    (resolve, reject) => {

      const payload =
        body === undefined
          ? ''
          : JSON.stringify(body);


      const headers = {
        Accept:
          'application/json',

        Authorization:
          authorization,
      };


      if (payload) {

        headers['Content-Type'] =
          'application/json';

        headers['Content-Length'] =
          Buffer.byteLength(payload);
      }


      const request =
        http.request(
          {
            hostname:
              '127.0.0.1',

            port:
              Number(
                process.env.PORT ||
                3001
              ),

            method,

            path,

            headers,

            timeout:
              30000,
          },

          response => {

            let data = '';

            response.setEncoding(
              'utf8'
            );


            response.on(
              'data',
              chunk => {

                data += chunk;

                if (
                  data.length >
                  2 * 1024 * 1024
                ) {
                  request.destroy(
                    new Error(
                      'Internal billing response too large'
                    )
                  );
                }
              }
            );


            response.on(
              'end',
              () => {

                let parsed;

                try {

                  parsed =
                    data
                      ? JSON.parse(data)
                      : {};

                } catch {

                  parsed = {
                    raw:
                      data.slice(
                        0,
                        4000
                      ),
                  };
                }


                resolve({
                  statusCode:
                    response.statusCode,

                  data:
                    parsed,
                });
              }
            );
          }
        );


      request.on(
        'timeout',
        () => {

          request.destroy(
            new Error(
              'Internal billing request timed out'
            )
          );
        }
      );


      request.on(
        'error',
        reject
      );


      if (payload) {
        request.write(payload);
      }

      request.end();
    }
  );
}


/* --------------------------------------------------------
 * SCHEMA
 * -------------------------------------------------------- */

let schemaReady = false;


async function ensureActionSchema() {

  if (schemaReady) {
    return;
  }


  await db.query(`
    CREATE TABLE IF NOT EXISTS
      nexa_billing_actions
    (
      id BIGSERIAL PRIMARY KEY,

      action_token VARCHAR(80)
        NOT NULL UNIQUE,

      client_id INTEGER NOT NULL,

      actor_user_id INTEGER,

      source VARCHAR(40)
        NOT NULL DEFAULT 'nexa',

      method VARCHAR(12)
        NOT NULL,

      path TEXT
        NOT NULL,

      request_body JSONB
        NOT NULL DEFAULT '{}'::jsonb,

      risk_level VARCHAR(20)
        NOT NULL,

      reason TEXT,

      status VARCHAR(30)
        NOT NULL DEFAULT 'prepared',

      response_status INTEGER,

      response_body JSONB,

      created_at TIMESTAMPTZ
        NOT NULL DEFAULT NOW(),

      expires_at TIMESTAMPTZ
        NOT NULL,

      confirmed_at TIMESTAMPTZ,

      executed_at TIMESTAMPTZ
    )
  `);


  await db.query(`
    CREATE INDEX IF NOT EXISTS
      idx_nexa_billing_actions_client
    ON nexa_billing_actions
      (client_id, created_at DESC)
  `);


  schemaReady =
    true;
}


/* --------------------------------------------------------
 * ACCOUNT CHECK
 * -------------------------------------------------------- */

function requireBillingTenant(
  req,
  res,
  next
) {

  if (
    req.scope?.isSuperadmin ||
    !req.scope?.clientId
  ) {

    return res.status(403).json({
      error:
        'Nexa billing actions require a billing tenant.',
    });
  }


  next();
}


router.use(
  requireBillingTenant
);


/* --------------------------------------------------------
 * CAPABILITIES
 * -------------------------------------------------------- */

router.get(
  '/capabilities',
  async (
    req,
    res
  ) => {

    await ensureActionSchema();


    res.json({
      enabled:
        true,

      client_id:
        req.scope.clientId,

      confirmation_required:
        true,

      direct_network_writes:
        false,

      blocked_domains: [
        'mikrotik',
        'network-agent',
        'noc',
        'tr069',
        'routeros',
        'wireguard',
        'firewall',
      ],

      examples: [
        'create subscriber',
        'edit subscriber',
        'suspend subscriber',
        'activate subscriber',
        'recharge subscriber',
        'extend subscriber',
        'create package',
        'disable hotspot package',
        'generate hotspot vouchers',
        'delete unused voucher',
        'create invoice',
        'record payment',
        'create employee',
        'update employee',
        'create ticket',
        'update ticket',
        'send communication',
      ],
    });
  }
);


/* --------------------------------------------------------
 * PREPARE
 *
 * No write to the target billing resource happens here.
 * -------------------------------------------------------- */

router.post(
  '/prepare',
  async (
    req,
    res
  ) => {

    try {

      await ensureActionSchema();


      const method =
        normalizeMethod(
          req.body?.method
        );


      const path =
        normalizePath(
          req.body?.path
        );


      const body =
        req.body?.body &&
        typeof req.body.body === 'object'
          ? req.body.body
          : {};


      if (
        !routeAllowed(
          method,
          path
        )
      ) {

        return res.status(403).json({
          error:
            'This operation is not permitted through Nexa Billing Control.',
        });
      }


      const token =
        crypto
          .randomBytes(24)
          .toString('hex');


      const risk =
        riskLevel(
          method,
          path
        );


      const reason =
        String(
          req.body?.reason ||
          ''
        )
          .trim()
          .slice(
            0,
            1000
          );


      const source =
        String(
          req.body?.source ||
          'nexa_chat'
        )
          .trim()
          .slice(
            0,
            40
          );


      const result =
        await db.query(
          `
          INSERT INTO nexa_billing_actions
          (
            action_token,
            client_id,
            actor_user_id,
            source,
            method,
            path,
            request_body,
            risk_level,
            reason,
            expires_at
          )
          VALUES
          (
            $1,$2,$3,$4,$5,$6,
            $7::jsonb,$8,$9,
            NOW() + INTERVAL '10 minutes'
          )
          RETURNING
            id,
            action_token,
            source,
            method,
            path,
            risk_level,
            reason,
            status,
            created_at,
            expires_at
          `,
          [
            token,

            req.scope.clientId,

            req.user?.id ||
            req.user?.userId ||
            null,

            source,

            method,

            path,

            JSON.stringify(body),

            risk,

            reason,
          ]
        );


      const action =
        result.rows[0];


      res.status(201).json({
        prepared:
          true,

        confirmation_required:
          true,

        action: {
          ...action,

          body:
            redact(body),
        },

        confirmation_text:
          `Confirm ${method} ${path}`,
      });


    } catch (error) {

      console.error(
        'Nexa action prepare error:',
        error.message
      );


      res.status(500).json({
        error:
          'Could not prepare Nexa billing action.',
      });
    }
  }
);


/* --------------------------------------------------------
 * EXECUTE
 *
 * Exactly-once action execution.
 * -------------------------------------------------------- */

router.post(
  '/:token/execute',
  async (
    req,
    res
  ) => {

    const client =
      await db.connect();


    try {

      await ensureActionSchema();


      if (
        req.body?.confirm !== true
      ) {

        return res.status(400).json({
          error:
            'Explicit confirmation is required.',
        });
      }


      await client.query(
        'BEGIN'
      );


      const actionResult =
        await client.query(
          `
          SELECT *
          FROM nexa_billing_actions
          WHERE action_token = $1
            AND client_id = $2
          FOR UPDATE
          `,
          [
            req.params.token,

            req.scope.clientId,
          ]
        );


      const action =
        actionResult.rows[0];


      if (!action) {

        await client.query(
          'ROLLBACK'
        );

        return res.status(404).json({
          error:
            'Nexa action not found.',
        });
      }


      if (
        action.status ===
        'executed'
      ) {

        await client.query(
          'ROLLBACK'
        );

        return res.status(409).json({
          error:
            'This Nexa action has already been executed.',

          already_executed:
            true,
        });
      }


      if (
        new Date(
          action.expires_at
        ).getTime() <
        Date.now()
      ) {

        await client.query(
          `
          UPDATE nexa_billing_actions
          SET status = 'expired'
          WHERE id = $1
          `,
          [action.id]
        );

        await client.query(
          'COMMIT'
        );


        return res.status(410).json({
          error:
            'This Nexa confirmation expired. Prepare the action again.',
        });
      }


      /*
       * Revalidate route at execution time.
       */

      if (
        !routeAllowed(
          action.method,
          action.path
        )
      ) {

        await client.query(
          'ROLLBACK'
        );

        return res.status(403).json({
          error:
            'Action route is no longer permitted.',
        });
      }


      await client.query(
        `
        UPDATE nexa_billing_actions
        SET
          status = 'executing',
          confirmed_at = NOW()
        WHERE id = $1
        `,
        [action.id]
      );


      await client.query(
        'COMMIT'
      );


      /*
       * We deliberately use the SAME authenticated
       * user token, so the existing billing API keeps
       * enforcing its normal tenant and permission
       * rules.
       */

      const authorization =
        req.get(
          'authorization'
        );


      if (!authorization) {

        throw new Error(
          'Authorization header unavailable'
        );
      }


      const response =
        await internalRequest({
          method:
            action.method,

          path:
            action.path,

          body:
            action.request_body,

          authorization,
        });


      const success =
        response.statusCode >= 200 &&
        response.statusCode < 300;


      await db.query(
        `
        UPDATE nexa_billing_actions
        SET
          status = $1,
          response_status = $2,
          response_body = $3::jsonb,
          executed_at = NOW()
        WHERE id = $4
        `,
        [
          success
            ? 'executed'
            : 'failed',

          response.statusCode,

          JSON.stringify(
            redact(
              response.data
            )
          ),

          action.id,
        ]
      );


      if (!success) {

        return res
          .status(
            response.statusCode ||
            400
          )
          .json({
            executed:
              false,

            action_token:
              action.action_token,

            billing_response:
              redact(
                response.data
              ),
          });
      }


      res.json({
        executed:
          true,

        action_token:
          action.action_token,

        method:
          action.method,

        path:
          action.path,

        result:
          redact(
            response.data
          ),
      });


    } catch (error) {

      try {
        await client.query(
          'ROLLBACK'
        );
      } catch (_) {
        // no-op
      }


      console.error(
        'Nexa action execute error:',
        error.message
      );


      res.status(500).json({
        error:
          'Nexa could not execute the billing action.',
      });


    } finally {

      client.release();
    }
  }
);


/* --------------------------------------------------------
 * ACTION HISTORY
 * -------------------------------------------------------- */

router.get(
  '/history',
  async (
    req,
    res
  ) => {

    try {

      await ensureActionSchema();


      const result =
        await db.query(
          `
          SELECT
            id,
            action_token,
            source,
            method,
            path,
            risk_level,
            reason,
            status,
            response_status,
            created_at,
            confirmed_at,
            executed_at
          FROM nexa_billing_actions
          WHERE client_id = $1
          ORDER BY created_at DESC
          LIMIT 100
          `,
          [
            req.scope.clientId,
          ]
        );


      res.json(
        result.rows
      );


    } catch (error) {

      res.status(500).json({
        error:
          'Failed to load Nexa action history.',
      });
    }
  }
);


module.exports =
  router;

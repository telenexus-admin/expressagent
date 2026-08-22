const express = require('express');
const db = require('../db');
const { authMiddleware, scopeMiddleware } = require('../middleware/auth');
const { generateAIResponse } = require('../services/openai');
const { listRouters } = require('../services/mikrotik');
const {
  buildNexaKnowledgeContext,
  getKnowledgeEntity,
  getKnowledgeHealth,
  getKnowledgeSummary,
  listKnowledgeEntities,
  searchKnowledge,
} = require('../services/knowledgeProcessor');
const {
  getLLMHealth,
  listKnowledgeInsights,
  sanitizeTextForLLM,
} = require('../services/knowledgeLLM');
const {
  buildNexaTwinContext,
  getTwinEntity,
  getTwinHealth,
  getTwinImpact,
  listTwinEntities,
  observeTwinEntities,
} = require('../services/digitalTwin');
const {
  getTwinStabilityReport,
  listTwinAlerts,
} = require('../services/twinStability');
const { buildIncidentContext } = require('../services/incidentCommander');
const { buildNetworkAutomationContext } = require('../services/networkAutomation');
const { buildNetworkExecutionContext } = require('../services/networkExecutor');
const {
  PLATFORM_CAPABILITY_CONTEXT,
  getCapabilityResponse,
} = require('../services/nexaCapabilities');

const router = express.Router();
router.use(authMiddleware, scopeMiddleware);

function resolveTargetClient(req, res) {
  if (req.scope.isSuperadmin && !req.scope.clientId) {
    res.status(400).json({ error: 'clientId query parameter is required for superadmin' });
    return null;
  }
  return req.scope.clientId;
}

function cleanQuestion(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 1000);
}

function cleanHistory(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(-8).map((item) => ({
    role: item?.role === 'assistant' ? 'assistant' : 'user',
    content: sanitizeTextForLLM(String(item?.content || ''), 1600),
  })).filter((item) => item.content);
}


/* nexa-live-account-intelligence */


async function safeNexaContext(
  label,
  builder
) {
  try {
    const value =
      await builder();

    return {
      context:
        String(
          value?.context ||
          ''
        ),

      sources:
        Array.isArray(
          value?.sources
        )
          ? value.sources
          : [],

      ...value,

      context_error:
        null,
    };

  } catch (error) {

    console.error(
      `Nexa ${label} context error:`,
      error.message
    );

    return {
      context:
        '',

      sources:
        [],

      context_error:
        error.message ||
        `Failed to load ${label}`,
    };
  }
}


function cleanRouterStatus(value) {
  const status =
    String(
      value ||
      'unknown'
    )
      .trim()
      .toLowerCase();

  if (
    [
      'online',
      'offline',
      'checking',
      'unknown',
      'pending',
      'inactive',
    ].includes(status)
  ) {
    return status;
  }

  if (
    [
      'active',
      'connected',
      'up',
    ].includes(status)
  ) {
    return 'online';
  }

  if (
    [
      'error',
      'failed',
      'disconnected',
      'down',
    ].includes(status)
  ) {
    return 'offline';
  }

  return 'unknown';
}


function routerObservedAt(router) {
  const candidates = [
    router.status_checked_at,
    router.last_seen_at,
    router.updated_at,
    router.created_at,
  ];

  for (const candidate of candidates) {

    if (!candidate) {
      continue;
    }

    const parsed =
      new Date(candidate);

    if (
      !Number.isNaN(
        parsed.getTime()
      )
    ) {
      return parsed;
    }
  }

  return new Date();
}


async function buildLiveRouterContext(
  clientId
) {
  const raw =
    await listRouters(
      clientId
    );

  const routers =
    (
      Array.isArray(raw)
        ? raw
        : Array.isArray(
            raw?.routers
          )
          ? raw.routers
          : []
    )
      .filter(Boolean)
      .map(router => {

        const status =
          cleanRouterStatus(
            router.last_status ||
            router.status
          );

        const observedAt =
          routerObservedAt(
            router
          );

        return {
          id:
            router.id,

          name:
            router.name ||
            router.last_identity ||
            `Router ${router.id}`,

          host:
            router.host ||
            router.wireguard_tunnel_ip ||
            '',

          port:
            Number(
              router.port ||
              8728
            ),

          is_active:
            router.is_active !==
            false,

          status,

          status_source:
            router.status_source ||
            'router_registry',

          observed_at:
            observedAt
              .toISOString(),

          last_seen_at:
            router.last_seen_at ||
            null,

          last_error:
            String(
              router.last_error ||
              ''
            )
              .slice(
                0,
                300
              ),

          identity:
            router.last_identity ||
            '',

          version:
            router.last_version ||
            '',

          uptime:
            router.last_uptime ||
            '',

          provisioning_status:
            router.provisioning_status ||
            '',
        };
      });


  const activeRouters =
    routers.filter(
      router =>
        router.is_active
    );


  const counts = {
    total:
      routers.length,

    active:
      activeRouters.length,

    online:
      activeRouters
        .filter(
          router =>
            router.status ===
            'online'
        )
        .length,

    offline:
      activeRouters
        .filter(
          router =>
            router.status ===
            'offline'
        )
        .length,

    checking:
      activeRouters
        .filter(
          router =>
            router.status ===
            'checking'
        )
        .length,

    unknown:
      activeRouters
        .filter(
          router =>
            [
              'unknown',
              'pending',
            ].includes(
              router.status
            )
        )
        .length,

    inactive:
      routers
        .filter(
          router =>
            !router.is_active ||
            router.status ===
            'inactive'
        )
        .length,
  };


  /*
   * Refresh router entities in the Digital Twin
   * from the exact status that powers the Router UI.
   *
   * This does NOT modify routers.
   * It only updates Nexa's observational model.
   */

  if (routers.length) {

    const observations =
      routers.map(
        router => {

          const state = {
            operational_status:
              router.status,

            is_active:
              router.is_active,

            host:
              router.host,

            api_port:
              router.port,

            status_source:
              router.status_source,

            last_seen_at:
              router.last_seen_at,

            last_error:
              router.last_error,

            identity:
              router.identity,

            routeros_version:
              router.version,

            uptime:
              router.uptime,

            provisioning_status:
              router.provisioning_status,
          };


          if (
            router.status ===
            'online'
          ) {
            state.online =
              true;

            state.health_status =
              'healthy';

          } else if (
            router.status ===
            'offline'
          ) {
            state.online =
              false;

            state.health_status =
              'critical';

          } else {
            state.health_status =
              'unknown';
          }


          return {
            clientId,

            eventType:
              router.status ===
              'online'
                ? 'router.observed'
                : router.status ===
                  'offline'
                  ? 'router.offline'
                  : 'router.status_observed',

            category:
              'network',

            source:
              'nexa_live_router_source',

            entityType:
              'router',

            entityId:
              router.id,

            displayName:
              router.name,

            state,

            severity:
              router.status ===
              'offline'
                ? 'critical'
                : 'info',

            observedAt:
              router.observed_at,

            sensitivity:
              'restricted',
          };
        }
      );


    await observeTwinEntities(
      observations
    ).catch(
      error => {
        /*
         * Direct live router intelligence must
         * remain available even if Twin storage
         * is temporarily unhealthy.
         */
        console.error(
          'Nexa live router twin sync error:',
          error.message
        );
      }
    );
  }


  const lines = [
    (
      `[live-router-summary] ` +
      `total=${counts.total} ` +
      `active=${counts.active} ` +
      `online=${counts.online} ` +
      `offline=${counts.offline} ` +
      `checking=${counts.checking} ` +
      `unknown=${counts.unknown} ` +
      `inactive=${counts.inactive}`
    ),

    ...routers.map(
      router =>
        (
          `[live-router:${router.id}] ` +
          `name=${JSON.stringify(
            router.name
          )} ` +
          `status=${router.status} ` +
          `source=${router.status_source} ` +
          `host=${router.host || 'unknown'} ` +
          `observed=${router.observed_at} ` +
          `last_seen=${
            router.last_seen_at ||
            'unknown'
          } ` +
          `routeros=${
            router.version ||
            'unknown'
          } ` +
          `provisioning=${
            router.provisioning_status ||
            'unknown'
          }`
        )
    ),
  ];


  return {
    context:
      lines.join(
        '\n'
      ),

    routers,

    counts,

    sources:
      routers.map(
        router => ({
          source_type:
            'live_router_status',

          entity_type:
            'router',

          entity_id:
            String(
              router.id
            ),

          name:
            router.name,

          status:
            router.status,

          observed_at:
            router.observed_at,

          status_source:
            router.status_source,
        })
      ),
  };
}


function routerQuestionKind(
  question
) {
  const q =
    String(
      question ||
      ''
    ).toLowerCase();

  const routerQuestion =
    /\brouters?\b|\bmikrotik\b/.test(
      q
    );

  if (!routerQuestion) {
    return null;
  }


  const countQuestion =
    /\bhow many\b|\bcount\b|\bnumber of\b/.test(
      q
    );


  if (
    countQuestion &&
    /\bonline\b|\bup\b|\bconnected\b/.test(
      q
    )
  ) {
    return 'online_count';
  }


  if (
    countQuestion &&
    /\boffline\b|\bdown\b|\bdisconnected\b/.test(
      q
    )
  ) {
    return 'offline_count';
  }


  if (countQuestion) {
    return 'total_count';
  }


  if (
    /\bwhich\b|\blist\b|\bshow\b/.test(
      q
    ) &&
    /\bonline\b/.test(
      q
    )
  ) {
    return 'online_list';
  }


  if (
    /\bwhich\b|\blist\b|\bshow\b/.test(
      q
    ) &&
    /\boffline\b/.test(
      q
    )
  ) {
    return 'offline_list';
  }


  return null;
}


function directRouterAnswer(
  question,
  live
) {
  const kind =
    routerQuestionKind(
      question
    );

  if (!kind) {
    return null;
  }


  const routers =
    live?.routers ||
    [];

  const counts =
    live?.counts ||
    {
      total: 0,
      active: 0,
      online: 0,
      offline: 0,
      checking: 0,
      unknown: 0,
      inactive: 0,
    };


  const online =
    routers.filter(
      router =>
        router.is_active &&
        router.status ===
        'online'
    );


  const offline =
    routers.filter(
      router =>
        router.is_active &&
        router.status ===
        'offline'
    );


  const uncertain =
    routers.filter(
      router =>
        router.is_active &&
        [
          'checking',
          'unknown',
          'pending',
        ].includes(
          router.status
        )
    );


  const names =
    rows =>
      rows.length
        ? rows
            .map(
              row =>
                row.name
            )
            .join(', ')
        : 'none';


  if (
    kind ===
    'online_count'
  ) {
    return (
      `You currently have ${counts.online} ` +
      `${counts.online === 1 ? 'router' : 'routers'} online ` +
      `out of ${counts.active} active ` +
      `${counts.active === 1 ? 'router' : 'routers'}. ` +
      `Online: ${names(online)}.` +
      (
        offline.length
          ? ` Offline: ${names(offline)}.`
          : ''
      ) +
      (
        uncertain.length
          ? ` Waiting for a confirmed live state: ${names(uncertain)}.`
          : ''
      )
    );
  }


  if (
    kind ===
    'offline_count'
  ) {
    return (
      `You currently have ${counts.offline} ` +
      `${counts.offline === 1 ? 'router' : 'routers'} offline ` +
      `out of ${counts.active} active ` +
      `${counts.active === 1 ? 'router' : 'routers'}. ` +
      `Offline: ${names(offline)}.`
    );
  }


  if (
    kind ===
    'total_count'
  ) {
    return (
      `You have ${counts.total} ` +
      `${counts.total === 1 ? 'router' : 'routers'} configured. ` +
      `${counts.online} online, ` +
      `${counts.offline} offline, ` +
      `${counts.checking + counts.unknown} awaiting a confirmed state, ` +
      `and ${counts.inactive} inactive.`
    );
  }


  if (
    kind ===
    'online_list'
  ) {
    return (
      online.length
        ? `The routers currently online are: ${names(online)}.`
        : 'No router currently has a confirmed online state.'
    );
  }


  if (
    kind ===
    'offline_list'
  ) {
    return (
      offline.length
        ? `The routers currently offline are: ${names(offline)}.`
        : 'No active router currently has a confirmed offline state.'
    );
  }


  return null;
}


function liveRouterFallback(
  live
) {
  const counts =
    live?.counts;

  if (!counts) {
    return (
      'I reached Nexa, but the live account sources ' +
      'did not return enough evidence for this request.'
    );
  }

  return (
    `I can still see the live router state: ` +
    `${counts.online} online, ` +
    `${counts.offline} offline, ` +
    `${counts.checking + counts.unknown} awaiting confirmation ` +
    `across ${counts.active} active routers.`
  );
}



/* nexa-live-complete-account-snapshot */


const NEXA_SECRET_KEY_PATTERN =
  /password|passwd|secret|token|api[_-]?key|private[_-]?key|credential|authorization|auth[_-]?header|encrypted|basic[_-]?auth|access[_-]?token|refresh[_-]?token/i;


const NEXA_NOISE_TABLE_PATTERN =
  /^(billing_events|billing_event_|billing_knowledge_|billing_twin_|pg_|schema_|migrations?$)/i;


let nexaTenantTableCache = {
  loadedAt: 0,
  names: [],
};


function nexaSafeScalar(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return value;
  }

  if (typeof value === 'string') {
    return value
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 700);
  }

  if (
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return value;
}


function nexaSanitizeObject(
  value,
  depth = 0
) {
  if (depth > 4) {
    return '[nested]';
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, 30)
      .map(
        item =>
          nexaSanitizeObject(
            item,
            depth + 1
          )
      );
  }

  if (
    !value ||
    typeof value !== 'object'
  ) {
    return nexaSafeScalar(
      value
    );
  }


  const output = {};

  for (
    const [key, raw] of
    Object.entries(value).slice(
      0,
      80
    )
  ) {
    if (
      NEXA_SECRET_KEY_PATTERN.test(
        key
      )
    ) {
      /*
       * Nexa may know that a credential exists,
       * but the credential itself never enters
       * the model context.
       */
      output[key] =
        raw
          ? '[configured]'
          : '[not configured]';

      continue;
    }


    /*
     * Huge raw router/provider payloads add noise.
     * Keep their existence without dumping them.
     */
    if (
      /^(raw|raw_payload|payload_raw|response_body)$/i.test(
        key
      )
    ) {
      output[key] =
        raw
          ? '[available]'
          : null;

      continue;
    }


    output[key] =
      nexaSanitizeObject(
        raw,
        depth + 1
      );
  }

  return output;
}


function nexaSafeTableName(name) {
  const value =
    String(
      name ||
      ''
    );

  if (
    !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(
      value
    )
  ) {
    throw new Error(
      'Unsafe database table name'
    );
  }

  return `"${value}"`;
}


async function nexaTenantTables() {
  const now =
    Date.now();

  if (
    nexaTenantTableCache.names.length &&
    now -
      nexaTenantTableCache.loadedAt <
      60 * 1000
  ) {
    return nexaTenantTableCache.names;
  }


  const result =
    await db.query(`
      SELECT DISTINCT
        columns.table_name

      FROM information_schema.columns columns

      JOIN information_schema.tables tables
        ON tables.table_schema =
           columns.table_schema
       AND tables.table_name =
           columns.table_name

      WHERE columns.table_schema =
            'public'

        AND columns.column_name =
            'client_id'

        AND tables.table_type =
            'BASE TABLE'

      ORDER BY columns.table_name
    `);


  const names =
    result.rows
      .map(
        row =>
          String(
            row.table_name ||
            ''
          )
      )
      .filter(Boolean)
      .filter(
        name =>
          !NEXA_NOISE_TABLE_PATTERN.test(
            name
          )
      );


  nexaTenantTableCache = {
    loadedAt:
      now,

    names,
  };


  return names;
}


async function nexaTableHasColumn(
  table,
  column
) {
  const result =
    await db.query(
      `SELECT EXISTS (
         SELECT 1

         FROM information_schema.columns

         WHERE table_schema =
               'public'
           AND table_name = $1
           AND column_name = $2
       ) AS found`,
      [
        table,
        column,
      ]
    );

  return Boolean(
    result.rows[0]?.found
  );
}


async function nexaTableCount(
  table,
  clientId
) {
  const quoted =
    nexaSafeTableName(
      table
    );

  const result =
    await db.query(
      `SELECT COUNT(*)::int AS total
       FROM ${quoted}
       WHERE client_id = $1`,
      [
        clientId,
      ]
    );

  return Number(
    result.rows[0]?.total ||
    0
  );
}


async function nexaTableSample(
  table,
  clientId,
  limit = 5
) {
  const quoted =
    nexaSafeTableName(
      table
    );

  const hasId =
    await nexaTableHasColumn(
      table,
      'id'
    );

  const hasUpdated =
    await nexaTableHasColumn(
      table,
      'updated_at'
    );

  const hasCreated =
    await nexaTableHasColumn(
      table,
      'created_at'
    );


  let order = '';

  if (hasUpdated) {
    order =
      ' ORDER BY updated_at DESC NULLS LAST';

  } else if (hasCreated) {
    order =
      ' ORDER BY created_at DESC NULLS LAST';

  } else if (hasId) {
    order =
      ' ORDER BY id DESC';
  }


  const result =
    await db.query(
      `SELECT to_jsonb(row_data) AS item

       FROM (
         SELECT *
         FROM ${quoted}
         WHERE client_id = $1
         ${order}
         LIMIT $2
       ) row_data`,
      [
        clientId,
        Math.max(
          1,
          Math.min(
            Number(limit) || 5,
            15
          )
        ),
      ]
    );


  return result.rows.map(
    row =>
      nexaSanitizeObject(
        row.item ||
        {}
      )
  );
}


async function nexaSafeQuery(
  label,
  sql,
  params = []
) {
  try {
    const result =
      await db.query(
        sql,
        params
      );

    return {
      label,
      rows:
        result.rows || [],
      error:
        null,
    };

  } catch (error) {
    console.error(
      `Nexa live ${label} query error:`,
      error.message
    );

    return {
      label,
      rows: [],
      error:
        error.message,
    };
  }
}


function nexaNumber(value) {
  const number =
    Number(value || 0);

  return Number.isFinite(number)
    ? number
    : 0;
}


function nexaMoney(value) {
  return nexaNumber(
    value
  );
}


function nexaQuestionDomains(
  question
) {
  const q =
    String(
      question ||
      ''
    ).toLowerCase();


  const domains =
    new Set();


  const rules = [
    [
      'subscriber',
      /\b(subscriber|customer|client|user|account)\b/,
    ],

    [
      'payment',
      /\b(payment|collection|collect|revenue|income|money|mpesa|m-pesa|paid)\b/,
    ],

    [
      'invoice',
      /\b(invoice|outstanding|overdue|debt|owed|owing)\b/,
    ],

    [
      'voucher',
      /\b(voucher|access code)\b/,
    ],

    [
      'package',
      /\b(package|plan|speed|tariff)\b/,
    ],

    [
      'router',
      /\b(router|mikrotik|network)\b/,
    ],

    [
      'radius',
      /\b(radius|authentication|session|pppoe)\b/,
    ],

    [
      'communication',
      /\b(communication|sms|whatsapp|message|call)\b/,
    ],

    [
      'employee',
      /\b(employee|staff|team|agent)\b/,
    ],

    [
      'ticket',
      /\b(ticket|support|complaint|issue)\b/,
    ],

    [
      'hotspot',
      /\b(hotspot|wifi|wi-fi)\b/,
    ],
  ];


  for (
    const [domain, regex] of rules
  ) {
    if (regex.test(q)) {
      domains.add(
        domain
      );
    }
  }


  if (
    /\b(everything|overview|summary|business|account|today|status|briefing)\b/.test(
      q
    )
  ) {
    domains.add(
      'overview'
    );
  }


  return domains;
}


function nexaTableRelevant(
  table,
  domains
) {
  if (
    domains.has(
      'overview'
    )
  ) {
    return [
      'billing_subscribers',
      'billing_hotspot_subscribers',
      'billing_payments',
      'payhero_payment_requests',
      'billing_invoices',
      'billing_hotspot_vouchers',
      'billing_plans',
      'billing_hotspot_plans',
      'mikrotik_routers',
      'mikrotik_clients',
      'employees',
      'tickets',
      'billing_communication_jobs',
    ].includes(
      table
    );
  }


  const name =
    table.toLowerCase();


  if (
    domains.has('subscriber') &&
    /subscriber|client/.test(name)
  ) {
    return true;
  }

  if (
    domains.has('payment') &&
    /payment|payhero|collection|transaction/.test(
      name
    )
  ) {
    return true;
  }

  if (
    domains.has('invoice') &&
    /invoice/.test(name)
  ) {
    return true;
  }

  if (
    domains.has('voucher') &&
    /voucher/.test(name)
  ) {
    return true;
  }

  if (
    domains.has('package') &&
    /plan|package/.test(name)
  ) {
    return true;
  }

  if (
    domains.has('router') &&
    /router|mikrotik|network/.test(name)
  ) {
    return true;
  }

  if (
    domains.has('radius') &&
    /radius|pppoe|session/.test(name)
  ) {
    return true;
  }

  if (
    domains.has('communication') &&
    /communication|message|sms|whatsapp|notification/.test(
      name
    )
  ) {
    return true;
  }

  if (
    domains.has('employee') &&
    /employee|staff|agent/.test(name)
  ) {
    return true;
  }

  if (
    domains.has('ticket') &&
    /ticket|support/.test(name)
  ) {
    return true;
  }

  if (
    domains.has('hotspot') &&
    /hotspot|voucher/.test(name)
  ) {
    return true;
  }


  return false;
}


async function buildNexaCoreMetrics(
  clientId
) {
  const [
    subscriberSummary,
    standardCollections,
    hotspotCollections,
    invoiceSummary,
    voucherSummary,
    packageSummary,
    recentStandardPayments,
    recentHotspotPayments,
  ] = await Promise.all([

    nexaSafeQuery(
      'subscriber_summary',

      `SELECT
         (
           SELECT COUNT(*)
           FROM mikrotik_clients
           WHERE client_id = $1
             AND service_type <> 'hotspot'
         )
         +
         (
           SELECT COUNT(*)
           FROM billing_hotspot_subscribers
           WHERE client_id = $1
             AND current_mac IS NOT NULL
             AND status <> 'replaced'
         ) AS total,

         (
           SELECT COUNT(*)
           FROM mikrotik_clients
           WHERE client_id = $1
             AND service_type <> 'hotspot'
             AND is_online = TRUE
         )
         +
         (
           SELECT COUNT(*)
           FROM billing_hotspot_subscribers subscriber

           WHERE subscriber.client_id = $1
             AND subscriber.current_mac IS NOT NULL
             AND subscriber.status <> 'replaced'
             AND subscriber.expires_at > NOW()

             AND EXISTS (
               SELECT 1

               FROM mikrotik_clients live

               WHERE live.client_id =
                     subscriber.client_id

                 AND live.service_type =
                     'hotspot'

                 AND live.is_online =
                     TRUE

                 AND UPPER(
                       REGEXP_REPLACE(
                         COALESCE(
                           live.mac_address,
                           live.username,
                           ''
                         ),
                         '[^0-9A-Fa-f]',
                         '',
                         'g'
                       )
                     )
                     =
                     UPPER(
                       REGEXP_REPLACE(
                         subscriber.current_mac,
                         '[^0-9A-Fa-f]',
                         '',
                         'g'
                       )
                     )
             )
         ) AS online,

         (
           SELECT COUNT(*)
           FROM mikrotik_clients
           WHERE client_id = $1
             AND service_type = 'pppoe'
         ) AS pppoe,

         (
           SELECT COUNT(*)
           FROM mikrotik_clients
           WHERE client_id = $1
             AND service_type = 'dhcp'
         ) AS static,

         (
           SELECT COUNT(*)
           FROM billing_hotspot_subscribers
           WHERE client_id = $1
             AND current_mac IS NOT NULL
             AND status <> 'replaced'
         ) AS hotspot`,

      [
        clientId,
      ]
    ),


    nexaSafeQuery(
      'standard_collections',

      `SELECT
         COALESCE(
           SUM(amount)
             FILTER (
               WHERE status = 'completed'
             ),
           0
         )::numeric AS all_time,

         COALESCE(
           SUM(amount)
             FILTER (
               WHERE status = 'completed'
                 AND paid_at >=
                     DATE_TRUNC(
                       'month',
                       CURRENT_DATE
                     )
                 AND paid_at <
                     DATE_TRUNC(
                       'month',
                       CURRENT_DATE
                     )
                     +
                     INTERVAL '1 month'
             ),
           0
         )::numeric AS month,

         COALESCE(
           SUM(amount)
             FILTER (
               WHERE status = 'completed'
                 AND paid_at >=
                     CURRENT_DATE
                 AND paid_at <
                     CURRENT_DATE
                     +
                     INTERVAL '1 day'
             ),
           0
         )::numeric AS today,

         COUNT(*)
           FILTER (
             WHERE status = 'completed'
           )::int AS completed_count

       FROM billing_payments
       WHERE client_id = $1`,

      [
        clientId,
      ]
    ),


    nexaSafeQuery(
      'hotspot_collections',

      `SELECT
         COALESCE(
           SUM(amount)
             FILTER (
               WHERE status = 'paid'
                 AND metadata->>'purpose' =
                     'hotspot'
             ),
           0
         )::numeric AS all_time,

         COALESCE(
           SUM(amount)
             FILTER (
               WHERE status = 'paid'
                 AND metadata->>'purpose' =
                     'hotspot'

                 AND updated_at >=
                     DATE_TRUNC(
                       'month',
                       CURRENT_DATE
                     )

                 AND updated_at <
                     DATE_TRUNC(
                       'month',
                       CURRENT_DATE
                     )
                     +
                     INTERVAL '1 month'
             ),
           0
         )::numeric AS month,

         COALESCE(
           SUM(amount)
             FILTER (
               WHERE status = 'paid'
                 AND metadata->>'purpose' =
                     'hotspot'

                 AND updated_at >=
                     CURRENT_DATE

                 AND updated_at <
                     CURRENT_DATE
                     +
                     INTERVAL '1 day'
             ),
           0
         )::numeric AS today,

         COUNT(*)
           FILTER (
             WHERE status = 'paid'
               AND metadata->>'purpose' =
                   'hotspot'
           )::int AS paid_count

       FROM payhero_payment_requests
       WHERE client_id = $1`,

      [
        clientId,
      ]
    ),


    nexaSafeQuery(
      'invoice_summary',

      `SELECT
         COUNT(*)::int AS total,

         COUNT(*)
           FILTER (
             WHERE status = 'paid'
           )::int AS paid,

         COUNT(*)
           FILTER (
             WHERE status = 'overdue'
           )::int AS overdue,

         COUNT(*)
           FILTER (
             WHERE status = 'issued'
           )::int AS issued,

         COALESCE(
           SUM(amount)
             FILTER (
               WHERE status IN (
                 'issued',
                 'overdue'
               )
             ),
           0
         )::numeric AS outstanding

       FROM billing_invoices
       WHERE client_id = $1`,

      [
        clientId,
      ]
    ),


    nexaSafeQuery(
      'voucher_summary',

      `SELECT
         COUNT(*)::int AS total,

         COUNT(*)
           FILTER (
             WHERE status = 'available'
           )::int AS available,

         COUNT(*)
           FILTER (
             WHERE status = 'active'
           )::int AS active,

         COUNT(*)
           FILTER (
             WHERE status = 'expired'
           )::int AS expired

       FROM billing_hotspot_vouchers
       WHERE client_id = $1`,

      [
        clientId,
      ]
    ),


    nexaSafeQuery(
      'package_summary',

      `SELECT
         (
           SELECT COUNT(*)
           FROM billing_plans
           WHERE client_id = $1
         )::int AS pppoe_total,

         (
           SELECT COUNT(*)
           FROM billing_plans
           WHERE client_id = $1
             AND is_active = TRUE
         )::int AS pppoe_active,

         (
           SELECT COUNT(*)
           FROM billing_hotspot_plans
           WHERE client_id = $1
         )::int AS hotspot_total,

         (
           SELECT COUNT(*)
           FROM billing_hotspot_plans
           WHERE client_id = $1
             AND is_active = TRUE
         )::int AS hotspot_active`,

      [
        clientId,
      ]
    ),


    nexaSafeQuery(
      'recent_standard_payments',

      `SELECT
         id,
         amount,
         method,
         reference,
         status,
         paid_at

       FROM billing_payments

       WHERE client_id = $1

       ORDER BY paid_at DESC NULLS LAST,
                id DESC

       LIMIT 8`,

      [
        clientId,
      ]
    ),


    nexaSafeQuery(
      'recent_hotspot_payments',

      `SELECT
         id,
         amount,
         status,
         customer_phone,
         mpesa_receipt_number,
         external_reference,
         updated_at,
         metadata

       FROM payhero_payment_requests

       WHERE client_id = $1
         AND metadata->>'purpose' =
             'hotspot'

       ORDER BY updated_at DESC,
                id DESC

       LIMIT 8`,

      [
        clientId,
      ]
    ),
  ]);


  const subscribers =
    subscriberSummary.rows[0] ||
    {};


  const totalSubscribers =
    nexaNumber(
      subscribers.total
    );

  const onlineSubscribers =
    nexaNumber(
      subscribers.online
    );


  const standard =
    standardCollections.rows[0] ||
    {};

  const hotspot =
    hotspotCollections.rows[0] ||
    {};


  const collections = {
    today:
      nexaMoney(
        standard.today
      ) +
      nexaMoney(
        hotspot.today
      ),

    month:
      nexaMoney(
        standard.month
      ) +
      nexaMoney(
        hotspot.month
      ),

    all_time:
      nexaMoney(
        standard.all_time
      ) +
      nexaMoney(
        hotspot.all_time
      ),

    standard_month:
      nexaMoney(
        standard.month
      ),

    hotspot_month:
      nexaMoney(
        hotspot.month
      ),

    completed_standard_payments:
      nexaNumber(
        standard.completed_count
      ),

    completed_hotspot_payments:
      nexaNumber(
        hotspot.paid_count
      ),
  };


  return {
    subscribers: {
      total:
        totalSubscribers,

      online:
        onlineSubscribers,

      offline:
        Math.max(
          0,
          totalSubscribers -
          onlineSubscribers
        ),

      pppoe:
        nexaNumber(
          subscribers.pppoe
        ),

      static:
        nexaNumber(
          subscribers.static
        ),

      hotspot:
        nexaNumber(
          subscribers.hotspot
        ),
    },

    collections,

    invoices:
      nexaSanitizeObject(
        invoiceSummary.rows[0] ||
        {}
      ),

    vouchers:
      nexaSanitizeObject(
        voucherSummary.rows[0] ||
        {}
      ),

    packages:
      nexaSanitizeObject(
        packageSummary.rows[0] ||
        {}
      ),

    recent_payments: [
      ...recentStandardPayments.rows
        .map(
          row => ({
            source:
              'billing',

            ...nexaSanitizeObject(
              row
            ),
          })
        ),

      ...recentHotspotPayments.rows
        .map(
          row => ({
            source:
              'hotspot',

            ...nexaSanitizeObject(
              row
            ),
          })
        ),
    ]
      .sort(
        (a, b) => {
          const at =
            new Date(
              a.paid_at ||
              a.updated_at ||
              0
            ).getTime();

          const bt =
            new Date(
              b.paid_at ||
              b.updated_at ||
              0
            ).getTime();

          return bt - at;
        }
      )
      .slice(
        0,
        10
      ),

    errors: [
      subscriberSummary,
      standardCollections,
      hotspotCollections,
      invoiceSummary,
      voucherSummary,
      packageSummary,
      recentStandardPayments,
      recentHotspotPayments,
    ]
      .filter(
        item =>
          item.error
      )
      .map(
        item => ({
          source:
            item.label,

          error:
            item.error,
        })
      ),
  };
}


async function buildNexaLiveAccountContext(
  clientId,
  question
) {
  const domains =
    nexaQuestionDomains(
      question
    );


  /*
   * Account identity, sanitized.
   */
  const accountResult =
    await nexaSafeQuery(
      'account_profile',

      `SELECT to_jsonb(client) AS item
       FROM clients client
       WHERE id = $1
       LIMIT 1`,

      [
        clientId,
      ]
    );


  const account =
    nexaSanitizeObject(
      accountResult.rows[0]
        ?.item ||
      {}
    );


  /*
   * Exact dashboard/business metrics.
   */
  const metrics =
    await buildNexaCoreMetrics(
      clientId
    );


  /*
   * Automatic discovery:
   *
   * Every present/future tenant-scoped table
   * containing client_id becomes visible to Nexa.
   */
  let tables = [];

  try {
    tables =
      await nexaTenantTables();

  } catch (error) {
    console.error(
      'Nexa tenant table discovery error:',
      error.message
    );
  }


  const inventory =
    [];


  /*
   * Counts for ALL safe tenant tables.
   *
   * A failed or newly changed table never takes
   * the entire Nexa request down.
   */
  for (const table of tables) {
    try {
      const count =
        await nexaTableCount(
          table,
          clientId
        );

      inventory.push({
        table,
        count,
        sample:
          [],
      });

    } catch (error) {
      console.error(
        `Nexa inventory ${table} error:`,
        error.message
      );
    }
  }


  /*
   * Detailed records only for the domain actually
   * being discussed, keeping model context bounded.
   */
  const relevant =
    inventory
      .filter(
        entry =>
          nexaTableRelevant(
            entry.table,
            domains
          )
      )
      .slice(
        0,
        12
      );


  for (const entry of relevant) {
    try {
      entry.sample =
        await nexaTableSample(
          entry.table,
          clientId,
          domains.has('overview')
            ? 3
            : 8
        );

    } catch (error) {
      console.error(
        `Nexa sample ${entry.table} error:`,
        error.message
      );
    }
  }


  const lines = [];


  lines.push(
    '[live-account-profile] ' +
    JSON.stringify(
      account
    )
  );


  lines.push(
    '[live-business-metrics] ' +
    JSON.stringify(
      metrics
    )
  );


  lines.push(
    '[live-account-database-inventory] ' +
    inventory
      .map(
        entry =>
          `${entry.table}=${entry.count}`
      )
      .join(' | ')
  );


  for (const entry of relevant) {
    lines.push(
      `[live-table:${entry.table}] ` +
      `count=${entry.count}` +
      (
        entry.sample.length
          ? ` samples=${JSON.stringify(entry.sample)}`
          : ''
      )
    );
  }


  return {
    context:
      lines.join(
        '\n'
      ),

    account,

    metrics,

    inventory,

    sources: [
      {
        source_type:
          'live_account_database',

        entity_type:
          'billing_account',

        entity_id:
          String(
            clientId
          ),

        observed_at:
          new Date()
            .toISOString(),
      },

      ...relevant.map(
        entry => ({
          source_type:
            'live_account_table',

          entity_type:
            entry.table,

          entity_id:
            String(
              clientId
            ),

          count:
            entry.count,

          observed_at:
            new Date()
              .toISOString(),
        })
      ),
    ],
  };
}


function nexaCurrency(
  value
) {
  return (
    `KSh ${Number(value || 0)
      .toLocaleString(
        'en-KE',
        {
          maximumFractionDigits:
            2,
        }
      )}`
  );
}


function directLiveAccountAnswer(
  question,
  liveAccount
) {
  const q =
    String(
      question ||
      ''
    ).toLowerCase();


  const metrics =
    liveAccount?.metrics;

  if (!metrics) {
    return null;
  }


  const subscribers =
    metrics.subscribers ||
    {};

  const collections =
    metrics.collections ||
    {};

  const invoices =
    metrics.invoices ||
    {};

  const vouchers =
    metrics.vouchers ||
    {};

  const packages =
    metrics.packages ||
    {};


  if (
    /\bhow many\b/.test(q) &&
    /\bsubscriber|customer|client/.test(q)
  ) {
    if (/\bonline\b/.test(q)) {
      return (
        `There are ${subscribers.online || 0} subscribers online ` +
        `out of ${subscribers.total || 0} currently tracked subscribers.`
      );
    }


    if (/\boffline\b/.test(q)) {
      return (
        `There are ${subscribers.offline || 0} subscribers offline ` +
        `out of ${subscribers.total || 0} currently tracked subscribers.`
      );
    }


    return (
      `There are ${subscribers.total || 0} subscribers currently tracked: ` +
      `${subscribers.pppoe || 0} PPPoE, ` +
      `${subscribers.static || 0} static/DHCP and ` +
      `${subscribers.hotspot || 0} hotspot.`
    );
  }


  if (
    /\b(collection|collections|revenue|collected|income)\b/.test(
      q
    )
  ) {
    if (
      /\btoday\b/.test(
        q
      )
    ) {
      return (
        `Today's recorded collections are ${nexaCurrency(collections.today)}.`
      );
    }


    if (
      /\bmonth|monthly|this month\b/.test(
        q
      )
    ) {
      return (
        `Collections this month are ${nexaCurrency(collections.month)}. ` +
        `${nexaCurrency(collections.standard_month)} came through standard billing payments ` +
        `and ${nexaCurrency(collections.hotspot_month)} through paid hotspot packages.`
      );
    }


    return (
      `Recorded collections are ${nexaCurrency(collections.all_time)} all time, ` +
      `with ${nexaCurrency(collections.month)} collected this month ` +
      `and ${nexaCurrency(collections.today)} today.`
    );
  }


  if (
    /\b(outstanding|overdue|invoice|invoices)\b/.test(
      q
    )
  ) {
    return (
      `There are ${Number(invoices.total || 0)} invoices: ` +
      `${Number(invoices.paid || 0)} paid, ` +
      `${Number(invoices.issued || 0)} issued and ` +
      `${Number(invoices.overdue || 0)} overdue. ` +
      `Current outstanding invoiced value is ${nexaCurrency(invoices.outstanding)}.`
    );
  }


  if (
    /\bvoucher|vouchers\b/.test(
      q
    ) &&
    /\bhow many|count|status\b/.test(
      q
    )
  ) {
    return (
      `There are ${Number(vouchers.total || 0)} vouchers: ` +
      `${Number(vouchers.available || 0)} available, ` +
      `${Number(vouchers.active || 0)} active and ` +
      `${Number(vouchers.expired || 0)} expired.`
    );
  }


  if (
    /\b(package|packages|plans)\b/.test(
      q
    ) &&
    /\bhow many|count\b/.test(
      q
    )
  ) {
    const total =
      Number(
        packages.pppoe_total ||
        0
      ) +
      Number(
        packages.hotspot_total ||
        0
      );

    return (
      `There are ${total} packages configured: ` +
      `${Number(packages.pppoe_total || 0)} PPPoE plans ` +
      `and ${Number(packages.hotspot_total || 0)} hotspot plans. ` +
      `${Number(packages.pppoe_active || 0) + Number(packages.hotspot_active || 0)} are active.`
    );
  }


  if (
    /\b(everything|account overview|business overview|full summary|full briefing|what is happening|what's happening)\b/.test(
      q
    )
  ) {
    return [
      `Here is the current live account snapshot.`,

      `Subscribers: ${subscribers.total || 0} total; ${subscribers.online || 0} online; ${subscribers.offline || 0} offline.`,

      `Subscriber mix: ${subscribers.pppoe || 0} PPPoE, ${subscribers.static || 0} static/DHCP, ${subscribers.hotspot || 0} hotspot.`,

      `Collections: ${nexaCurrency(collections.today)} today; ${nexaCurrency(collections.month)} this month; ${nexaCurrency(collections.all_time)} recorded all time.`,

      `Invoices: ${Number(invoices.total || 0)} total; ${Number(invoices.overdue || 0)} overdue; ${nexaCurrency(invoices.outstanding)} outstanding.`,

      `Vouchers: ${Number(vouchers.available || 0)} available, ${Number(vouchers.active || 0)} active, ${Number(vouchers.expired || 0)} expired.`,

      `Packages: ${Number(packages.pppoe_total || 0)} PPPoE and ${Number(packages.hotspot_total || 0)} hotspot.`,
    ].join('\n');
  }


  return null;
}


function nexaLiveAccountFallback(
  liveAccount
) {
  const metrics =
    liveAccount?.metrics;

  if (!metrics) {
    return (
      'I reached Nexa but could not obtain a complete live account snapshot.'
    );
  }


  return (
    `I can still see the live account state. ` +
    `Subscribers: ${metrics.subscribers?.total || 0} total, ` +
    `${metrics.subscribers?.online || 0} online. ` +
    `Collections this month: ${nexaCurrency(metrics.collections?.month)}. ` +
    `Outstanding invoices: ${nexaCurrency(metrics.invoices?.outstanding)}.`
  );
}


router.get('/health', async (req, res) => {
  const clientId = resolveTargetClient(req, res);
  if (!clientId) return;
  try {
    const [knowledge, llm] = await Promise.all([
      getKnowledgeHealth(clientId),
      getLLMHealth(clientId),
    ]);
    res.json({ ...knowledge, llm });
  } catch (error) {
    console.error('GET /nexa-knowledge/health error:', error.message);
    res.status(500).json({ error: 'Failed to load Nexa knowledge health' });
  }
});

router.get('/insights', async (req, res) => {
  const clientId = resolveTargetClient(req, res);
  if (!clientId) return;
  try {
    const insights = await listKnowledgeInsights(clientId, {
      riskLevel: req.query.riskLevel,
      insightType: req.query.insightType,
      entityType: req.query.entityType,
      entityId: req.query.entityId,
      limit: req.query.limit,
    });
    res.json({ insights });
  } catch (error) {
    console.error('GET /nexa-knowledge/insights error:', error.message);
    res.status(500).json({ error: 'Failed to load Nexa intelligence insights' });
  }
});

router.get('/summary', async (req, res) => {
  const clientId = resolveTargetClient(req, res);
  if (!clientId) return;
  try {
    res.json(await getKnowledgeSummary(clientId, {
      from: req.query.from,
      to: req.query.to,
    }));
  } catch (error) {
    console.error('GET /nexa-knowledge/summary error:', error.message);
    res.status(500).json({ error: 'Failed to load Nexa knowledge summary' });
  }
});

router.get('/search', async (req, res) => {
  const clientId = resolveTargetClient(req, res);
  if (!clientId) return;
  try {
    const facts = await searchKnowledge(clientId, req.query.q, {
      category: req.query.category,
      entityType: req.query.entityType,
      from: req.query.from,
      to: req.query.to,
      limit: req.query.limit,
    });
    res.json({ facts });
  } catch (error) {
    console.error('GET /nexa-knowledge/search error:', error.message);
    res.status(500).json({ error: 'Failed to search Nexa knowledge' });
  }
});

router.get('/entities', async (req, res) => {
  const clientId = resolveTargetClient(req, res);
  if (!clientId) return;
  try {
    const entities = await listKnowledgeEntities(clientId, {
      entityType: req.query.entityType,
      query: req.query.q,
      limit: req.query.limit,
    });
    res.json({ entities });
  } catch (error) {
    console.error('GET /nexa-knowledge/entities error:', error.message);
    res.status(500).json({ error: 'Failed to load Nexa knowledge entities' });
  }
});

router.get('/entities/:entityType/:entityId', async (req, res) => {
  const clientId = resolveTargetClient(req, res);
  if (!clientId) return;
  try {
    const [entity, insights] = await Promise.all([
      getKnowledgeEntity(
        clientId,
        req.params.entityType,
        req.params.entityId,
        req.query.limit
      ),
      listKnowledgeInsights(clientId, {
        entityType: req.params.entityType,
        entityId: req.params.entityId,
        limit: req.query.limit,
      }),
    ]);
    if (!entity) return res.status(404).json({ error: 'Knowledge entity not found' });
    res.json({ ...entity, insights });
  } catch (error) {
    console.error('GET /nexa-knowledge/entities/:type/:id error:', error.message);
    res.status(500).json({ error: 'Failed to load Nexa knowledge entity' });
  }
});

router.get('/twin/health', async (req, res) => {
  const clientId = resolveTargetClient(req, res);
  if (!clientId) return;
  try {
    res.json(await getTwinHealth(clientId));
  } catch (error) {
    console.error('GET /nexa-knowledge/twin/health error:', error.message);
    res.status(500).json({ error: 'Failed to load Nexa digital twin health' });
  }
});

router.get('/twin/stability', async (req, res) => {
  const clientId = resolveTargetClient(req, res);
  if (!clientId) return;
  try {
    res.json(await getTwinStabilityReport(clientId));
  } catch (error) {
    console.error('GET /nexa-knowledge/twin/stability error:', error.message);
    res.status(500).json({ error: 'Failed to load Nexa digital twin stability' });
  }
});

router.get('/twin/alerts', async (req, res) => {
  const clientId = resolveTargetClient(req, res);
  if (!clientId) return;
  try {
    res.json({ alerts: await listTwinAlerts(clientId, {
      status: req.query.status,
      limit: req.query.limit,
    }) });
  } catch (error) {
    console.error('GET /nexa-knowledge/twin/alerts error:', error.message);
    res.status(500).json({ error: 'Failed to load Nexa digital twin alerts' });
  }
});

router.get('/twin/entities', async (req, res) => {
  const clientId = resolveTargetClient(req, res);
  if (!clientId) return;
  try {
    const entities = await listTwinEntities(clientId, {
      entityType: req.query.entityType,
      operationalStatus: req.query.operationalStatus,
      healthStatus: req.query.healthStatus,
      query: req.query.q,
      limit: req.query.limit,
    });
    res.json({ entities });
  } catch (error) {
    console.error('GET /nexa-knowledge/twin/entities error:', error.message);
    res.status(500).json({ error: 'Failed to load Nexa digital twin entities' });
  }
});

router.get('/twin/entities/:entityType/:entityId', async (req, res) => {
  const clientId = resolveTargetClient(req, res);
  if (!clientId) return;
  try {
    const entity = await getTwinEntity(clientId, req.params.entityType, req.params.entityId);
    if (!entity) return res.status(404).json({ error: 'Digital twin entity not found' });
    res.json(entity);
  } catch (error) {
    console.error('GET /nexa-knowledge/twin/entities/:type/:id error:', error.message);
    res.status(500).json({ error: 'Failed to load Nexa digital twin entity' });
  }
});

router.get('/twin/impact/:entityType/:entityId', async (req, res) => {
  const clientId = resolveTargetClient(req, res);
  if (!clientId) return;
  try {
    const root = await getTwinEntity(clientId, req.params.entityType, req.params.entityId);
    if (!root) return res.status(404).json({ error: 'Digital twin entity not found' });
    res.json(await getTwinImpact(clientId, req.params.entityType, req.params.entityId, {
      depth: req.query.depth,
    }));
  } catch (error) {
    console.error('GET /nexa-knowledge/twin/impact/:type/:id error:', error.message);
    res.status(500).json({ error: 'Failed to calculate digital twin impact' });
  }
});

router.post('/ask', async (req, res) => {
  const clientId =
    resolveTargetClient(
      req,
      res
    );

  if (!clientId) {
    return;
  }


  const question =
    cleanQuestion(
      req.body?.question
    );

  const history =
    cleanHistory(
      req.body?.history
    );


  if (!question) {
    return res.status(400).json({
      error:
        'question is required',
    });
  }


  const capabilityResponse =
    getCapabilityResponse(
      question
    );

  if (capabilityResponse) {
    return res.json(
      capabilityResponse
    );
  }


  try {

    /*
     * LIVE ROUTERS FIRST.
     *
     * This is authoritative operational state,
     * and it also refreshes the router portion
     * of Nexa's Digital Twin before Twin search.
     */

    const liveRouters =
      await safeNexaContext(
        'live_router',
        () =>
          buildLiveRouterContext(
            clientId
          )
      );



    /*
     * LIVE COMPLETE ACCOUNT SNAPSHOT.
     *
     * This reads the tenant's current business data
     * directly before historical Knowledge/Twin.
     */
    const liveAccount =
      await safeNexaContext(
        'live_account',
        () =>
          buildNexaLiveAccountContext(
            clientId,
            question
          )
      );


    /*
     * Common router count/list questions should
     * never depend on the LLM or historical Twin.
     */

    const liveAnswer =
      directRouterAnswer(
        question,
        liveRouters
      );


    if (liveAnswer) {
      return res.json({
        answer:
          liveAnswer,

        sources:
          liveRouters.sources,

        live:
          true,

        intelligence:
          {
            routers:
              liveRouters.counts,
          },
      });
    }



    const accountAnswer =
      directLiveAccountAnswer(
        question,
        liveAccount
      );


    if (accountAnswer) {
      return res.json({
        answer:
          accountAnswer,

        sources: [
          ...liveAccount.sources,
          ...liveRouters.sources,
        ],

        live:
          true,

        intelligence: {
          account:
            liveAccount.metrics,

          routers:
            liveRouters.counts,
        },
      });
    }


    /*
     * Every intelligence subsystem is isolated.
     *
     * One stale/broken provider can no longer
     * take Nexa completely offline.
     */

    const [
      knowledge,
      twin,
      incidents,
      networkPlans,
      networkExecutions,
    ] = await Promise.all([

      safeNexaContext(
        'account_knowledge',
        () =>
          buildNexaKnowledgeContext(
            clientId,
            question,
            {
              from:
                req.body?.from,

              to:
                req.body?.to,

              category:
                req.body?.category,

              entityType:
                req.body?.entity_type,

              limit:
                15,
            }
          )
      ),


      safeNexaContext(
        'digital_twin',
        () =>
          buildNexaTwinContext(
            clientId,
            question,
            {
              limit:
                15,

              depth:
                3,
            }
          )
      ),


      safeNexaContext(
        'incidents',
        () =>
          buildIncidentContext(
            clientId,
            question,
            {
              limit:
                10,
            }
          )
      ),


      safeNexaContext(
        'network_plans',
        () =>
          buildNetworkAutomationContext(
            clientId,
            question,
            {
              limit:
                10,
            }
          )
      ),


      safeNexaContext(
        'network_executions',
        () =>
          buildNetworkExecutionContext(
            clientId,
            question,
            {
              limit:
                10,
            }
          )
      ),
    ]);


    if (
      !liveRouters.context &&
      !liveAccount.context &&
      !knowledge.context &&
      !twin.context &&
      !incidents.context &&
      !networkPlans.context &&
      !networkExecutions.context
    ) {
      return res.json({
        answer:
          'I do not have enough recorded account evidence to answer that yet.',

        sources:
          [],
      });
    }


    const systemPrompt = [
      (
        'You are Nexa, an operations intelligence assistant ' +
        'for one ISP billing account.'
      ),

      (
        'Answer only from the ACCOUNT KNOWLEDGE ' +
        'and LIVE ACCOUNT STATE supplied below.'
      ),

      (
        'LIVE ACCOUNT STATE is the highest-priority source ' +

      (
        'The LIVE COMPLETE ACCOUNT SOURCE is authoritative for current subscribers, collections, payments, invoices, packages, vouchers, communications and other tenant business records.'
      ),

      (
        'Use account database inventory to understand what data exists even when there is no historical event for it.'
      ),

      (
        'Never expose secrets. Values marked configured/not configured are intentional security boundaries.'
      ),

        'for current operational questions.'
      ),

      (
        'When live router status conflicts with older Digital Twin ' +
        'or historical event evidence, use the live router status.'
      ),

      (
        'Never infer information about another account or claim ' +
        'an action happened without evidence.'
      ),

      (
        'If evidence is incomplete, say exactly what is missing.'
      ),

      (
        'Respond naturally like an experienced human ISP ' +
        'operations assistant, never as raw JSON.'
      ),

      (
        'Lead with the direct answer, then explain the cause, ' +
        'affected scope, evidence freshness, and next best step.'
      ),

      (
        'Treat stale digital-twin observations as historical ' +
        'evidence, not confirmed live status.'
      ),

      (
        'Do not reveal raw credentials, tokens, passwords, ' +
        'private keys or authentication data.'
      ),

      (
        'Incident Commander recommendations are advisory. ' +
        'Never say an operational action was executed unless ' +
        'explicit execution evidence is supplied.'
      ),

      (
        'Network repair plans are shadow previews only. ' +
        'Clearly distinguish proposed plans from executed repairs.'
      ),

      '',

      'INSTALLED PLATFORM CAPABILITIES:',

      PLATFORM_CAPABILITY_CONTEXT,

      '',

      'LIVE COMPLETE ACCOUNT SOURCE OF TRUTH:',

      sanitizeTextForLLM(
        liveAccount.context,
        18000
      ) ||
      'No live account database snapshot was available.',

      '',

      'LIVE ROUTER SOURCE OF TRUTH:',

      sanitizeTextForLLM(
        liveRouters.context,
        10000
      ) ||
      'No routers are currently registered.',

      '',

      'APPROVED NETWORK EXECUTION HISTORY:',

      sanitizeTextForLLM(
        networkExecutions.context,
        10000
      ) ||
      'No matching execution requests.',

      '',

      'SHADOW NETWORK REPAIR PLANS:',

      sanitizeTextForLLM(
        networkPlans.context,
        10000
      ) ||
      'No matching shadow plans.',

      '',

      'ACTIVE AND RECENT INCIDENTS:',

      sanitizeTextForLLM(
        incidents.context,
        8000
      ) ||
      'No matching incidents.',

      '',

      'CURRENT DIGITAL TWIN:',

      sanitizeTextForLLM(
        twin.context,
        12000
      ) ||
      'No matching current twin state.',

      '',

      'ACCOUNT EVENT EVIDENCE:',

      sanitizeTextForLLM(
        knowledge.context,
        12000
      ) ||
      'No matching historical events.',
    ].join('\n');


    let answer;


    try {

      answer =
        await generateAIResponse(
          systemPrompt,
          [
            ...history,

            {
              role:
                'user',

              content:
                question,
            },
          ]
        );

    } catch (aiError) {

      console.error(
        'Nexa language response error:',
        aiError.message
      );


      /*
       * Do not turn a working account-data query
       * into a total Nexa failure merely because
       * the language layer is temporarily down.
       */

      if (
        /\brouters?\b|\bmikrotik\b/i.test(
          question
        )
      ) {
        answer =
          liveRouterFallback(
            liveRouters
          );

      } else {
        answer =
          nexaLiveAccountFallback(
            liveAccount
          );
      }
    }


    const degradedSources = [
      ['account_knowledge', knowledge],
      ['digital_twin', twin],
      ['incidents', incidents],
      ['network_plans', networkPlans],
      ['network_executions', networkExecutions],
      ['live_router', liveRouters],
      ['live_account', liveAccount],
    ]
      .filter(
        ([, value]) =>
          value?.context_error
      )
      .map(
        ([name]) =>
          name
      );


    res.json({
      answer,

      sources: [
        ...liveRouters.sources,
        ...liveAccount.sources,
        ...networkExecutions.sources,
        ...networkPlans.sources,
        ...incidents.sources,
        ...twin.sources,
        ...knowledge.sources,
      ],

      live:
        Boolean(
          liveRouters.context ||
          liveAccount.context
        ),

      degraded_sources:
        degradedSources,

      intelligence:
        {
          account:
            liveAccount.metrics ||
            null,

          routers:
            liveRouters.counts ||
            null,
        },
    });


  } catch (error) {

    console.error(
      'POST /nexa-knowledge/ask fatal error:',
      error.stack ||
      error.message
    );


    /*
     * Reserve HTTP 500 only for truly fatal route
     * failures. Individual intelligence providers
     * are already isolated above.
     */

    res.status(500).json({
      error:
        'Nexa live intelligence route failed',
    });
  }
});

module.exports = router;

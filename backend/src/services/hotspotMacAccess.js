const db = require('../db');

const {
  connectRouter,
  decryptSecret,
} = require('./mikrotik');

const {
  syncHotspotMacRadius,
} = require('./radiusSync');

const {
  applyHotspotAntiTether,
  removeHotspotAntiTether,
} = require('./hotspotAntiTether');

function wait(milliseconds) {
  return new Promise(
    resolve => setTimeout(resolve, milliseconds)
  );
}

function rows(value) {
  return Array.isArray(value)
    ? value
    : [];
}

function rowId(value) {
  return value?.['.id'] || null;
}

function normalizeMac(value) {
  const compact = String(value || '')
    .replace(/[^A-Fa-f0-9]/g, '')
    .toUpperCase();

  if (compact.length !== 12) {
    return null;
  }

  return compact
    .match(/.{2}/g)
    .join(':');
}

function compactMac(value) {
  return String(value || '')
    .replace(/[^A-Fa-f0-9]/g, '')
    .toUpperCase();
}

function sameDevice(
  item,
  macAddress,
  ipAddress
) {
  const itemMac =
    normalizeMac(
      item?.['mac-address']
    );

  const addresses = [
    item?.address,
    item?.['to-address'],
  ]
    .filter(Boolean)
    .map(String);

  return (
    (
      itemMac &&
      itemMac === macAddress
    ) ||
    (
      ipAddress &&
      addresses.includes(
        String(ipAddress)
      )
    )
  );
}

async function loadRouter(
  clientId,
  preferredRouterId
) {
  const result =
    await db.query(`
      SELECT
        r.*,
        e.username
          AS executor_username,
        e.password_encrypted
          AS executor_password_encrypted

      FROM mikrotik_routers r

      JOIN network_router_executor_credentials e
        ON e.client_id = r.client_id
       AND e.router_id = r.id

      WHERE r.client_id = $1
        AND r.is_active = TRUE
        AND e.enabled = TRUE
        AND e.verification_status =
            'verified'

      ORDER BY
        CASE
          WHEN r.id = $2 THEN 0
          ELSE 1
        END,

        CASE
          WHEN r.provisioning_status =
               'ready'
          THEN 0
          ELSE 1
        END,

        r.provisioned_at
          DESC NULLS LAST,

        r.last_seen_at
          DESC NULLS LAST

      LIMIT 1
    `, [
      clientId,
      preferredRouterId || null,
    ]);

  return result.rows[0] || null;
}

async function removeRows(
  client,
  printPath,
  removePath,
  predicate
) {
  const existing =
    rows(
      await client.command(
        printPath
      )
    );

  for (const item of existing) {
    if (
      rowId(item) &&
      predicate(item)
    ) {
      await client.command(
        removePath,
        {
          '.id': rowId(item),
        }
      ).catch(() => {});
    }
  }
}

async function clearDeviceSessions({
  client,
  mac,
  ipAddress,
}) {
  await removeRows(
    client,
    '/ip/hotspot/active/print',
    '/ip/hotspot/active/remove',

    item =>
      sameDevice(
        item,
        mac,
        ipAddress
      )
  );

  await removeRows(
    client,
    '/ip/hotspot/host/print',
    '/ip/hotspot/host/remove',

    item =>
      sameDevice(
        item,
        mac,
        ipAddress
      )
  );
}

async function findActiveSession({
  client,
  mac,
  ipAddress,
}) {
  const active =
    rows(
      await client.command(
        '/ip/hotspot/active/print'
      )
    );

  return (
    active.find(
      item =>
        sameDevice(
          item,
          mac,
          ipAddress
        )
    ) || null
  );
}

async function configureRadiusHotspot(
  client,
  macPassword
) {
  const profiles =
    rows(
      await client.command(
        '/ip/hotspot/profile/print'
      )
    );

  const profile =
    profiles.find(
      item =>
        item.name ===
        'NEXA-HOTSPOT-PROFILE'
    );

  if (
    !profile ||
    !rowId(profile)
  ) {
    throw new Error(
      'NEXA Hotspot profile was not found'
    );
  }

  /*
   * RADIUS owns customer authentication.
   *
   * No cookie/mac-cookie authentication:
   * every fresh authorization must be
   * checked against RADIUS.
   */
  await client.command(
    '/ip/hotspot/profile/set',
    {
      '.id':
        rowId(profile),

      'login-by':
        'mac,http-chap,http-pap',

      'mac-auth-password':
        macPassword,

      'radius-mac-format':
        'XX:XX:XX:XX:XX:XX',

      'use-radius':
        'yes',
    }
  );
}

async function removeLegacyLocalAccess({
  client,
  mac,
  ipAddress,
}) {
  const macKey =
    compactMac(mac);

  const queueName =
    `NEXA-PAID-QUEUE-${macKey}`;

  const schedulerName =
    `NEXA-PAID-EXPIRY-${macKey}`;

  /*
   * CRITICAL:
   *
   * A local HotSpot user would be checked
   * before RADIUS. Remove it.
   */
  await removeRows(
    client,
    '/ip/hotspot/user/print',
    '/ip/hotspot/user/remove',

    item =>
      normalizeMac(
        item?.['mac-address']
      ) === mac ||

      normalizeMac(
        item?.name
      ) === mac
  );

  /*
   * Remove old IP-binding bypasses.
   */
  await removeRows(
    client,
    '/ip/hotspot/ip-binding/print',
    '/ip/hotspot/ip-binding/remove',

    item =>
      normalizeMac(
        item?.['mac-address']
      ) === mac
  );

  /*
   * Old HotSpot cookies must not
   * bypass a fresh RADIUS check.
   */
  await removeRows(
    client,
    '/ip/hotspot/cookie/print',
    '/ip/hotspot/cookie/remove',

    item =>
      normalizeMac(
        item?.['mac-address']
      ) === mac ||

      normalizeMac(
        item?.user
      ) === mac
  );

  /*
   * Remove old API-controlled
   * per-device shaping/expiry.
   *
   * RADIUS now owns speed and expiry.
   */
  await removeRows(
    client,
    '/queue/simple/print',
    '/queue/simple/remove',

    item =>
      String(
        item?.name || ''
      ) === queueName
  );

  await removeRows(
    client,
    '/system/scheduler/print',
    '/system/scheduler/remove',

    item =>
      String(
        item?.name || ''
      ) === schedulerName
  );

  /*
   * Remove unused NEXA-PAID local
   * profiles from the old architecture.
   */
  const localUsers =
    rows(
      await client.command(
        '/ip/hotspot/user/print'
      )
    );

  const profilesInUse =
    new Set(
      localUsers
        .map(
          item =>
            String(
              item?.profile || ''
            )
        )
        .filter(Boolean)
    );

  await removeRows(
    client,
    '/ip/hotspot/user/profile/print',
    '/ip/hotspot/user/profile/remove',

    item =>
      String(
        item?.name || ''
      ).startsWith(
        'NEXA-PAID-'
      ) &&

      !profilesInUse.has(
        String(
          item?.name || ''
        )
      )
  );
}

function explicitlyLocalSession(
  active
) {
  if (
    !active ||
    active.radius === undefined ||
    active.radius === null
  ) {
    return false;
  }

  return [
    'false',
    'no',
    '0',
  ].includes(
    String(
      active.radius
    ).toLowerCase()
  );
}

async function activatePaidHotspotDevice({
  clientId,
  routerId = null,
  macAddress,
  ipAddress = '',
  expiresAt,
  rateLimit = null,
  dataLimitMb = null,
}) {
  const mac =
    normalizeMac(
      macAddress
    );

  if (!mac) {
    throw new Error(
      'The paying device MAC address is invalid'
    );
  }

  const expiry =
    new Date(
      expiresAt
    );

  if (
    !Number.isFinite(
      expiry.getTime()
    )
  ) {
    throw new Error(
      'The package expiry time is invalid'
    );
  }

  const remainingSeconds =
    Math.ceil(
      (
        expiry.getTime() -
        Date.now()
      ) / 1000
    );

  if (
    remainingSeconds <= 0
  ) {
    throw new Error(
      'The paid hotspot package has expired'
    );
  }

  const macPassword =
    String(
      process.env
        .HOTSPOT_MAC_AUTH_PASSWORD ||
      ''
    ).trim();

  if (!macPassword) {
    throw new Error(
      'HOTSPOT_MAC_AUTH_PASSWORD is not configured'
    );
  }

  /*
   * ============================
   * AUTHENTICATION PLANE
   * ============================
   *
   * RADIUS is authoritative.
   */
  const radius =
    await syncHotspotMacRadius({
      macAddress:
        mac,

      expiresAt:
        expiry,

      rateLimit,

      dataLimitMb,
    });

  const router =
    await loadRouter(
      clientId,
      routerId
    );

  if (!router) {
    throw new Error(
      'A verified MikroTik executor was not found'
    );
  }

  /*
   * ============================
   * MANAGEMENT PLANE
   * ============================
   *
   * API manages the router only.
   */
  const client =
    await connectRouter({
      ...router,

      host:
        router.wireguard_tunnel_ip ||
        router.host,

      username:
        router.executor_username,

      password:
        decryptSecret(
          router
            .executor_password_encrypted
        ),
    });

  try {
    await configureRadiusHotspot(
      client,
      macPassword
    );

    /*
     * Purge anything that could allow
     * local authentication.
     */
    await removeLegacyLocalAccess({
      client,
      mac,
      ipAddress,
    });

    /*
     * Anti-sharing remains an API
     * management responsibility.
     */
    const antiTether =
      await applyHotspotAntiTether({
        client,

        macAddress:
          mac,

        ipAddress,

        remainingSeconds,
      });

    /*
     * Disconnect old session.
     *
     * Next traffic from the phone causes
     * RouterOS to authenticate MAC through
     * RADIUS.
     */
    await clearDeviceSessions({
      client,
      mac,
      ipAddress,
    });

    let active = null;

    for (
      let attempt = 0;
      attempt < 12;
      attempt += 1
    ) {
      await wait(
        1000
      );

      active =
        await findActiveSession({
          client,
          mac,
          ipAddress,
        });

      if (active) {
        break;
      }
    }

    /*
     * If RouterOS explicitly tells us
     * this is NOT a RADIUS session,
     * refuse it.
     */
    if (
      explicitlyLocalSession(
        active
      )
    ) {
      throw new Error(
        'Hotspot session authenticated locally instead of through RADIUS'
      );
    }

    /*
     * RADIUS provisioning is complete.
     *
     * If phone generated traffic already,
     * session_status = online.
     *
     * Otherwise next packet triggers
     * MAC -> RADIUS automatically.
     */
    return {
      status:
        'active',

      router_id:
        router.id,

      username:
        mac,

      login_by:
        active?.['login-by'] ||
        'mac',

      auth_source:
        'radius',

      session_status:
        active
          ? 'online'
          : 'awaiting_radius_auth',

      radius_status:
        radius.status,

      anti_tether_status:
        antiTether.status,

      anti_tether_ip:
        antiTether.ip_address,
    };

  } finally {
    client.close();
  }
}

async function revokeHotspotDeviceAccess({
  clientId,
  routerId = null,
  macAddress,
  ipAddress = '',
}) {
  const mac =
    normalizeMac(
      macAddress
    );

  if (!mac) {
    throw new Error(
      'A valid Hotspot MAC address is required for revocation'
    );
  }

  const router =
    await loadRouter(
      clientId,
      routerId
    );

  if (!router) {
    throw new Error(
      'A verified MikroTik executor was not found'
    );
  }

  const client =
    await connectRouter({
      ...router,

      host:
        router.wireguard_tunnel_ip ||
        router.host,

      username:
        router.executor_username,

      password:
        decryptSecret(
          router
            .executor_password_encrypted
        ),
    });

  try {
    /*
     * API only removes the live
     * RouterOS state.
     */
    await clearDeviceSessions({
      client,
      mac,
      ipAddress,
    });

    await removeLegacyLocalAccess({
      client,
      mac,
      ipAddress,
    });

    await removeHotspotAntiTether({
      client,

      macAddress:
        mac,

      ipAddress,
    });

    const [
      activeAfter,
      bindingsAfter,
      usersAfter,
      cookiesAfter,
    ] =
      await Promise.all([
        client.command(
          '/ip/hotspot/active/print'
        ),

        client.command(
          '/ip/hotspot/ip-binding/print'
        ),

        client.command(
          '/ip/hotspot/user/print'
        ),

        client.command(
          '/ip/hotspot/cookie/print'
        ),
      ]);

    const activeRemains =
      rows(
        activeAfter
      ).some(
        item =>
          sameDevice(
            item,
            mac,
            ipAddress
          )
      );

    const bindingRemains =
      rows(
        bindingsAfter
      ).some(
        item =>
          normalizeMac(
            item?.['mac-address']
          ) === mac
      );

    const localUserRemains =
      rows(
        usersAfter
      ).some(
        item =>
          normalizeMac(
            item?.['mac-address']
          ) === mac ||

          normalizeMac(
            item?.name
          ) === mac
      );

    const cookieRemains =
      rows(
        cookiesAfter
      ).some(
        item =>
          normalizeMac(
            item?.['mac-address']
          ) === mac ||

          normalizeMac(
            item?.user
          ) === mac
      );

    if (
      activeRemains ||
      bindingRemains ||
      localUserRemains ||
      cookieRemains
    ) {
      throw new Error(
        'Expired Hotspot access still exists on MikroTik'
      );
    }

    return {
      status:
        'revoked',

      router_id:
        router.id,

      mac_address:
        mac,
    };

  } finally {
    client.close();
  }
}

module.exports = {
  activatePaidHotspotDevice,
  normalizeMac,
  revokeHotspotDeviceAccess,
};

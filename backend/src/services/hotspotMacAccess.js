const db = require('../db');

const {
  connectRouter,
  decryptSecret,
} = require('./mikrotik');

const {
  syncHotspotMacRadius,
} = require('./radiusSync');

function wait(milliseconds) {
  return new Promise(
    (resolve) =>
      setTimeout(resolve, milliseconds)
  );
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

function rows(value) {
  return Array.isArray(value)
    ? value
    : [];
}

function sameDevice(
  item,
  macAddress,
  ipAddress
) {
  const itemMac = normalizeMac(
    item?.['mac-address']
  );

  const itemAddresses = [
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
      itemAddresses.includes(ipAddress)
    )
  );
}

async function loadRouter(
  clientId,
  preferredRouterId
) {
  const result = await db.query(
    `SELECT
       r.*,
       e.username AS executor_username,
       e.password_encrypted
         AS executor_password_encrypted
     FROM mikrotik_routers r
     JOIN network_router_executor_credentials e
       ON e.client_id = r.client_id
      AND e.router_id = r.id
     WHERE r.client_id = $1
       AND r.is_active = TRUE
       AND e.enabled = TRUE
       AND e.verification_status = 'verified'
     ORDER BY
       CASE
         WHEN r.id = $2
         THEN 0
         ELSE 1
       END,
       CASE
         WHEN r.provisioning_status = 'ready'
         THEN 0
         ELSE 1
       END,
       r.provisioned_at DESC NULLS LAST,
       r.last_seen_at DESC NULLS LAST
     LIMIT 1`,
    [
      clientId,
      preferredRouterId || null,
    ]
  );

  return result.rows[0] || null;
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
  const mac = normalizeMac(
    macAddress
  );

  if (!mac) {
    throw new Error(
      'The paying device MAC address is invalid'
    );
  }

  const macPassword = String(
    process.env.HOTSPOT_MAC_AUTH_PASSWORD || ''
  ).trim();

  if (!macPassword) {
    throw new Error(
      'HOTSPOT_MAC_AUTH_PASSWORD is not configured'
    );
  }

  const radius =
    await syncHotspotMacRadius({
      macAddress: mac,
      expiresAt,
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
          router.executor_password_encrypted
        ),
    });

  try {
    const profiles = rows(
      await client.command(
        '/ip/hotspot/profile/print'
      )
    );

    const profile = profiles.find(
      item =>
        item.name ===
        'NEXA-HOTSPOT-PROFILE'
    );

    if (!profile?.['.id']) {
      throw new Error(
        'NEXA Hotspot profile was not found'
      );
    }

    await client.command(
      '/ip/hotspot/profile/set',
      {
        '.id': profile['.id'],
        'login-by':
          'mac,http-chap,http-pap,cookie',
        'mac-auth-password':
          macPassword,
        'radius-mac-format':
          'XX:XX:XX:XX:XX:XX',
        'use-radius': 'yes',
      }
    );

    const activeSessions = rows(
      await client.command(
        '/ip/hotspot/active/print'
      )
    );

    for (const session of activeSessions) {
      if (
        session?.['.id'] &&
        sameDevice(
          session,
          mac,
          ipAddress
        )
      ) {
        await client.command(
          '/ip/hotspot/active/remove',
          {
            '.id': session['.id'],
          }
        ).catch(() => {});
      }
    }

    const hosts = rows(
      await client.command(
        '/ip/hotspot/host/print'
      )
    );

    for (const host of hosts) {
      if (
        host?.['.id'] &&
        sameDevice(
          host,
          mac,
          ipAddress
        )
      ) {
        await client.command(
          '/ip/hotspot/host/remove',
          {
            '.id': host['.id'],
          }
        ).catch(() => {});
      }
    }

    for (
      let attempt = 0;
      attempt < 12;
      attempt += 1
    ) {
      await wait(1000);

      const current = rows(
        await client.command(
          '/ip/hotspot/active/print'
        )
      );

      const authenticated =
        current.find(
          item =>
            sameDevice(
              item,
              mac,
              ipAddress
            )
        );

      if (authenticated) {
        return {
          status: 'active',
          router_id: router.id,
          username: mac,
          login_by:
            authenticated['login-by'] ||
            'mac',
          radius_status:
            radius.status,
        };
      }
    }

    return {
      status: 'triggered',
      router_id: router.id,
      username: mac,
      login_by: 'mac',
      radius_status: radius.status,
    };
  } finally {
    client.close();
  }
}

module.exports = {
  activatePaidHotspotDevice,
  normalizeMac,
};

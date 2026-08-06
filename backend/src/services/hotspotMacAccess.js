const crypto = require('crypto');
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

function safeName(prefix, value) {
  return `${prefix}-${value}`
    .replace(/[^A-Za-z0-9_.-]/g, '-')
    .slice(0, 60);
}

function sameDevice(
  item,
  macAddress,
  ipAddress
) {
  const itemMac = normalizeMac(
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
      addresses.includes(ipAddress)
    )
  );
}

function durationText(seconds) {
  return `${Math.max(
    1,
    Math.ceil(Number(seconds) || 1)
  )}s`;
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

async function removeRows(
  client,
  printPath,
  removePath,
  predicate
) {
  const existing = rows(
    await client.command(printPath)
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

async function ensurePaidProfile(
  client,
  rateLimit
) {
  const profileHash = crypto
    .createHash('sha256')
    .update(
      String(rateLimit || 'unlimited')
    )
    .digest('hex')
    .slice(0, 10);

  const profileName =
    safeName(
      'NEXA-PAID',
      profileHash
    );

  const profiles = rows(
    await client.command(
      '/ip/hotspot/user/profile/print'
    )
  );

  const existing = profiles.find(
    item =>
      item.name === profileName
  );

  const attributes = {
    name: profileName,
    'shared-users': '1',
    'add-mac-cookie': 'yes',
  };

  if (rateLimit) {
    attributes['rate-limit'] =
      String(rateLimit);
  }

  if (existing && rowId(existing)) {
    await client.command(
      '/ip/hotspot/user/profile/set',
      {
        '.id': rowId(existing),
        ...attributes,
      }
    );
  } else {
    await client.command(
      '/ip/hotspot/user/profile/add',
      attributes
    );
  }

  return profileName;
}

async function createLocalMacUser({
  client,
  mac,
  macPassword,
  profileName,
  remainingSeconds,
  dataLimitMb,
}) {
  await removeRows(
    client,
    '/ip/hotspot/user/print',
    '/ip/hotspot/user/remove',
    item =>
      String(item.name || '')
        .toUpperCase() === mac
  );

  const attributes = {
    name: mac,
    password: macPassword,
    'mac-address': mac,
    server: 'NEXA-HOTSPOT',
    profile: profileName,
    'limit-uptime':
      durationText(remainingSeconds),
    disabled: 'no',
  };

  const dataLimit =
    Number(dataLimitMb);

  if (
    Number.isFinite(dataLimit) &&
    dataLimit > 0
  ) {
    attributes['limit-bytes-total'] =
      String(
        Math.round(
          dataLimit *
          1024 *
          1024
        )
      );
  }

  await client.command(
    '/ip/hotspot/user/add',
    attributes
  );
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
  const active = rows(
    await client.command(
      '/ip/hotspot/active/print'
    )
  );

  return active.find(
    item =>
      sameDevice(
        item,
        mac,
        ipAddress
      )
  ) || null;
}

async function installBypass({
  client,
  mac,
  ipAddress,
  remainingSeconds,
  rateLimit,
}) {
  const macKey = compactMac(mac);

  const queueName =
    safeName(
      'NEXA-PAID-QUEUE',
      macKey
    );

  const schedulerName =
    safeName(
      'NEXA-PAID-EXPIRY',
      macKey
    );

  await removeRows(
    client,
    '/ip/hotspot/ip-binding/print',
    '/ip/hotspot/ip-binding/remove',
    item =>
      normalizeMac(
        item['mac-address']
      ) === mac
  );

  const binding = {
    'mac-address': mac,
    server: 'NEXA-HOTSPOT',
    type: 'bypassed',
  };

  if (ipAddress) {
    binding.address =
      String(ipAddress);
  }

  await client.command(
    '/ip/hotspot/ip-binding/add',
    binding
  );

  await removeRows(
    client,
    '/queue/simple/print',
    '/queue/simple/remove',
    item =>
      item.name === queueName
  );

  if (ipAddress && rateLimit) {
    await client.command(
      '/queue/simple/add',
      {
        name: queueName,
        target:
          `${String(ipAddress)}/32`,
        'max-limit':
          String(rateLimit),
        disabled: 'no',
      }
    );
  }

  await removeRows(
    client,
    '/system/scheduler/print',
    '/system/scheduler/remove',
    item =>
      item.name === schedulerName
  );

  const cleanup = [
    `/ip hotspot ip-binding remove [find where mac-address="${mac}"]`,
    `/queue simple remove [find where name="${queueName}"]`,
    `/ip hotspot user remove [find where name="${mac}"]`,
    `/system scheduler remove [find where name="${schedulerName}"]`,
  ].join('; ');

  await client.command(
    '/system/scheduler/add',
    {
      name: schedulerName,
      interval:
        durationText(remainingSeconds),
      'on-event': cleanup,
      policy:
        'read,write,policy,test',
      disabled: 'no',
    }
  );

  return {
    status: 'bypassed',
    queue_name:
      ipAddress && rateLimit
        ? queueName
        : null,
    scheduler_name:
      schedulerName,
  };
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
    normalizeMac(macAddress);

  if (!mac) {
    throw new Error(
      'The paying device MAC address is invalid'
    );
  }

  const expiry = new Date(expiresAt);

  if (
    !Number.isFinite(
      expiry.getTime()
    )
  ) {
    throw new Error(
      'The package expiry time is invalid'
    );
  }

  const remainingSeconds = Math.ceil(
    (
      expiry.getTime() -
      Date.now()
    ) / 1000
  );

  if (remainingSeconds <= 0) {
    throw new Error(
      'The paid hotspot package has expired'
    );
  }

  const macPassword = String(
    process.env.HOTSPOT_MAC_AUTH_PASSWORD ||
    ''
  ).trim();

  if (!macPassword) {
    throw new Error(
      'HOTSPOT_MAC_AUTH_PASSWORD is not configured'
    );
  }

  const radius =
    await syncHotspotMacRadius({
      macAddress: mac,
      expiresAt: expiry,
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
    const hotspotProfiles = rows(
      await client.command(
        '/ip/hotspot/profile/print'
      )
    );

    const hotspotProfile =
      hotspotProfiles.find(
        item =>
          item.name ===
          'NEXA-HOTSPOT-PROFILE'
      );

    if (
      !hotspotProfile ||
      !rowId(hotspotProfile)
    ) {
      throw new Error(
        'NEXA Hotspot profile was not found'
      );
    }

    await client.command(
      '/ip/hotspot/profile/set',
      {
        '.id':
          rowId(hotspotProfile),
        'login-by':
          'mac,http-chap,http-pap,cookie',
        'mac-auth-password':
          macPassword,
        'radius-mac-format':
          'XX:XX:XX:XX:XX:XX',
        'use-radius': 'yes',
      }
    );

    const profileName =
      await ensurePaidProfile(
        client,
        rateLimit
      );

    await createLocalMacUser({
      client,
      mac,
      macPassword,
      profileName,
      remainingSeconds,
      dataLimitMb,
    });

    await clearDeviceSessions({
      client,
      mac,
      ipAddress,
    });

    for (
      let attempt = 0;
      attempt < 5;
      attempt += 1
    ) {
      await wait(1000);

      const active =
        await findActiveSession({
          client,
          mac,
          ipAddress,
        });

      if (active) {
        return {
          status: 'active',
          router_id: router.id,
          username: mac,
          login_by:
            active['login-by'] ||
            'mac',
          radius_status:
            radius.status,
        };
      }
    }

    const bypass =
      await installBypass({
        client,
        mac,
        ipAddress,
        remainingSeconds,
        rateLimit,
      });

    await clearDeviceSessions({
      client,
      mac,
      ipAddress,
    });

    return {
      ...bypass,
      router_id: router.id,
      username: mac,
      login_by: 'bypass',
      radius_status:
        radius.status,
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
    normalizeMac(macAddress);

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
          router.executor_password_encrypted
        ),
    });

  const macKey =
    compactMac(mac);

  const queueName =
    safeName(
      'NEXA-PAID-QUEUE',
      macKey
    );

  const schedulerName =
    safeName(
      'NEXA-PAID-EXPIRY',
      macKey
    );

  try {
    await clearDeviceSessions({
      client,
      mac,
      ipAddress,
    });

    await removeRows(
      client,
      '/ip/hotspot/ip-binding/print',
      '/ip/hotspot/ip-binding/remove',
      item =>
        normalizeMac(
          item['mac-address']
        ) === mac
    );

    await removeRows(
      client,
      '/ip/hotspot/user/print',
      '/ip/hotspot/user/remove',
      item =>
        normalizeMac(
          item['mac-address']
        ) === mac ||
        normalizeMac(
          item.name
        ) === mac
    );

    await removeRows(
      client,
      '/ip/hotspot/cookie/print',
      '/ip/hotspot/cookie/remove',
      item =>
        normalizeMac(
          item['mac-address']
        ) === mac ||
        normalizeMac(
          item.user
        ) === mac
    );

    await removeRows(
      client,
      '/queue/simple/print',
      '/queue/simple/remove',
      item =>
        item.name === queueName
    );

    await removeRows(
      client,
      '/system/scheduler/print',
      '/system/scheduler/remove',
      item =>
        item.name ===
        schedulerName
    );

    const [
      activeAfter,
      bindingsAfter,
      usersAfter,
    ] = await Promise.all([
      client.command(
        '/ip/hotspot/active/print'
      ),

      client.command(
        '/ip/hotspot/ip-binding/print'
      ),

      client.command(
        '/ip/hotspot/user/print'
      ),
    ]);

    const activeRemains =
      rows(activeAfter).some(
        item =>
          sameDevice(
            item,
            mac,
            ipAddress
          )
      );

    const bindingRemains =
      rows(bindingsAfter).some(
        item =>
          normalizeMac(
            item['mac-address']
          ) === mac
      );

    const userRemains =
      rows(usersAfter).some(
        item =>
          normalizeMac(
            item['mac-address']
          ) === mac ||
          normalizeMac(
            item.name
          ) === mac
      );

    if (
      activeRemains ||
      bindingRemains ||
      userRemains
    ) {
      throw new Error(
        'Expired Hotspot access still exists on MikroTik'
      );
    }

    return {
      status: 'revoked',
      router_id: router.id,
      mac_address: mac,
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

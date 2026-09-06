const net = require('net');

const ADDRESS_LIST =
  'NEXA-PAID-ANTI-TETHER';

const RULE_COMMENT =
  'NEXA ANTI-TETHER - DO NOT REMOVE';

function rows(value) {
  return Array.isArray(value)
    ? value
    : [];
}

function rowId(value) {
  return value?.['.id'] || null;
}

function compactMac(value) {
  return String(value || '')
    .replace(/[^A-Fa-f0-9]/g, '')
    .toUpperCase();
}

function durationText(seconds) {
  return `${Math.max(
    1,
    Math.ceil(Number(seconds) || 1)
  )}s`;
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
      );
    }
  }
}

async function ensureAntiTetherRule(
  client
) {
  const rules =
    rows(
      await client.command(
        '/ip/firewall/mangle/print'
      )
    );

  const existing =
    rules.find(
      item =>
        String(item.comment || '') ===
        RULE_COMMENT
    );

  const attributes = {
    chain: 'postrouting',
    'dst-address-list':
      ADDRESS_LIST,
    action: 'change-ttl',
    'new-ttl': 'set:1',
    passthrough: 'yes',
    disabled: 'no',
    comment: RULE_COMMENT,
  };

  if (
    existing &&
    rowId(existing)
  ) {
    await client.command(
      '/ip/firewall/mangle/set',
      {
        '.id': rowId(existing),
        ...attributes,
      }
    );

    return;
  }

  await client.command(
    '/ip/firewall/mangle/add',
    attributes
  );
}

async function applyHotspotAntiTether({
  client,
  macAddress,
  ipAddress,
  remainingSeconds,
}) {
  const ip =
    String(ipAddress || '')
      .trim();

  if (net.isIP(ip) !== 4) {
    throw new Error(
      'Anti-sharing could not be enforced because the hotspot IPv4 address is unavailable'
    );
  }

  const macKey =
    compactMac(macAddress);

  if (!macKey) {
    throw new Error(
      'Anti-sharing could not be enforced because the device MAC is unavailable'
    );
  }

  const marker =
    `NEXA-ANTI-TETHER-${macKey}`;

  await ensureAntiTetherRule(
    client
  );

  /*
   * Remove an old IP belonging to
   * this MAC, or an old ownership
   * record for the same IP.
   */
  await removeRows(
    client,
    '/ip/firewall/address-list/print',
    '/ip/firewall/address-list/remove',
    item =>
      String(item.list || '') ===
        ADDRESS_LIST &&
      (
        String(item.comment || '') ===
          marker ||
        String(item.address || '') ===
          ip
      )
  );

  /*
   * Timeout follows the actual
   * purchased package expiry.
   */
  await client.command(
    '/ip/firewall/address-list/add',
    {
      list: ADDRESS_LIST,
      address: ip,
      timeout:
        durationText(
          remainingSeconds
        ),
      comment: marker,
    }
  );

  return {
    status: 'enforced',
    ip_address: ip,
    address_list:
      ADDRESS_LIST,
  };
}

async function removeHotspotAntiTether({
  client,
  macAddress,
  ipAddress = '',
}) {
  const macKey =
    compactMac(macAddress);

  const marker =
    macKey
      ? `NEXA-ANTI-TETHER-${macKey}`
      : '';

  const ip =
    String(ipAddress || '')
      .trim();

  await removeRows(
    client,
    '/ip/firewall/address-list/print',
    '/ip/firewall/address-list/remove',
    item =>
      String(item.list || '') ===
        ADDRESS_LIST &&
      (
        (
          marker &&
          String(item.comment || '') ===
            marker
        ) ||
        (
          net.isIP(ip) === 4 &&
          String(item.address || '') ===
            ip
        )
      )
  );

  return {
    status: 'removed',
  };
}

module.exports = {
  applyHotspotAntiTether,
  removeHotspotAntiTether,
};

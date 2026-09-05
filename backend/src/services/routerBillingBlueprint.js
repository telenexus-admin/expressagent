function operation(stage, path, args, purpose, options = {}) {
  return { stage, path, args, purpose, ...options };
}

function cidrAddress(value, fallback) {
  const text = String(value || fallback).trim();
  return text.includes('/') ? text : text + '/24';
}

function networkFromGateway(value, fallback) {
  const address = cidrAddress(value, fallback);
  const [ip, prefix = '24'] = address.split('/');
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    throw new Error('Invalid subscriber gateway');
  }
  if (prefix !== '24') return address;
  return parts.slice(0, 3).join('.') + '.0/24';
}

function cleanDomain(value, fallback) {
  const domain = String(value || fallback).trim().toLowerCase();
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) {
    throw new Error('Invalid Hotspot DNS name');
  }
  return domain;
}

function resourceConflicts(current = {}) {
  const managedNames = new Set([
    'NEXA-PPPOE-POOL', 'NEXA-PPPOE-PROFILE', 'NEXA-HOTSPOT-POOL',
    'NEXA-HOTSPOT-PROFILE', 'NEXA-HOTSPOT', 'NEXA-HOTSPOT-DHCP',
  ]);
  const groups = [
    ['pools', current.pools], ['ppp_profiles', current.ppp_profiles],
    ['pppoe_servers', current.pppoe_servers], ['hotspot_profiles', current.hotspot_profiles],
    ['hotspot_servers', current.hotspot_servers],
  ];
  const conflicts = [];
  for (const [type, rows] of groups) {
    for (const row of Array.isArray(rows) ? rows : []) {
      const name = String(row.name || row['service-name'] || '');
      if (managedNames.has(name) && !String(row.comment || '').startsWith('NEXA managed')) {
        conflicts.push({ type, name, reason: 'Reserved Nexa name is already used by an unmanaged resource' });
      }
    }
  }
  return conflicts;
}

function compileBillingBlueprint(input = {}) {
  const desired = {
    pppoe: input.desired_services?.pppoe !== false,
    hotspot: input.desired_services?.hotspot !== false,
    ...input.desired_services,
  };
  const capability = input.capability_profile || {};
  if ((capability.blockers || []).length) throw new Error('Compatibility blockers remain');
  if (!desired.pppoe && !desired.hotspot) throw new Error('At least one subscriber service is required');

  const discoveredInterfaces = input.fingerprint?.inventory?.interfaces || [];
  const bridgeNames = (input.current_config?.bridges || []).map((row) => String(row.name || '')).filter(Boolean);
  const inferredInterface = bridgeNames.find((name) => /^bridge(?:-subscribers)?$/i.test(name)) || (bridgeNames.length === 1 ? bridgeNames[0] : 'bridge');
  const serviceInterface = String(desired.service_interface || inferredInterface).trim();
  const subscriberInterface = desired.vlan_id ? 'nexa-subscriber-vlan-' + Number(desired.vlan_id) : serviceInterface;
  const pppoeInterface = String(desired.pppoe_interface || subscriberInterface).trim();
  const hotspotInterface = String(desired.hotspot_interface || subscriberInterface).trim();
  const hotspotGateway = cidrAddress(desired.hotspot_gateway, '10.20.0.1/24');
  const hotspotAddress = hotspotGateway.split('/')[0];
  const hotspotNetwork = networkFromGateway(hotspotGateway, '10.20.0.1/24');
  const hotspotPool = String(desired.hotspot_pool || '10.20.0.10-10.20.0.254').trim();
  const pppoeGateway = String(desired.pppoe_gateway || '10.30.0.1').trim().split('/')[0];
  const pppoePool = String(desired.pppoe_pool || '10.30.0.10-10.30.0.254').trim();
  const portalDomain = cleanDomain(desired.hotspot_dns_name, 'login.nexa.telenexustechnologies.com');
  const portalHost = cleanDomain(desired.portal_host, 'nexa.telenexustechnologies.com');
  const radiusHost = String(input.radius_host || '10.78.0.2').trim();
  const radiusDynamicAuthPort = Number(input.radius_dynamic_auth_port || 1700);
  if (!Number.isInteger(radiusDynamicAuthPort) || radiusDynamicAuthPort < 1 || radiusDynamicAuthPort > 65535) {
    throw new Error('Invalid RADIUS dynamic authorization port');
  }
  const conflicts = resourceConflicts(input.current_config || {});
  if (discoveredInterfaces.length && !discoveredInterfaces.some((row) => row.name === serviceInterface)) conflicts.push({ type: 'interface', name: serviceInterface, reason: 'Subscriber service interface was not discovered on this router' });
  const interfaceLists = input.current_config?.interface_lists || [];
  const wanList = String(desired.wan_interface_list || 'WAN');
  if (interfaceLists.length && !interfaceLists.some((row) => row.name === wanList)) conflicts.push({ type: 'interface_list', name: wanList, reason: 'Selected WAN interface list was not discovered on this router' });
  if (conflicts.length) {
    return {
      adapter_version: capability.adapter_version,
      desired_state: desired,
      conflict_report: { status: 'blocked', conflicts },
      stages: [],
      rollback_stages: [],
      verification_probes: [],
      execution_ready: false,
    };
  }

  const stages = [{
    name: 'checkpoint',
    operations: [
      operation('checkpoint', '/system/backup/save', { name: 'nexa-pre-provision-{{run_id}}' }, 'Create binary RouterOS backup'),
      operation('checkpoint', 'nexa://snapshot/capture', {
        paths: ['/ip/dns/print', '/ppp/aaa/print', '/ip/address/print', '/ip/pool/print',
          '/ip/dhcp-server/print', '/ip/dhcp-server/network/print', '/ppp/profile/print',
          '/interface/pppoe-server/server/print', '/ip/hotspot/profile/print', '/ip/hotspot/print',
          '/radius/print', '/radius/incoming/print', '/ip/firewall/filter/print', '/ip/firewall/nat/print', '/file/print'],
      }, 'Capture structured pre-change state'),
    ],
  }];

  if (desired.vlan_id) {
    stages.push({
      name: 'subscriber_vlan',
      operations: [operation('subscriber_vlan', '/interface/vlan/add', {
        name: 'nexa-subscriber-vlan-' + Number(desired.vlan_id),
        'vlan-id': String(Number(desired.vlan_id)),
        interface: serviceInterface,
        comment: 'NEXA managed subscriber VLAN',
      }, 'Create the selected subscriber VLAN', { ensure: 'managed' })],
    });
  }

  stages.push({
    name: 'radius_registration',
    operations: [operation('radius_registration', 'nexa://radius/register-nas', {
      nas_identifier: input.nas_identifier,
      nas_ip: input.nas_ip,
    }, 'Register this tenant router in FreeRADIUS', { secret_ref: 'router-radius-secret' })],
  });

  if (desired.hotspot) {
    stages.push({
      name: 'hotspot_network',
      operations: [
        operation('hotspot_network', '/ip/address/add', {
          address: hotspotGateway, interface: hotspotInterface, comment: 'NEXA managed Hotspot gateway',
        }, 'Assign Hotspot gateway', { ensure: 'managed' }),
        operation('hotspot_network', '/ip/pool/add', {
          name: 'NEXA-HOTSPOT-POOL', ranges: hotspotPool, comment: 'NEXA managed Hotspot pool',
        }, 'Create Hotspot address pool', { ensure: 'managed' }),
        operation('hotspot_network', '/ip/dhcp-server/network/add', {
          address: hotspotNetwork, gateway: hotspotAddress, 'dns-server': hotspotAddress,
          comment: 'NEXA managed Hotspot DHCP network',
        }, 'Create Hotspot DHCP network', { ensure: 'managed' }),
        operation('hotspot_network', '/ip/dhcp-server/add', {
          name: 'NEXA-HOTSPOT-DHCP', interface: hotspotInterface, 'address-pool': 'NEXA-HOTSPOT-POOL',
          disabled: 'yes', comment: 'NEXA managed Hotspot DHCP',
        }, 'Stage Hotspot DHCP server', { ensure: 'managed' }),
      ],
    });
    stages.push({
      name: 'dns_and_portal',
      operations: [
        operation('dns_and_portal', '/ip/dns/set', {
          'allow-remote-requests': 'yes',
          servers: String(desired.dns_servers || '1.1.1.1,8.8.8.8'),
        }, 'Enable subscriber DNS forwarding'),
        operation('dns_and_portal', '/ip/firewall/filter/add', {
          chain: 'input', action: 'accept', protocol: 'udp', 'dst-port': '53',
          'src-address': hotspotNetwork, 'place-before': '0', comment: 'NEXA allow Hotspot DNS UDP',
        }, 'Allow DNS only from the Hotspot subnet', { ensure: 'managed' }),
        operation('dns_and_portal', '/ip/firewall/filter/add', {
          chain: 'input', action: 'accept', protocol: 'tcp', 'dst-port': '53',
          'src-address': hotspotNetwork, 'place-before': '0', comment: 'NEXA allow Hotspot DNS TCP',
        }, 'Allow TCP DNS only from the Hotspot subnet', { ensure: 'managed' }),
        operation('dns_and_portal', '/ip/firewall/filter/add', {
          chain: 'input', action: 'drop', protocol: 'udp', 'dst-port': '53',
          'in-interface-list': wanList, 'place-before': '0', comment: 'NEXA block public DNS UDP',
        }, 'Block public DNS recursion from WAN', { ensure: 'managed' }),
        operation('dns_and_portal', '/ip/firewall/filter/add', {
          chain: 'input', action: 'drop', protocol: 'tcp', 'dst-port': '53',
          'in-interface-list': wanList, 'place-before': '0', comment: 'NEXA block public DNS TCP',
        }, 'Block public TCP DNS recursion from WAN', { ensure: 'managed' }),
        operation('dns_and_portal', 'nexa://file/ensure-directory', {
          name: 'nexa-hotspot',
        }, 'Create tenant portal directory'),
        operation('dns_and_portal', 'nexa://file/write', {
          name: 'nexa-hotspot/login.html', content_ref: 'tenant-hotspot-login',
        }, 'Install tenant captive portal login file'),
        operation('dns_and_portal', 'nexa://file/write', {
          name: 'nexa-hotspot/status.html', content_ref: 'tenant-hotspot-status',
        }, 'Install tenant captive portal status file'),
        operation('dns_and_portal', 'nexa://file/write', {
          name: 'nexa-hotspot/logout.html', content_ref: 'tenant-hotspot-logout',
        }, 'Install tenant captive portal logout file'),
      ],
    });
    stages.push({
      name: 'hotspot_service',
      operations: [
        operation('hotspot_service', '/ip/hotspot/profile/add', {
          name: 'NEXA-HOTSPOT-PROFILE', 'hotspot-address': hotspotAddress,
          'dns-name': portalDomain, 'html-directory': 'nexa-hotspot',
          'login-by': 'http-chap,http-pap,cookie', 'use-radius': 'yes',
          'radius-accounting': 'yes', 'radius-interim-update': '1m',
          comment: 'NEXA managed Hotspot profile',
        }, 'Create RADIUS Hotspot profile', { ensure: 'managed' }),
        operation('hotspot_service', '/ip/hotspot/add', {
          name: 'NEXA-HOTSPOT', interface: hotspotInterface, 'address-pool': 'NEXA-HOTSPOT-POOL',
          profile: 'NEXA-HOTSPOT-PROFILE', disabled: 'yes', comment: 'NEXA managed Hotspot server',
        }, 'Stage Hotspot server', { ensure: 'managed' }),
        operation('hotspot_service', '/ip/hotspot/walled-garden/add', {
          'dst-host': portalHost, action: 'allow', comment: 'NEXA managed portal access',
        }, 'Allow captive portal before authentication', { ensure: 'managed' }),
      ],
    });
  }

  if (desired.pppoe) {
    stages.push({
      name: 'pppoe_service',
      operations: [
        operation('pppoe_service', '/ip/pool/add', {
          name: 'NEXA-PPPOE-POOL', ranges: pppoePool, comment: 'NEXA managed PPPoE pool',
        }, 'Create PPPoE address pool', { ensure: 'managed' }),
        operation('pppoe_service', '/ppp/profile/add', {
          name: 'NEXA-PPPOE-PROFILE', 'local-address': pppoeGateway,
          'remote-address': 'NEXA-PPPOE-POOL', 'only-one': 'yes',
          'change-tcp-mss': 'yes', comment: 'NEXA managed PPPoE profile',
        }, 'Create PPPoE service profile', { ensure: 'managed' }),
        operation('pppoe_service', '/interface/pppoe-server/server/add', {
          'service-name': String(desired.pppoe_service_name || 'NEXA-PPPoE'),
          interface: pppoeInterface, 'default-profile': 'NEXA-PPPOE-PROFILE',
          'one-session-per-host': 'yes', disabled: 'yes', comment: 'NEXA managed PPPoE server',
        }, 'Stage PPPoE server', { ensure: 'managed' }),
      ],
    });
  }

  stages.push({
    name: 'radius_on_router',
    operations: [
      operation('radius_on_router', '/radius/add', {
        service: [desired.pppoe ? 'ppp' : null, desired.hotspot ? 'hotspot' : null].filter(Boolean).join(','),
        address: radiusHost, 'authentication-port': '1812', 'accounting-port': '1813',
        timeout: '2s', comment: 'NEXA managed RADIUS',
      }, 'Configure private RADIUS authentication and accounting', {
        secret_ref: 'router-radius-secret', ensure: 'managed',
      }),
      operation('radius_on_router', '/ip/firewall/filter/add', {
        chain: 'input', action: 'accept', protocol: 'udp', 'dst-port': String(radiusDynamicAuthPort),
        'src-address': radiusHost, 'place-before': '0', comment: 'NEXA allow RADIUS dynamic auth',
      }, 'Allow RADIUS Disconnect and CoA only from the Polyizon RADIUS host', { ensure: 'managed' }),
      operation('radius_on_router', '/radius/incoming/set', {
        accept: 'yes', port: String(radiusDynamicAuthPort),
      }, 'Enable RADIUS Disconnect and CoA from Polyizon'),
      ...(desired.pppoe ? [operation('radius_on_router', '/ppp/aaa/set', {
        'use-radius': 'yes', accounting: 'yes', 'interim-update': '1m',
      }, 'Enable PPPoE authentication and accounting through RADIUS')] : []),
    ],
  });

  stages.push({
    name: 'subscriber_internet',
    operations: [
      operation('subscriber_internet', '/ip/firewall/nat/add', {
        chain: 'srcnat', action: 'masquerade', 'out-interface-list': wanList,
        comment: 'NEXA managed subscriber NAT',
      }, 'Provide subscriber internet access', { ensure: 'managed' }),
    ],
  });

  stages.push({
    name: 'activate_after_validation',
    operations: [
      ...(desired.hotspot ? [
        operation('activate_after_validation', '/ip/dhcp-server/set', { disabled: 'no' }, 'Enable Hotspot DHCP', { selector: { name: 'NEXA-HOTSPOT-DHCP' } }),
        operation('activate_after_validation', '/ip/hotspot/set', { disabled: 'no' }, 'Enable Hotspot server', { selector: { name: 'NEXA-HOTSPOT' } }),
      ] : []),
      ...(desired.pppoe ? [
        operation('activate_after_validation', '/interface/pppoe-server/server/set', { disabled: 'no' }, 'Enable PPPoE server', { selector: { comment: 'NEXA managed PPPoE server' } }),
      ] : []),
    ],
  });

  const verification = [
    { type: 'management', path: '/system/resource/print', expect: 'one_row' },
    { type: 'radius_udp', host: radiusHost, ports: [1812, 1813], expect: 'reachable' },
    { type: 'radius_dynamic_authorization', host: radiusHost, port: radiusDynamicAuthPort, expect: 'incoming_enabled' },
    { type: 'internet', target: '1.1.1.1', expect: 'reply' },
    ...(desired.pppoe ? [
      { type: 'pppoe_server', name: 'NEXA-PPPoE', expect: 'enabled' },
      { type: 'pppoe_radius', expect: 'access_accept_and_accounting_start' },
    ] : []),
    ...(desired.hotspot ? [
      { type: 'hotspot_server', name: 'NEXA-HOTSPOT', expect: 'enabled' },
      { type: 'portal_files', names: ['login.html', 'status.html', 'logout.html'], expect: 'present' },
      { type: 'hotspot_radius', expect: 'access_accept_and_accounting_start' },
      { type: 'dns', server: hotspotAddress, expect: 'reply' },
    ] : []),
  ];

  return {
    adapter_version: capability.adapter_version,
    desired_state: desired,
    conflict_report: { status: 'clear', conflicts: [] },
    stages,
    rollback_stages: [{
      name: 'structured_rollback',
      operations: [
        operation('rollback', 'nexa://managed-resources/remove', { comment_prefix: 'NEXA managed' }, 'Remove only resources created by this run'),
        operation('rollback', 'nexa://snapshot/restore', {}, 'Restore DNS, PPP AAA, and RADIUS incoming settings from the checkpoint'),
        operation('rollback', 'nexa://radius/unregister-nas', { nas_identifier: input.nas_identifier }, 'Remove tenant NAS registration'),
      ],
    }],
    verification_probes: verification,
    execution_ready: true,
    activation_policy: 'services_remain_disabled_until_pre-activation checks pass',
  };
}

module.exports = {
  compileBillingBlueprint,
  networkFromGateway,
  resourceConflicts,
};

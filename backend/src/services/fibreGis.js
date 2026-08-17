const db = require('../db');
const { ensureMikrotikTables } = require('./mikrotik');

const ASSET_TYPES = new Set([
  'pop', 'olt', 'odf', 'fdt', 'fat', 'splitter', 'pole', 'manhole',
  'splice_closure', 'tower', 'cabinet', 'customer_site', 'other',
]);
const ASSET_STATUSES = new Set(['active', 'planned', 'maintenance', 'down', 'retired']);
const ROUTE_TYPES = new Set(['feeder', 'distribution', 'drop', 'backhaul', 'duct', 'other']);
const ROUTE_STATUSES = new Set(['active', 'planned', 'maintenance', 'down', 'retired']);

function text(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

function nullableText(value, max = 500) {
  const result = text(value, max);
  return result || null;
}

function integer(value, fallback = null, min = 0, max = 1000000) {
  if (value === '' || value === null || value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

function nullableId(value) {
  return integer(value, null, 1, Number.MAX_SAFE_INTEGER);
}

function coordinate(value, kind) {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = Number(value);
  const limit = kind === 'latitude' ? 90 : 180;
  if (!Number.isFinite(parsed) || parsed < -limit || parsed > limit) {
    throw new Error(`${kind} is invalid`);
  }
  return Number(parsed.toFixed(7));
}

function safeMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const serialized = JSON.stringify(value);
  if (serialized.length > 30000) throw new Error('metadata is too large');
  return value;
}

function normalizeAssetPayload(payload = {}) {
  const assetType = text(payload.asset_type || payload.type, 32).toLowerCase();
  if (!ASSET_TYPES.has(assetType)) throw new Error('Unsupported infrastructure type');
  const name = text(payload.name, 180);
  if (!name) throw new Error('Infrastructure name is required');
  const status = text(payload.status || 'active', 32).toLowerCase();
  if (!ASSET_STATUSES.has(status)) throw new Error('Unsupported infrastructure status');
  const latitude = coordinate(payload.latitude, 'latitude');
  const longitude = coordinate(payload.longitude, 'longitude');
  if (latitude === null || longitude === null) throw new Error('Latitude and longitude are required');
  const capacity = integer(payload.capacity, null, 0, 1000000);
  const usedPorts = integer(payload.used_ports, null, 0, 1000000);
  if (capacity !== null && usedPorts !== null && usedPorts > capacity) {
    throw new Error('Used ports cannot exceed capacity');
  }
  return {
    asset_type: assetType,
    name,
    code: nullableText(payload.code, 100),
    status,
    latitude,
    longitude,
    parent_asset_id: nullableId(payload.parent_asset_id),
    linked_router_id: nullableId(payload.linked_router_id),
    capacity,
    used_ports: usedPorts,
    splitter_ratio: nullableText(payload.splitter_ratio, 32),
    manufacturer: nullableText(payload.manufacturer, 120),
    model: nullableText(payload.model, 120),
    serial_number: nullableText(payload.serial_number, 160),
    address: nullableText(payload.address, 1000),
    notes: nullableText(payload.notes, 4000),
    metadata: safeMetadata(payload.metadata),
  };
}

function haversineMeters(a, b) {
  const toRad = (degrees) => degrees * Math.PI / 180;
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const dLat = lat2 - lat1;
  const dLon = toRad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371008.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function normalizeGeometry(value) {
  const geometry = value?.type === 'LineString'
    ? value
    : { type: 'LineString', coordinates: Array.isArray(value) ? value : value?.coordinates };
  if (!Array.isArray(geometry.coordinates) || geometry.coordinates.length < 2) {
    throw new Error('A fibre route requires at least two map points');
  }
  if (geometry.coordinates.length > 5000) throw new Error('Fibre route has too many map points');
  const coordinates = geometry.coordinates.map((pair) => {
    if (!Array.isArray(pair) || pair.length < 2) throw new Error('Fibre route contains an invalid point');
    const lng = coordinate(pair[0], 'longitude');
    const lat = coordinate(pair[1], 'latitude');
    if (lat === null || lng === null) throw new Error('Fibre route contains an invalid point');
    return [lng, lat];
  });
  let length = 0;
  for (let index = 1; index < coordinates.length; index += 1) {
    length += haversineMeters(coordinates[index - 1], coordinates[index]);
  }
  return {
    geometry: { type: 'LineString', coordinates },
    length_m: Number(length.toFixed(2)),
  };
}

function normalizeRoutePayload(payload = {}) {
  const name = text(payload.name, 180);
  if (!name) throw new Error('Fibre route name is required');
  const routeType = text(payload.route_type || 'distribution', 32).toLowerCase();
  if (!ROUTE_TYPES.has(routeType)) throw new Error('Unsupported fibre route type');
  const status = text(payload.status || 'active', 32).toLowerCase();
  if (!ROUTE_STATUSES.has(status)) throw new Error('Unsupported fibre route status');
  const coreCount = integer(payload.core_count, 0, 0, 1000000) ?? 0;
  const usedCores = integer(payload.used_cores, 0, 0, 1000000) ?? 0;
  if (coreCount > 0 && usedCores > coreCount) throw new Error('Used cores cannot exceed total cores');
  const normalized = normalizeGeometry(payload.geometry || payload.coordinates);
  const installationDate = text(payload.installation_date, 20);
  if (installationDate && !/^\d{4}-\d{2}-\d{2}$/.test(installationDate)) {
    throw new Error('Installation date must use YYYY-MM-DD');
  }
  return {
    name,
    route_type: routeType,
    status,
    core_count: coreCount,
    used_cores: usedCores,
    start_asset_id: nullableId(payload.start_asset_id),
    end_asset_id: nullableId(payload.end_asset_id),
    geometry: normalized.geometry,
    length_m: normalized.length_m,
    owner: nullableText(payload.owner, 180),
    installation_date: installationDate || null,
    notes: nullableText(payload.notes, 4000),
    metadata: safeMetadata(payload.metadata),
  };
}

async function ensureFibreGisSchema() {
  await ensureMikrotikTables();
  await db.query('ALTER TABLE mikrotik_routers ADD COLUMN IF NOT EXISTS topology_latitude NUMERIC');
  await db.query('ALTER TABLE mikrotik_routers ADD COLUMN IF NOT EXISTS topology_longitude NUMERIC');
  await db.query('ALTER TABLE mikrotik_routers ADD COLUMN IF NOT EXISTS topology_site_label VARCHAR(180)');
  await db.query('ALTER TABLE mikrotik_routers ADD COLUMN IF NOT EXISTS topology_role VARCHAR(40)');
  await db.query(`
    CREATE TABLE IF NOT EXISTS network_gis_assets (
      id BIGSERIAL PRIMARY KEY,
      client_id INTEGER NOT NULL,
      asset_type VARCHAR(32) NOT NULL,
      name VARCHAR(180) NOT NULL,
      code VARCHAR(100),
      status VARCHAR(32) NOT NULL DEFAULT 'active',
      latitude DOUBLE PRECISION NOT NULL,
      longitude DOUBLE PRECISION NOT NULL,
      parent_asset_id BIGINT REFERENCES network_gis_assets(id) ON DELETE SET NULL,
      linked_router_id INTEGER,
      capacity INTEGER,
      used_ports INTEGER,
      splitter_ratio VARCHAR(32),
      manufacturer VARCHAR(120),
      model VARCHAR(120),
      serial_number VARCHAR(160),
      address TEXT,
      notes TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS network_gis_routes (
      id BIGSERIAL PRIMARY KEY,
      client_id INTEGER NOT NULL,
      name VARCHAR(180) NOT NULL,
      route_type VARCHAR(32) NOT NULL DEFAULT 'distribution',
      status VARCHAR(32) NOT NULL DEFAULT 'active',
      core_count INTEGER NOT NULL DEFAULT 0,
      used_cores INTEGER NOT NULL DEFAULT 0,
      start_asset_id BIGINT REFERENCES network_gis_assets(id) ON DELETE SET NULL,
      end_asset_id BIGINT REFERENCES network_gis_assets(id) ON DELETE SET NULL,
      geometry JSONB NOT NULL,
      length_m DOUBLE PRECISION NOT NULL DEFAULT 0,
      owner VARCHAR(180),
      installation_date DATE,
      notes TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.query('CREATE INDEX IF NOT EXISTS idx_network_gis_assets_client ON network_gis_assets(client_id)');
  await db.query('CREATE INDEX IF NOT EXISTS idx_network_gis_assets_parent ON network_gis_assets(client_id, parent_asset_id)');
  await db.query('CREATE INDEX IF NOT EXISTS idx_network_gis_assets_router ON network_gis_assets(client_id, linked_router_id)');
  await db.query('CREATE INDEX IF NOT EXISTS idx_network_gis_routes_client ON network_gis_routes(client_id)');
}

async function assertAsset(clientId, assetId, currentId = null) {
  if (!assetId) return;
  if (currentId && Number(assetId) === Number(currentId)) throw new Error('Infrastructure cannot be its own parent');
  const result = await db.query('SELECT id FROM network_gis_assets WHERE client_id = $1 AND id = $2', [clientId, assetId]);
  if (!result.rows[0]) throw new Error('Selected infrastructure item was not found');
}

async function assertRouter(clientId, routerId) {
  if (!routerId) return;
  const result = await db.query('SELECT id FROM mikrotik_routers WHERE client_id = $1 AND id = $2', [clientId, routerId]);
  if (!result.rows[0]) throw new Error('Selected router was not found');
}

async function listFibreGis(clientId) {
  await ensureFibreGisSchema();
  const [assetsResult, routesResult, routersResult] = await Promise.all([
    db.query(`
      SELECT a.*, p.name AS parent_name,
             COALESCE(r.last_identity, r.name) AS linked_router_name
      FROM network_gis_assets a
      LEFT JOIN network_gis_assets p ON p.id = a.parent_asset_id AND p.client_id = a.client_id
      LEFT JOIN mikrotik_routers r ON r.id = a.linked_router_id AND r.client_id = a.client_id
      WHERE a.client_id = $1
      ORDER BY a.asset_type, a.name, a.id
    `, [clientId]),
    db.query(`
      SELECT f.*, s.name AS start_asset_name, e.name AS end_asset_name
      FROM network_gis_routes f
      LEFT JOIN network_gis_assets s ON s.id = f.start_asset_id AND s.client_id = f.client_id
      LEFT JOIN network_gis_assets e ON e.id = f.end_asset_id AND e.client_id = f.client_id
      WHERE f.client_id = $1
      ORDER BY f.created_at DESC, f.id DESC
    `, [clientId]),
    db.query(`
      SELECT id, name, last_identity, last_status, topology_latitude, topology_longitude,
             topology_site_label, topology_role
      FROM mikrotik_routers
      WHERE client_id = $1
      ORDER BY created_at ASC
    `, [clientId]),
  ]);
  const assets = assetsResult.rows;
  const routes = routesResult.rows;
  const stats = {
    assets: assets.length,
    routes: routes.length,
    fibre_km: Number((routes.reduce((sum, row) => sum + Number(row.length_m || 0), 0) / 1000).toFixed(2)),
    total_cores: routes.reduce((sum, row) => sum + Number(row.core_count || 0), 0),
    used_cores: routes.reduce((sum, row) => sum + Number(row.used_cores || 0), 0),
    active_assets: assets.filter((row) => row.status === 'active').length,
    down_assets: assets.filter((row) => row.status === 'down').length,
  };
  return { assets, routes, routers: routersResult.rows, stats };
}

async function createAsset(clientId, payload) {
  await ensureFibreGisSchema();
  const item = normalizeAssetPayload(payload);
  await assertAsset(clientId, item.parent_asset_id);
  await assertRouter(clientId, item.linked_router_id);
  const result = await db.query(`
    INSERT INTO network_gis_assets (
      client_id, asset_type, name, code, status, latitude, longitude,
      parent_asset_id, linked_router_id, capacity, used_ports, splitter_ratio,
      manufacturer, model, serial_number, address, notes, metadata
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
    RETURNING *
  `, [clientId, item.asset_type, item.name, item.code, item.status, item.latitude, item.longitude,
    item.parent_asset_id, item.linked_router_id, item.capacity, item.used_ports, item.splitter_ratio,
    item.manufacturer, item.model, item.serial_number, item.address, item.notes, item.metadata]);
  return result.rows[0];
}

async function updateAsset(clientId, id, payload) {
  await ensureFibreGisSchema();
  const item = normalizeAssetPayload(payload);
  await assertAsset(clientId, item.parent_asset_id, id);
  await assertRouter(clientId, item.linked_router_id);
  const result = await db.query(`
    UPDATE network_gis_assets SET
      asset_type=$3, name=$4, code=$5, status=$6, latitude=$7, longitude=$8,
      parent_asset_id=$9, linked_router_id=$10, capacity=$11, used_ports=$12,
      splitter_ratio=$13, manufacturer=$14, model=$15, serial_number=$16,
      address=$17, notes=$18, metadata=$19, updated_at=NOW()
    WHERE client_id=$1 AND id=$2
    RETURNING *
  `, [clientId, id, item.asset_type, item.name, item.code, item.status, item.latitude, item.longitude,
    item.parent_asset_id, item.linked_router_id, item.capacity, item.used_ports, item.splitter_ratio,
    item.manufacturer, item.model, item.serial_number, item.address, item.notes, item.metadata]);
  return result.rows[0] || null;
}

async function deleteAsset(clientId, id) {
  await ensureFibreGisSchema();
  const dependency = await db.query(`
    SELECT
      EXISTS(SELECT 1 FROM network_gis_assets WHERE client_id=$1 AND parent_asset_id=$2) AS has_children,
      EXISTS(SELECT 1 FROM network_gis_routes WHERE client_id=$1 AND (start_asset_id=$2 OR end_asset_id=$2)) AS has_routes
  `, [clientId, id]);
  if (dependency.rows[0]?.has_children) throw new Error('Move or delete downstream infrastructure before deleting this item');
  if (dependency.rows[0]?.has_routes) throw new Error('Delete or detach connected fibre routes before deleting this item');
  const result = await db.query('DELETE FROM network_gis_assets WHERE client_id=$1 AND id=$2 RETURNING id', [clientId, id]);
  return Boolean(result.rows[0]);
}

async function createRoute(clientId, payload) {
  await ensureFibreGisSchema();
  const item = normalizeRoutePayload(payload);
  await assertAsset(clientId, item.start_asset_id);
  await assertAsset(clientId, item.end_asset_id);
  const result = await db.query(`
    INSERT INTO network_gis_routes (
      client_id, name, route_type, status, core_count, used_cores,
      start_asset_id, end_asset_id, geometry, length_m, owner,
      installation_date, notes, metadata
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
    RETURNING *
  `, [clientId, item.name, item.route_type, item.status, item.core_count, item.used_cores,
    item.start_asset_id, item.end_asset_id, item.geometry, item.length_m, item.owner,
    item.installation_date, item.notes, item.metadata]);
  return result.rows[0];
}

async function updateRoute(clientId, id, payload) {
  await ensureFibreGisSchema();
  const item = normalizeRoutePayload(payload);
  await assertAsset(clientId, item.start_asset_id);
  await assertAsset(clientId, item.end_asset_id);
  const result = await db.query(`
    UPDATE network_gis_routes SET
      name=$3, route_type=$4, status=$5, core_count=$6, used_cores=$7,
      start_asset_id=$8, end_asset_id=$9, geometry=$10, length_m=$11,
      owner=$12, installation_date=$13, notes=$14, metadata=$15, updated_at=NOW()
    WHERE client_id=$1 AND id=$2
    RETURNING *
  `, [clientId, id, item.name, item.route_type, item.status, item.core_count, item.used_cores,
    item.start_asset_id, item.end_asset_id, item.geometry, item.length_m, item.owner,
    item.installation_date, item.notes, item.metadata]);
  return result.rows[0] || null;
}

async function deleteRoute(clientId, id) {
  await ensureFibreGisSchema();
  const result = await db.query('DELETE FROM network_gis_routes WHERE client_id=$1 AND id=$2 RETURNING id', [clientId, id]);
  return Boolean(result.rows[0]);
}

async function syncTopologySites(clientId) {
  await ensureFibreGisSchema();
  const result = await db.query(`
    INSERT INTO network_gis_assets (
      client_id, asset_type, name, code, status, latitude, longitude,
      linked_router_id, notes, metadata
    )
    SELECT r.client_id,
           CASE
             WHEN LOWER(COALESCE(r.topology_role,'')) = 'olt' THEN 'olt'
             WHEN LOWER(COALESCE(r.topology_role,'')) = 'ap' THEN 'tower'
             ELSE 'pop'
           END,
           COALESCE(NULLIF(r.topology_site_label,''), NULLIF(r.last_identity,''), r.name, 'Network site'),
           CONCAT('RTR-', r.id),
           CASE WHEN LOWER(COALESCE(r.last_status,'')) IN ('online','ok','active') THEN 'active' ELSE 'maintenance' END,
           r.topology_latitude::double precision,
           r.topology_longitude::double precision,
           r.id,
           'Imported from Network Topology',
           jsonb_build_object('source','network_topology','topology_role',COALESCE(r.topology_role,''))
    FROM mikrotik_routers r
    WHERE r.client_id=$1
      AND r.topology_latitude IS NOT NULL
      AND r.topology_longitude IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM network_gis_assets a
        WHERE a.client_id=r.client_id AND a.linked_router_id=r.id
      )
    RETURNING *
  `, [clientId]);
  return { imported: result.rows.length, assets: result.rows };
}

module.exports = {
  ensureFibreGisSchema,
  listFibreGis,
  createAsset,
  updateAsset,
  deleteAsset,
  createRoute,
  updateRoute,
  deleteRoute,
  syncTopologySites,
};

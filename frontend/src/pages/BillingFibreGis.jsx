import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import api from '../utils/api';

const MAP_STYLE = '/api/noc/fibre-gis/map/styles/liberty';
const MAP_PROXY_PATH = '/api/noc/fibre-gis/map/';

function transformMapRequest(url) {
  if (!String(url || '').includes(MAP_PROXY_PATH)) return { url };
  const token = sessionStorage.getItem('token') || localStorage.getItem('token');
  return token ? { url, headers: { Authorization: `Bearer ${token}` } } : { url };
}

const ASSET_TYPES = [
  ['pop', 'POP', '#064e3b'],
  ['olt', 'OLT', '#6d28d9'],
  ['odf', 'ODF', '#0369a1'],
  ['fdt', 'FDT', '#0f766e'],
  ['fat', 'FAT', '#059669'],
  ['splitter', 'Splitter', '#d97706'],
  ['cabinet', 'Cabinet', '#475569'],
  ['pole', 'Pole', '#78716c'],
  ['manhole', 'Manhole', '#334155'],
  ['splice_closure', 'Splice', '#9333ea'],
  ['tower', 'Tower', '#0284c7'],
  ['customer_site', 'Customer', '#be123c'],
  ['other', 'Other', '#64748b'],
];
const ROUTE_TYPES = [
  ['feeder', 'Feeder', '#047857'],
  ['distribution', 'Distribution', '#0f766e'],
  ['drop', 'Drop', '#d97706'],
  ['backhaul', 'Backhaul', '#0369a1'],
  ['duct', 'Duct', '#475569'],
  ['other', 'Other', '#64748b'],
];
const STATUS_OPTIONS = ['active', 'planned', 'maintenance', 'down', 'retired'];
const assetTypeMap = Object.fromEntries(ASSET_TYPES.map(([key, label, color]) => [key, { label, color }]));
const routeTypeMap = Object.fromEntries(ROUTE_TYPES.map(([key, label, color]) => [key, { label, color }]));
const shortType = { pop: 'POP', olt: 'OLT', odf: 'ODF', fdt: 'FDT', fat: 'FAT', splitter: 'S', cabinet: 'CAB', pole: 'P', manhole: 'M', splice_closure: 'SC', tower: 'TWR', customer_site: 'CPE', other: '•' };

function Icon({ name, className = 'h-4 w-4' }) {
  const paths = {
    map: <><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z" /><path d="M9 3v15M15 6v15" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    route: <><path d="M5 18c0-6 14-6 14-12" /><circle cx="5" cy="18" r="2" /><circle cx="19" cy="6" r="2" /></>,
    layers: <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5M3 16l9 5 9-5" /></>,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
    gps: <><circle cx="12" cy="12" r="3" /><circle cx="12" cy="12" r="8" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></>,
    refresh: <><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></>,
    download: <><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></>,
    sync: <><path d="M20 7h-7V0" /><path d="M20 7a9 9 0 0 0-15.5-3M4 17h7v7" /><path d="M4 17a9 9 0 0 0 15.5 3" /></>,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    trash: <><path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14" /></>,
    edit: <><path d="m4 20 4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20Z" /><path d="m13.5 7.5 3 3" /></>,
    undo: <><path d="M9 7 4 12l5 5" /><path d="M4 12h9a6 6 0 0 1 6 6" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    cube: <><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" /><path d="m4 7.5 8 4.5 8-4.5M12 12v9" /></>,
    chevron: <path d="m9 5 7 7-7 7" />,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true" className={`${className} fill-none stroke-current`} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name] || paths.map}</svg>;
}

const formatNumber = (value, digits = 0) => Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: digits });
const formatLength = (meters) => Number(meters || 0) >= 1000 ? `${formatNumber(Number(meters) / 1000, 2)} km` : `${formatNumber(meters, 0)} m`;

function distanceMeters(a, b) {
  const rad = (value) => value * Math.PI / 180;
  const lat1 = rad(Number(a.latitude));
  const lat2 = rad(Number(b[1]));
  const dLat = lat2 - lat1;
  const dLon = rad(Number(b[0]) - Number(a.longitude));
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371008.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function nearestAsset(point, assets, maxDistance = 45) {
  let best = null;
  let bestDistance = maxDistance;
  assets.forEach((asset) => {
    const distance = distanceMeters(asset, point);
    if (distance < bestDistance) { best = asset; bestDistance = distance; }
  });
  return best;
}

function StatusDot({ status }) {
  const tone = status === 'active' ? 'bg-emerald-500' : status === 'down' ? 'bg-rose-500' : status === 'maintenance' ? 'bg-amber-500' : 'bg-slate-400';
  return <i className={`inline-block h-2 w-2 rounded-full ${tone}`} />;
}

function Metric({ label, value, note }) {
  return <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm"><span className="text-[7px] font-black uppercase tracking-[.14em] text-slate-400">{label}</span><b className="mt-0.5 block text-[15px] leading-5 text-slate-950">{value}</b><span className="block truncate text-[8px] text-slate-400">{note}</span></div>;
}

const emptyAsset = {
  asset_type: 'fat', name: '', code: '', status: 'active', latitude: '', longitude: '',
  parent_asset_id: '', linked_router_id: '', capacity: '', used_ports: '', splitter_ratio: '',
  manufacturer: '', model: '', serial_number: '', address: '', notes: '', metadata: {},
};
const emptyRoute = {
  name: '', route_type: 'distribution', status: 'active', core_count: '24', used_cores: '0',
  start_asset_id: '', end_asset_id: '', owner: '', installation_date: '', notes: '', geometry: null,
};

function AssetModal({ initial, assets, routers, onClose, onSave, saving }) {
  const [form, setForm] = useState(() => ({ ...emptyAsset, ...initial }));
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const editingId = initial?.id;
  const possibleParents = assets.filter((item) => Number(item.id) !== Number(editingId));
  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/40 p-3 backdrop-blur-[2px]"><div className="max-h-[92vh] w-full max-w-[680px] overflow-y-auto rounded-[22px] border border-white/70 bg-white shadow-2xl"><div className="sticky top-0 z-10 flex items-start justify-between border-b border-slate-100 bg-white/95 px-4 py-3 backdrop-blur"><div><span className="text-[8px] font-black uppercase tracking-[.18em] text-emerald-600">Outside plant</span><h3 className="text-lg font-black text-slate-950">{editingId ? 'Edit infrastructure' : 'Add infrastructure'}</h3></div><button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"><Icon name="close" /></button></div><div className="grid gap-3 p-4 sm:grid-cols-2">
    <label><span className="text-[8px] font-bold uppercase text-slate-400">Type</span><select value={form.asset_type} onChange={(e) => update('asset_type', e.target.value)} className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-[10px] outline-none focus:border-emerald-400">{ASSET_TYPES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
    <label><span className="text-[8px] font-bold uppercase text-slate-400">Status</span><select value={form.status} onChange={(e) => update('status', e.target.value)} className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-[10px] outline-none focus:border-emerald-400">{STATUS_OPTIONS.map((status) => <option key={status} value={status}>{status}</option>)}</select></label>
    <label className="sm:col-span-2"><span className="text-[8px] font-bold uppercase text-slate-400">Name</span><input value={form.name} onChange={(e) => update('name', e.target.value)} placeholder="e.g. FAT-KIT-042" className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2.5 text-[10px] outline-none focus:border-emerald-400" /></label>
    <label><span className="text-[8px] font-bold uppercase text-slate-400">Asset code</span><input value={form.code || ''} onChange={(e) => update('code', e.target.value)} placeholder="FAT-042" className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2.5 text-[10px] outline-none focus:border-emerald-400" /></label>
    <label><span className="text-[8px] font-bold uppercase text-slate-400">Upstream / parent</span><select value={form.parent_asset_id || ''} onChange={(e) => update('parent_asset_id', e.target.value)} className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-[10px] outline-none focus:border-emerald-400"><option value="">No parent</option>{possibleParents.map((item) => <option key={item.id} value={item.id}>{assetTypeMap[item.asset_type]?.label || item.asset_type} · {item.name}</option>)}</select></label>
    <label><span className="text-[8px] font-bold uppercase text-slate-400">Latitude</span><input value={form.latitude} onChange={(e) => update('latitude', e.target.value)} inputMode="decimal" className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2.5 text-[10px] outline-none focus:border-emerald-400" /></label>
    <label><span className="text-[8px] font-bold uppercase text-slate-400">Longitude</span><input value={form.longitude} onChange={(e) => update('longitude', e.target.value)} inputMode="decimal" className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2.5 text-[10px] outline-none focus:border-emerald-400" /></label>
    <label><span className="text-[8px] font-bold uppercase text-slate-400">Capacity / ports</span><input value={form.capacity ?? ''} onChange={(e) => update('capacity', e.target.value)} type="number" min="0" className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2.5 text-[10px] outline-none focus:border-emerald-400" /></label>
    <label><span className="text-[8px] font-bold uppercase text-slate-400">Used ports</span><input value={form.used_ports ?? ''} onChange={(e) => update('used_ports', e.target.value)} type="number" min="0" className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2.5 text-[10px] outline-none focus:border-emerald-400" /></label>
    <label><span className="text-[8px] font-bold uppercase text-slate-400">Splitter ratio</span><input value={form.splitter_ratio || ''} onChange={(e) => update('splitter_ratio', e.target.value)} placeholder="1:8" className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2.5 text-[10px] outline-none focus:border-emerald-400" /></label>
    <label><span className="text-[8px] font-bold uppercase text-slate-400">Linked network device</span><select value={form.linked_router_id || ''} onChange={(e) => update('linked_router_id', e.target.value)} className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-[10px] outline-none focus:border-emerald-400"><option value="">None</option>{routers.map((router) => <option key={router.id} value={router.id}>{router.last_identity || router.name || `Router ${router.id}`}</option>)}</select></label>
    <label><span className="text-[8px] font-bold uppercase text-slate-400">Manufacturer</span><input value={form.manufacturer || ''} onChange={(e) => update('manufacturer', e.target.value)} className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2.5 text-[10px] outline-none focus:border-emerald-400" /></label>
    <label><span className="text-[8px] font-bold uppercase text-slate-400">Model</span><input value={form.model || ''} onChange={(e) => update('model', e.target.value)} className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2.5 text-[10px] outline-none focus:border-emerald-400" /></label>
    <label className="sm:col-span-2"><span className="text-[8px] font-bold uppercase text-slate-400">Serial number</span><input value={form.serial_number || ''} onChange={(e) => update('serial_number', e.target.value)} className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2.5 text-[10px] outline-none focus:border-emerald-400" /></label>
    <label className="sm:col-span-2"><span className="text-[8px] font-bold uppercase text-slate-400">Address / location description</span><input value={form.address || ''} onChange={(e) => update('address', e.target.value)} placeholder="Road, estate, landmark..." className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2.5 text-[10px] outline-none focus:border-emerald-400" /></label>
    <label className="sm:col-span-2"><span className="text-[8px] font-bold uppercase text-slate-400">Notes</span><textarea value={form.notes || ''} onChange={(e) => update('notes', e.target.value)} rows="3" className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 text-[10px] outline-none focus:border-emerald-400" /></label>
  </div><div className="sticky bottom-0 flex justify-end gap-2 border-t border-slate-100 bg-white/95 px-4 py-3 backdrop-blur"><button type="button" onClick={onClose} className="h-9 rounded-lg border border-slate-200 px-4 text-[9px] font-black text-slate-600">Cancel</button><button type="button" disabled={saving || !form.name || form.latitude === '' || form.longitude === ''} onClick={() => onSave(form)} className="h-9 rounded-lg bg-emerald-500 px-4 text-[9px] font-black text-white disabled:opacity-40">{saving ? 'Saving...' : editingId ? 'Save changes' : 'Add infrastructure'}</button></div></div></div>;
}

function RouteModal({ initial, assets, onClose, onSave, saving }) {
  const [form, setForm] = useState(() => ({ ...emptyRoute, ...initial }));
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/40 p-3 backdrop-blur-[2px]"><div className="w-full max-w-[580px] overflow-hidden rounded-[22px] border border-white/70 bg-white shadow-2xl"><div className="flex items-start justify-between border-b border-slate-100 px-4 py-3"><div><span className="text-[8px] font-black uppercase tracking-[.18em] text-emerald-600">Fibre plant</span><h3 className="text-lg font-black text-slate-950">{initial?.id ? 'Edit fibre route' : 'Save fibre route'}</h3></div><button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"><Icon name="close" /></button></div><div className="grid gap-3 p-4 sm:grid-cols-2">
    <label className="sm:col-span-2"><span className="text-[8px] font-bold uppercase text-slate-400">Route name</span><input value={form.name} onChange={(e) => update('name', e.target.value)} placeholder="e.g. Kitengela Feeder A" className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2.5 text-[10px] outline-none focus:border-emerald-400" /></label>
    <label><span className="text-[8px] font-bold uppercase text-slate-400">Route type</span><select value={form.route_type} onChange={(e) => update('route_type', e.target.value)} className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-[10px] outline-none focus:border-emerald-400">{ROUTE_TYPES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
    <label><span className="text-[8px] font-bold uppercase text-slate-400">Status</span><select value={form.status} onChange={(e) => update('status', e.target.value)} className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-[10px] outline-none focus:border-emerald-400">{STATUS_OPTIONS.map((status) => <option key={status}>{status}</option>)}</select></label>
    <label><span className="text-[8px] font-bold uppercase text-slate-400">Total fibre cores</span><input value={form.core_count} onChange={(e) => update('core_count', e.target.value)} type="number" min="0" className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2.5 text-[10px] outline-none focus:border-emerald-400" /></label>
    <label><span className="text-[8px] font-bold uppercase text-slate-400">Used cores</span><input value={form.used_cores} onChange={(e) => update('used_cores', e.target.value)} type="number" min="0" className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2.5 text-[10px] outline-none focus:border-emerald-400" /></label>
    <label><span className="text-[8px] font-bold uppercase text-slate-400">Start infrastructure</span><select value={form.start_asset_id || ''} onChange={(e) => update('start_asset_id', e.target.value)} className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-[10px] outline-none focus:border-emerald-400"><option value="">None</option>{assets.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <label><span className="text-[8px] font-bold uppercase text-slate-400">End infrastructure</span><select value={form.end_asset_id || ''} onChange={(e) => update('end_asset_id', e.target.value)} className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-[10px] outline-none focus:border-emerald-400"><option value="">None</option>{assets.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <label><span className="text-[8px] font-bold uppercase text-slate-400">Owner / provider</span><input value={form.owner || ''} onChange={(e) => update('owner', e.target.value)} className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2.5 text-[10px] outline-none focus:border-emerald-400" /></label>
    <label><span className="text-[8px] font-bold uppercase text-slate-400">Installed</span><input value={form.installation_date || ''} onChange={(e) => update('installation_date', e.target.value)} type="date" className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2.5 text-[10px] outline-none focus:border-emerald-400" /></label>
    <label className="sm:col-span-2"><span className="text-[8px] font-bold uppercase text-slate-400">Notes</span><textarea value={form.notes || ''} onChange={(e) => update('notes', e.target.value)} rows="3" className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 text-[10px] outline-none focus:border-emerald-400" /></label>
  </div><div className="flex justify-end gap-2 border-t border-slate-100 px-4 py-3"><button type="button" onClick={onClose} className="h-9 rounded-lg border border-slate-200 px-4 text-[9px] font-black text-slate-600">Cancel</button><button type="button" disabled={saving || !form.name || !form.geometry} onClick={() => onSave(form)} className="h-9 rounded-lg bg-emerald-500 px-4 text-[9px] font-black text-white disabled:opacity-40">{saving ? 'Saving...' : 'Save fibre route'}</button></div></div></div>;
}

function Inspector({ selected, assets, onEditAsset, onEditRoute, onDeleteAsset, onDeleteRoute }) {
  if (!selected) return <aside className="rounded-[18px] border border-slate-200 bg-white p-4 shadow-sm"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600"><Icon name="info" /></span><h3 className="mt-3 text-sm font-black text-slate-950">Infrastructure inspector</h3><p className="mt-1 text-[9px] leading-4 text-slate-500">Select an asset or fibre route to inspect its physical details, capacity and upstream relationship.</p></aside>;
  const isAsset = selected.kind === 'asset';
  const item = selected.item;
  const parent = isAsset && item.parent_asset_id ? assets.find((candidate) => Number(candidate.id) === Number(item.parent_asset_id)) : null;
  const children = isAsset ? assets.filter((candidate) => Number(candidate.parent_asset_id) === Number(item.id)) : [];
  const utilization = !isAsset && Number(item.core_count || 0) > 0 ? Math.round((Number(item.used_cores || 0) / Number(item.core_count || 1)) * 100) : null;
  return <aside className="overflow-hidden rounded-[18px] border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-100 p-4"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><span className="text-[8px] font-black uppercase tracking-[.16em] text-emerald-600">{isAsset ? assetTypeMap[item.asset_type]?.label || item.asset_type : `${routeTypeMap[item.route_type]?.label || item.route_type} fibre`}</span><h3 className="mt-1 truncate text-[15px] font-black text-slate-950">{item.name}</h3><span className="mt-1 inline-flex items-center gap-1.5 text-[8px] font-bold uppercase text-slate-400"><StatusDot status={item.status} />{item.status}</span></div><div className="flex gap-1"><button type="button" onClick={() => isAsset ? onEditAsset(item) : onEditRoute(item)} className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-50 text-slate-500 hover:bg-emerald-50 hover:text-emerald-700"><Icon name="edit" className="h-3.5 w-3.5" /></button><button type="button" onClick={() => isAsset ? onDeleteAsset(item) : onDeleteRoute(item)} className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-50 text-slate-500 hover:bg-rose-50 hover:text-rose-600"><Icon name="trash" className="h-3.5 w-3.5" /></button></div></div></div><div className="space-y-3 p-4">
    {isAsset ? <><div className="grid grid-cols-2 gap-2"><div className="rounded-xl bg-slate-50 p-2.5"><span className="text-[7px] font-bold uppercase text-slate-400">Capacity</span><b className="mt-1 block text-[13px] text-slate-900">{item.capacity ?? '—'}</b></div><div className="rounded-xl bg-slate-50 p-2.5"><span className="text-[7px] font-bold uppercase text-slate-400">Used</span><b className="mt-1 block text-[13px] text-slate-900">{item.used_ports ?? '—'}</b></div></div><div className="rounded-xl border border-slate-100 p-3 text-[9px] leading-4 text-slate-500"><div className="flex justify-between gap-3"><span>Code</span><b className="text-slate-800">{item.code || '—'}</b></div><div className="mt-1 flex justify-between gap-3"><span>Parent</span><b className="truncate text-right text-slate-800">{parent?.name || 'Network root'}</b></div><div className="mt-1 flex justify-between gap-3"><span>Downstream</span><b className="text-slate-800">{children.length}</b></div><div className="mt-1 flex justify-between gap-3"><span>Linked device</span><b className="truncate text-right text-slate-800">{item.linked_router_name || '—'}</b></div>{item.splitter_ratio && <div className="mt-1 flex justify-between gap-3"><span>Splitter</span><b className="text-slate-800">{item.splitter_ratio}</b></div>}<div className="mt-1 flex justify-between gap-3"><span>Coordinates</span><b className="text-right text-[8px] text-slate-800">{Number(item.latitude).toFixed(5)}, {Number(item.longitude).toFixed(5)}</b></div></div>{item.address && <div className="rounded-xl bg-slate-50 p-3 text-[9px] leading-4 text-slate-500"><b className="block text-slate-800">Location</b>{item.address}</div>}{item.notes && <div className="rounded-xl bg-slate-50 p-3 text-[9px] leading-4 text-slate-500">{item.notes}</div>}</> : <><div className="grid grid-cols-2 gap-2"><div className="rounded-xl bg-slate-50 p-2.5"><span className="text-[7px] font-bold uppercase text-slate-400">Length</span><b className="mt-1 block text-[13px] text-slate-900">{formatLength(item.length_m)}</b></div><div className="rounded-xl bg-slate-50 p-2.5"><span className="text-[7px] font-bold uppercase text-slate-400">Utilization</span><b className="mt-1 block text-[13px] text-slate-900">{utilization === null ? '—' : `${utilization}%`}</b></div></div><div className="rounded-xl border border-slate-100 p-3 text-[9px] leading-4 text-slate-500"><div className="flex justify-between"><span>Fibre cores</span><b className="text-slate-800">{item.used_cores || 0} / {item.core_count || 0}</b></div><div className="mt-1 flex justify-between gap-3"><span>From</span><b className="truncate text-right text-slate-800">{item.start_asset_name || 'Unassigned'}</b></div><div className="mt-1 flex justify-between gap-3"><span>To</span><b className="truncate text-right text-slate-800">{item.end_asset_name || 'Unassigned'}</b></div><div className="mt-1 flex justify-between gap-3"><span>Owner</span><b className="truncate text-right text-slate-800">{item.owner || '—'}</b></div></div>{item.notes && <div className="rounded-xl bg-slate-50 p-3 text-[9px] leading-4 text-slate-500">{item.notes}</div>}</>}
  </div></aside>;
}

export default function BillingFibreGis() {
  const mapElement = useRef(null);
  const mapRef = useRef(null);
  const mapReadyRef = useRef(false);
  const modeRef = useRef('browse');
  const placementTypeRef = useRef('fat');
  const draftRef = useRef([]);
  const dataRef = useRef({ assets: [], routes: [] });
  const [data, setData] = useState({ assets: [], routes: [], routers: [], stats: {} });
  const [mapState, setMapState] = useState('loading');
  const [mapMessage, setMapMessage] = useState('Loading street map…');
  const [mapRetryKey, setMapRetryKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [mode, setMode] = useState('browse');
  const [placementType, setPlacementType] = useState('fat');
  const [draftCoordinates, setDraftCoordinates] = useState([]);
  const [selected, setSelected] = useState(null);
  const [assetModal, setAssetModal] = useState(null);
  const [routeModal, setRouteModal] = useState(null);
  const [search, setSearch] = useState('');
  const [layersOpen, setLayersOpen] = useState(true);
  const [view3d, setView3d] = useState(true);
  const [visibleAssets, setVisibleAssets] = useState(() => new Set(ASSET_TYPES.map(([key]) => key)));
  const [visibleRoutes, setVisibleRoutes] = useState(() => new Set(ROUTE_TYPES.map(([key]) => key)));

  const load = useCallback(async ({ quiet = false } = {}) => {
    try {
      if (!quiet) setLoading(true); else setRefreshing(true);
      setError('');
      const response = await api.get('/noc/fibre-gis', { params: { _: Date.now() } });
      setData(response.data || { assets: [], routes: [], routers: [], stats: {} });
    } catch (requestError) {
      setError(requestError.response?.data?.error || 'Could not load Fibre GIS.');
    } finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { dataRef.current = data; }, [data]);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { placementTypeRef.current = placementType; }, [placementType]);
  useEffect(() => { draftRef.current = draftCoordinates; }, [draftCoordinates]);

  const updateDraftSource = useCallback((coordinates) => {
    const map = mapRef.current;
    const source = map?.getSource('fibre-draft');
    if (!source) return;
    source.setData({ type: 'FeatureCollection', features: coordinates.length > 1 ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } }] : [] });
  }, []);

  useEffect(() => {
    if (!mapElement.current || mapRef.current) return undefined;
    mapReadyRef.current = false;
    setMapState('loading');
    setMapMessage('Loading street map…');
    let lastMapError = '';
    let map;

    try {
      map = new maplibregl.Map({
        container: mapElement.current,
        style: MAP_STYLE,
        center: [37.2, -0.3],
        zoom: 6.1,
        pitch: 44,
        bearing: -8,
        attributionControl: true,
        transformRequest: transformMapRequest,
      });
    } catch (error) {
      setMapState('error');
      setMapMessage(error?.message || 'The map could not start.');
      return undefined;
    }

    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric', maxWidth: 110 }), 'bottom-left');

    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => map.resize())
      : null;
    resizeObserver?.observe(mapElement.current);

    map.on('error', (event) => {
      lastMapError = event?.error?.message || lastMapError || 'Map data could not be loaded.';
    });

    const loadTimeout = setTimeout(() => {
      if (mapReadyRef.current) return;
      setMapState('error');
      setMapMessage(lastMapError || 'The street map is taking too long to load.');
    }, 12000);

    map.on('load', () => {
      mapReadyRef.current = true;
      clearTimeout(loadTimeout);
      setMapState('ready');
      setMapMessage('');
      map.resize();
      map.addSource('fibre-routes', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: 'fibre-routes-shadow', type: 'line', source: 'fibre-routes', paint: { 'line-color': '#020617', 'line-width': ['case', ['boolean', ['get', 'selected'], false], 10, 7], 'line-opacity': .12 } });
      map.addLayer({ id: 'fibre-routes-main', type: 'line', source: 'fibre-routes', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: {
        'line-color': ['case', ['==', ['get', 'status'], 'down'], '#e11d48', ['>', ['get', 'utilization'], 80], '#d97706', ['match', ['get', 'route_type'], 'feeder', '#047857', 'distribution', '#0f766e', 'drop', '#d97706', 'backhaul', '#0369a1', 'duct', '#475569', '#64748b']],
        'line-width': ['case', ['boolean', ['get', 'selected'], false], 7, ['interpolate', ['linear'], ['get', 'core_count'], 0, 2.2, 24, 3.2, 96, 4.8, 288, 6]],
        'line-opacity': ['case', ['==', ['get', 'status'], 'retired'], .35, .9],
        'line-dasharray': ['case', ['==', ['get', 'status'], 'planned'], ['literal', [2, 2]], ['==', ['get', 'status'], 'down'], ['literal', [1.2, 1.2]], ['literal', [1, 0]]],
      } });
      map.addLayer({ id: 'fibre-route-labels', type: 'symbol', source: 'fibre-routes', minzoom: 10, layout: { 'symbol-placement': 'line', 'text-field': ['get', 'label'], 'text-size': 9, 'text-allow-overlap': false }, paint: { 'text-color': '#334155', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 } });
      map.addSource('gis-assets', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: 'gis-assets-selected', type: 'circle', source: 'gis-assets', paint: { 'circle-radius': ['case', ['boolean', ['get', 'selected'], false], 15, 0], 'circle-color': 'rgba(255,255,255,.7)', 'circle-stroke-width': 2, 'circle-stroke-color': '#10b981' } });
      map.addLayer({ id: 'gis-assets-circle', type: 'circle', source: 'gis-assets', paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 5, 11, 9, 16, 12],
        'circle-color': ['case', ['==', ['get', 'status'], 'down'], '#e11d48', ['==', ['get', 'status'], 'maintenance'], '#d97706', ['==', ['get', 'status'], 'planned'], '#94a3b8', ['get', 'color']],
        'circle-stroke-width': 2, 'circle-stroke-color': '#ffffff', 'circle-opacity': .96,
      } });
      map.addLayer({ id: 'gis-assets-symbol', type: 'symbol', source: 'gis-assets', minzoom: 8, layout: { 'text-field': ['get', 'short'], 'text-size': 7, 'text-font': ['Noto Sans Bold'], 'text-allow-overlap': true }, paint: { 'text-color': '#ffffff' } });
      map.addLayer({ id: 'gis-assets-label', type: 'symbol', source: 'gis-assets', minzoom: 10, layout: { 'text-field': ['get', 'label'], 'text-size': 9, 'text-offset': [0, 1.9], 'text-anchor': 'top', 'text-optional': true }, paint: { 'text-color': '#0f172a', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 } });
      map.addSource('fibre-draft', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: 'fibre-draft', type: 'line', source: 'fibre-draft', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#10b981', 'line-width': 4, 'line-dasharray': [1.5, 1.2], 'line-opacity': .95 } });
    });
    map.on('click', (event) => {
      const currentMode = modeRef.current;
      if (currentMode === 'place-asset') {
        setAssetModal({ ...emptyAsset, asset_type: placementTypeRef.current, latitude: event.lngLat.lat.toFixed(7), longitude: event.lngLat.lng.toFixed(7) });
        setMode('browse');
        return;
      }
      if (currentMode === 'draw-route') {
        const next = [...draftRef.current, [Number(event.lngLat.lng.toFixed(7)), Number(event.lngLat.lat.toFixed(7))]];
        setDraftCoordinates(next);
        updateDraftSource(next);
        return;
      }
      const assetHits = map.queryRenderedFeatures(event.point, { layers: ['gis-assets-circle', 'gis-assets-symbol', 'gis-assets-label'] });
      if (assetHits[0]) {
        const id = Number(assetHits[0].properties.id);
        const item = dataRef.current.assets.find((asset) => Number(asset.id) === id);
        if (item) setSelected({ kind: 'asset', item });
        return;
      }
      const routeHits = map.queryRenderedFeatures(event.point, { layers: ['fibre-routes-main', 'fibre-route-labels'] });
      if (routeHits[0]) {
        const id = Number(routeHits[0].properties.id);
        const item = dataRef.current.routes.find((route) => Number(route.id) === id);
        if (item) setSelected({ kind: 'route', item });
      }
    });
    ['gis-assets-circle', 'gis-assets-symbol', 'gis-assets-label', 'fibre-routes-main', 'fibre-route-labels'].forEach((layer) => {
      map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = modeRef.current === 'browse' ? '' : 'crosshair'; });
    });
    return () => {
      clearTimeout(loadTimeout);
      resizeObserver?.disconnect();
      mapReadyRef.current = false;
      map.remove();
      mapRef.current = null;
    };
  }, [mapRetryKey, updateDraftSource]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.getCanvas().style.cursor = mode === 'browse' ? '' : 'crosshair';
  }, [mode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const update = () => {
      const selectedAssetId = selected?.kind === 'asset' ? Number(selected.item.id) : null;
      const assetFeatures = data.assets.filter((item) => visibleAssets.has(item.asset_type)).map((item) => ({ type: 'Feature', properties: { id: Number(item.id), label: item.name, short: shortType[item.asset_type] || '•', asset_type: item.asset_type, status: item.status, color: assetTypeMap[item.asset_type]?.color || '#64748b', selected: selectedAssetId === Number(item.id) }, geometry: { type: 'Point', coordinates: [Number(item.longitude), Number(item.latitude)] } }));
      const selectedRouteId = selected?.kind === 'route' ? Number(selected.item.id) : null;
      const routeFeatures = data.routes.filter((item) => visibleRoutes.has(item.route_type)).map((item) => ({ type: 'Feature', properties: { id: Number(item.id), label: `${item.name}${item.core_count ? ` · ${item.core_count}F` : ''}`, route_type: item.route_type, status: item.status, core_count: Number(item.core_count || 0), utilization: Number(item.core_count || 0) > 0 ? (Number(item.used_cores || 0) / Number(item.core_count || 1)) * 100 : 0, selected: selectedRouteId === Number(item.id) }, geometry: item.geometry }));
      map.getSource('gis-assets')?.setData({ type: 'FeatureCollection', features: assetFeatures });
      map.getSource('fibre-routes')?.setData({ type: 'FeatureCollection', features: routeFeatures });
    };
    if (map.loaded() && map.getSource('gis-assets')) update(); else map.once('load', update);
  }, [data, selected, visibleAssets, visibleRoutes]);

  const zoomTo = useCallback((selection) => {
    const map = mapRef.current;
    if (!map || !selection) return;
    setSelected(selection);
    if (selection.kind === 'asset') {
      map.flyTo({ center: [Number(selection.item.longitude), Number(selection.item.latitude)], zoom: Math.max(map.getZoom(), 14), pitch: view3d ? 44 : 0, duration: 700 });
    } else if (selection.item.geometry?.coordinates?.length) {
      const bounds = new maplibregl.LngLatBounds();
      selection.item.geometry.coordinates.forEach((coordinate) => bounds.extend(coordinate));
      map.fitBounds(bounds, { padding: 100, maxZoom: 15, duration: 700 });
    }
  }, [view3d]);

  const saveAsset = async (form) => {
    try {
      setSaving(true); setError('');
      if (assetModal?.id) await api.put(`/noc/fibre-gis/assets/${assetModal.id}`, form);
      else await api.post('/noc/fibre-gis/assets', form);
      setAssetModal(null); setNotice(assetModal?.id ? 'Infrastructure updated.' : 'Infrastructure added to the physical network.');
      await load({ quiet: true });
    } catch (requestError) { setError(requestError.response?.data?.error || 'Could not save infrastructure.'); }
    finally { setSaving(false); }
  };

  const saveRoute = async (form) => {
    try {
      setSaving(true); setError('');
      if (routeModal?.id) await api.put(`/noc/fibre-gis/routes/${routeModal.id}`, form);
      else await api.post('/noc/fibre-gis/routes', form);
      setRouteModal(null); setDraftCoordinates([]); updateDraftSource([]); setMode('browse');
      setNotice(routeModal?.id ? 'Fibre route updated.' : 'Fibre route saved.');
      await load({ quiet: true });
    } catch (requestError) { setError(requestError.response?.data?.error || 'Could not save fibre route.'); }
    finally { setSaving(false); }
  };

  const finishRoute = () => {
    if (draftCoordinates.length < 2) return;
    const start = nearestAsset(draftCoordinates[0], data.assets);
    const end = nearestAsset(draftCoordinates[draftCoordinates.length - 1], data.assets);
    setRouteModal({ ...emptyRoute, start_asset_id: start?.id || '', end_asset_id: end?.id || '', geometry: { type: 'LineString', coordinates: draftCoordinates } });
  };

  const deleteAsset = async (item) => {
    if (!window.confirm(`Delete ${item.name}?`)) return;
    try { setSaving(true); await api.delete(`/noc/fibre-gis/assets/${item.id}`); setSelected(null); setNotice('Infrastructure removed.'); await load({ quiet: true }); }
    catch (requestError) { setError(requestError.response?.data?.error || 'Could not delete infrastructure.'); }
    finally { setSaving(false); }
  };
  const deleteRoute = async (item) => {
    if (!window.confirm(`Delete fibre route ${item.name}?`)) return;
    try { setSaving(true); await api.delete(`/noc/fibre-gis/routes/${item.id}`); setSelected(null); setNotice('Fibre route removed.'); await load({ quiet: true }); }
    catch (requestError) { setError(requestError.response?.data?.error || 'Could not delete fibre route.'); }
    finally { setSaving(false); }
  };

  const syncTopology = async () => {
    try { setRefreshing(true); setError(''); const response = await api.post('/noc/fibre-gis/sync-topology'); setNotice(`${response.data?.imported || 0} mapped topology site${Number(response.data?.imported || 0) === 1 ? '' : 's'} imported.`); await load({ quiet: true }); }
    catch (requestError) { setError(requestError.response?.data?.error || 'Could not sync topology sites.'); }
    finally { setRefreshing(false); }
  };

  const exportGeoJson = () => {
    const features = [
      ...data.assets.map((item) => ({ type: 'Feature', properties: { id: item.id, kind: 'infrastructure', name: item.name, asset_type: item.asset_type, code: item.code, status: item.status, parent_asset_id: item.parent_asset_id, capacity: item.capacity, used_ports: item.used_ports, splitter_ratio: item.splitter_ratio }, geometry: { type: 'Point', coordinates: [Number(item.longitude), Number(item.latitude)] } })),
      ...data.routes.map((item) => ({ type: 'Feature', properties: { id: item.id, kind: 'fibre_route', name: item.name, route_type: item.route_type, status: item.status, core_count: item.core_count, used_cores: item.used_cores, length_m: item.length_m }, geometry: item.geometry })),
    ];
    const blob = new Blob([JSON.stringify({ type: 'FeatureCollection', features }, null, 2)], { type: 'application/geo+json' });
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `polyizon-fibre-gis-${new Date().toISOString().slice(0, 10)}.geojson`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const locateMe = () => {
    if (!navigator.geolocation) return setError('Browser GPS is not available.');
    navigator.geolocation.getCurrentPosition((position) => mapRef.current?.flyTo({ center: [position.coords.longitude, position.coords.latitude], zoom: 16, pitch: view3d ? 48 : 0, duration: 800 }), () => setError('Could not read your current GPS location.'), { enableHighAccuracy: true, timeout: 12000 });
  };

  const toggle3d = () => {
    const next = !view3d; setView3d(next); mapRef.current?.easeTo({ pitch: next ? 48 : 0, bearing: next ? -8 : 0, duration: 600 });
  };

  const searchResults = useMemo(() => {
    const query = search.trim().toLowerCase(); if (!query) return [];
    return [
      ...data.assets.filter((item) => `${item.name} ${item.code || ''} ${item.asset_type}`.toLowerCase().includes(query)).slice(0, 6).map((item) => ({ kind: 'asset', item })),
      ...data.routes.filter((item) => `${item.name} ${item.route_type}`.toLowerCase().includes(query)).slice(0, 4).map((item) => ({ kind: 'route', item })),
    ].slice(0, 8);
  }, [data, search]);

  const toggleAssetLayer = (key) => setVisibleAssets((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const toggleRouteLayer = (key) => setVisibleRoutes((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });

  if (loading) return <div className="space-y-3"><div className="h-24 animate-pulse rounded-[22px] bg-slate-200/70" /><div className="h-[620px] animate-pulse rounded-[22px] bg-slate-200/70" /></div>;

  return <div className="space-y-3">
    <section className="relative overflow-hidden rounded-[22px] bg-[#071d13] px-4 py-4 text-white shadow-lg shadow-emerald-950/10 sm:px-5"><div className="relative z-10 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"><div><div className="flex items-center gap-2"><span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-400/12 px-2 py-1 text-[8px] font-black uppercase tracking-[.15em] text-emerald-200 ring-1 ring-emerald-300/15"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />Physical network</span><span className="text-[8px] font-semibold text-emerald-100/55">MapLibre · GeoJSON</span></div><h2 className="mt-2 text-[22px] font-black tracking-[-.035em] sm:text-[25px]">Fibre GIS</h2><p className="mt-0.5 max-w-2xl text-[10px] leading-4 text-emerald-100/70">Map the real outside plant: POPs, OLTs, fibre routes, FDTs, FATs, splitters, poles, closures and customer sites.</p></div><div className="flex flex-wrap items-center gap-1.5"><button type="button" onClick={syncTopology} disabled={refreshing} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/12 bg-white/8 px-2.5 text-[8px] font-black text-white hover:bg-white/12 disabled:opacity-50"><Icon name="sync" className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />Sync Topology</button><button type="button" onClick={exportGeoJson} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/12 bg-white/8 px-2.5 text-[8px] font-black text-white hover:bg-white/12"><Icon name="download" className="h-3.5 w-3.5" />GeoJSON</button><button type="button" onClick={() => load({ quiet: true })} disabled={refreshing} className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/12 bg-white/8 text-white hover:bg-white/12"><Icon name="refresh" className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} /></button></div></div><div className="pointer-events-none absolute -right-16 -top-20 h-48 w-48 rounded-full bg-emerald-400/10 blur-3xl" /></section>

    {(error || notice) && <div className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2 text-[9px] font-semibold ${error ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}><span>{error || notice}</span><button type="button" onClick={() => { setError(''); setNotice(''); }} className="text-base leading-none">×</button></div>}

    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><Metric label="Infrastructure" value={formatNumber(data.stats?.assets)} note={`${formatNumber(data.stats?.active_assets)} active`} /><Metric label="Fibre plant" value={`${formatNumber(data.stats?.fibre_km, 2)} km`} note={`${formatNumber(data.stats?.routes)} routes`} /><Metric label="Fibre cores" value={formatNumber(data.stats?.total_cores)} note={`${formatNumber(data.stats?.used_cores)} currently used`} /><Metric label="Plant alarms" value={formatNumber(data.stats?.down_assets)} note="Infrastructure marked down" /></div>

    <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_285px]">
      <section className="overflow-hidden rounded-[20px] border border-slate-200 bg-white shadow-sm"><div className="flex flex-wrap items-center gap-1.5 border-b border-slate-100 px-2.5 py-2"><div className="relative min-w-[180px] flex-1 sm:max-w-[310px]"><Icon name="search" className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search fibre, FAT, OLT, code..." className="h-8 w-full rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-2 text-[9px] outline-none focus:border-emerald-400 focus:bg-white" />{searchResults.length > 0 && <div className="absolute left-0 right-0 top-9 z-30 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">{searchResults.map((result) => <button key={`${result.kind}-${result.item.id}`} type="button" onClick={() => { zoomTo(result); setSearch(''); }} className="flex w-full items-center gap-2 border-b border-slate-50 px-3 py-2 text-left hover:bg-slate-50"><span className="flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-50 text-[7px] font-black text-emerald-700">{result.kind === 'asset' ? shortType[result.item.asset_type] : 'F'}</span><span className="min-w-0"><b className="block truncate text-[9px] text-slate-800">{result.item.name}</b><span className="text-[7px] uppercase text-slate-400">{result.kind === 'asset' ? assetTypeMap[result.item.asset_type]?.label : routeTypeMap[result.item.route_type]?.label}</span></span></button>)}</div>}</div><button type="button" onClick={() => setLayersOpen((value) => !value)} className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[8px] font-black ${layersOpen ? 'bg-slate-900 text-white' : 'border border-slate-200 text-slate-600'}`}><Icon name="layers" className="h-3.5 w-3.5" />Layers</button><select value={placementType} onChange={(e) => setPlacementType(e.target.value)} className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-[8px] font-bold text-slate-600 outline-none">{ASSET_TYPES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><button type="button" disabled={mapState !== 'ready'} onClick={() => { setMode(mode === 'place-asset' ? 'browse' : 'place-asset'); setDraftCoordinates([]); updateDraftSource([]); }} className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[8px] font-black disabled:cursor-not-allowed disabled:opacity-40 ${mode === 'place-asset' ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-700'}`}><Icon name="plus" className="h-3.5 w-3.5" />Add</button><button type="button" disabled={mapState !== 'ready'} onClick={() => { const next = mode === 'draw-route' ? 'browse' : 'draw-route'; setMode(next); setDraftCoordinates([]); updateDraftSource([]); }} className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[8px] font-black disabled:cursor-not-allowed disabled:opacity-40 ${mode === 'draw-route' ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-700'}`}><Icon name="route" className="h-3.5 w-3.5" />Draw fibre</button><button type="button" onClick={locateMe} className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"><Icon name="gps" className="h-3.5 w-3.5" /></button><button type="button" onClick={toggle3d} className={`inline-flex h-8 items-center gap-1 rounded-lg border px-2 text-[8px] font-black ${view3d ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-500'}`}><Icon name="cube" className="h-3.5 w-3.5" />{view3d ? '3D' : '2D'}</button></div>
        <div className="relative h-[590px] sm:h-[650px]"><div ref={mapElement} className="absolute inset-0 bg-[#eef2f1]" />
          {mapState !== 'ready' && <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#f4f7f6]"><div className="mx-4 w-full max-w-[340px] rounded-[18px] border border-slate-200 bg-white p-5 text-center shadow-xl"><div className={`mx-auto flex h-11 w-11 items-center justify-center rounded-2xl ${mapState === 'error' ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600'}`}><Icon name={mapState === 'error' ? 'info' : 'map'} className={`h-5 w-5 ${mapState === 'loading' ? 'animate-pulse' : ''}`} /></div><h3 className="mt-3 text-base font-black text-slate-900">{mapState === 'error' ? 'Map could not load' : 'Loading Fibre GIS map'}</h3><p className="mx-auto mt-1 max-w-[280px] text-[9px] leading-4 text-slate-500">{mapMessage}</p>{mapState === 'error' && <button type="button" onClick={() => { setMapState('loading'); setMapMessage('Retrying street map…'); setMapRetryKey((value) => value + 1); }} className="mt-3 rounded-lg bg-emerald-600 px-3 py-2 text-[9px] font-black text-white hover:bg-emerald-700">Retry map</button>}</div></div>}
          {layersOpen && <div className="absolute left-2 top-2 z-20 max-h-[calc(100%-16px)] w-[190px] overflow-y-auto rounded-[16px] border border-white/80 bg-white/95 p-2.5 shadow-xl backdrop-blur"><div className="mb-2 flex items-center justify-between"><b className="text-[9px] text-slate-800">Network layers</b><button type="button" onClick={() => setLayersOpen(false)} className="text-slate-400"><Icon name="close" className="h-3 w-3" /></button></div><span className="text-[7px] font-black uppercase tracking-[.14em] text-slate-400">Infrastructure</span><div className="mt-1 space-y-0.5">{ASSET_TYPES.map(([key, label, color]) => { const count = data.assets.filter((item) => item.asset_type === key).length; return <button key={key} type="button" onClick={() => toggleAssetLayer(key)} className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left hover:bg-slate-50"><span className="flex h-4 w-4 items-center justify-center rounded-full border border-white text-[5px] font-black text-white shadow" style={{ backgroundColor: visibleAssets.has(key) ? color : '#cbd5e1' }}>{shortType[key]}</span><span className={`flex-1 text-[8px] font-semibold ${visibleAssets.has(key) ? 'text-slate-700' : 'text-slate-400'}`}>{label}</span><span className="text-[7px] text-slate-400">{count}</span></button>; })}</div><div className="my-2 border-t border-slate-100" /><span className="text-[7px] font-black uppercase tracking-[.14em] text-slate-400">Fibre routes</span><div className="mt-1 space-y-0.5">{ROUTE_TYPES.map(([key, label, color]) => <button key={key} type="button" onClick={() => toggleRouteLayer(key)} className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left hover:bg-slate-50"><span className="h-[3px] w-5 rounded-full" style={{ backgroundColor: visibleRoutes.has(key) ? color : '#cbd5e1' }} /><span className={`flex-1 text-[8px] font-semibold ${visibleRoutes.has(key) ? 'text-slate-700' : 'text-slate-400'}`}>{label}</span><span className="text-[7px] text-slate-400">{data.routes.filter((item) => item.route_type === key).length}</span></button>)}</div></div>}
          {mode === 'place-asset' && <div className="absolute left-1/2 top-3 z-20 -translate-x-1/2 rounded-xl border border-emerald-200 bg-white/95 px-3 py-2 text-center shadow-xl backdrop-blur"><b className="block text-[9px] text-emerald-800">Place {assetTypeMap[placementType]?.label}</b><span className="text-[7px] text-slate-500">Click its real position on the map</span><button type="button" onClick={() => setMode('browse')} className="ml-3 text-[7px] font-black text-rose-500">CANCEL</button></div>}
          {mode === 'draw-route' && <div className="absolute left-1/2 top-3 z-20 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-emerald-200 bg-white/95 p-1.5 shadow-xl backdrop-blur"><span className="px-2 text-[8px] font-bold text-slate-600">{draftCoordinates.length} points</span><button type="button" disabled={!draftCoordinates.length} onClick={() => { const next = draftCoordinates.slice(0, -1); setDraftCoordinates(next); updateDraftSource(next); }} className="flex h-7 items-center gap-1 rounded-lg bg-slate-100 px-2 text-[7px] font-black text-slate-600 disabled:opacity-40"><Icon name="undo" className="h-3 w-3" />Undo</button><button type="button" disabled={draftCoordinates.length < 2} onClick={finishRoute} className="flex h-7 items-center gap-1 rounded-lg bg-emerald-500 px-2 text-[7px] font-black text-white disabled:opacity-40"><Icon name="check" className="h-3 w-3" />Finish</button><button type="button" onClick={() => { setMode('browse'); setDraftCoordinates([]); updateDraftSource([]); }} className="h-7 rounded-lg px-2 text-[7px] font-black text-rose-500">Cancel</button></div>}
        </div></section>
      <Inspector selected={selected} assets={data.assets} onEditAsset={(item) => setAssetModal({ ...item })} onEditRoute={(item) => setRouteModal({ ...item })} onDeleteAsset={deleteAsset} onDeleteRoute={deleteRoute} />
    </div>

    {!data.assets.length && !data.routes.length && <div className="rounded-[18px] border border-dashed border-emerald-200 bg-emerald-50/50 px-4 py-4 text-center"><b className="text-[10px] text-emerald-800">Start building the physical network</b><p className="mt-1 text-[8px] leading-4 text-emerald-700/70">Use Sync Topology for already-mapped routers/POPs, or choose an infrastructure type and click Add. Then draw fibre along the real route on the map.</p></div>}

    {assetModal && <AssetModal initial={assetModal} assets={data.assets} routers={data.routers} saving={saving} onClose={() => setAssetModal(null)} onSave={saveAsset} />}
    {routeModal && <RouteModal initial={routeModal} assets={data.assets} saving={saving} onClose={() => setRouteModal(null)} onSave={saveRoute} />}
  </div>;
}

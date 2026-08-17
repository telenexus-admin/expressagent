import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  getSmoothStepPath,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import ELK from 'elkjs/lib/elk.bundled.js';
import maplibregl from '../utils/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import api from '../utils/api';

const elk = new ELK();
const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

function Icon({ name, className = 'h-4 w-4' }) {
  const paths = {
    topology: <><circle cx="5" cy="6" r="2.2" /><circle cx="19" cy="6" r="2.2" /><circle cx="12" cy="18" r="2.2" /><path d="M7 7.2 10.5 16M17 7.2 13.5 16M7.2 6h9.6" /></>,
    map: <><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z" /><path d="M9 3v15M15 6v15" /></>,
    pulse: <path d="M3 12h4l2.2-5 4.1 10 2.3-5H21" />,
    refresh: <><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></>,
    locate: <><circle cx="12" cy="12" r="3" /><circle cx="12" cy="12" r="8" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></>,
    router: <><rect x="3" y="7" width="18" height="10" rx="3" /><path d="M7 12h.01M11 12h.01M15 12h2M8 7V4m8 3V4" /></>,
    users: <><circle cx="9" cy="8" r="3" /><path d="M3.5 20a5.5 5.5 0 0 1 11 0" /><circle cx="17.5" cy="9.5" r="2.2" /><path d="M16 15.5a4.5 4.5 0 0 1 4.5 4.5" /></>,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    gps: <><path d="M12 21s6-5.1 6-11a6 6 0 1 0-12 0c0 5.9 6 11 6 11Z" /><circle cx="12" cy="10" r="2" /></>,
    cloud: <><path d="M7 18h10a4 4 0 0 0 .7-7.9A6 6 0 0 0 6.3 8.8 4.6 4.6 0 0 0 7 18Z" /></>,
    warning: <><path d="M12 3 2.8 19h18.4L12 3Z" /><path d="M12 9v4M12 17h.01" /></>,
    check: <><circle cx="12" cy="12" r="9" /><path d="m8 12 2.5 2.5L16 9" /></>,
    chevron: <path d="m9 5 7 7-7 7" />,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true" className={`${className} fill-none stroke-current`} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">{paths[name] || paths.topology}</svg>;
}

const fmt = (value, digits = 1) => Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: digits });
const statusTone = (status) => status === 'online' || status === 'up' ? '#10b981' : status === 'idle' || status === 'unknown' ? '#f59e0b' : '#ef4444';
const roleLabel = (role) => ({ core: 'CORE', edge: 'EDGE', distribution: 'DISTRIBUTION', access: 'ACCESS', olt: 'OLT', switch: 'SWITCH', ap: 'WIRELESS', discovered: 'DISCOVERED' }[role] || String(role || 'DEVICE').toUpperCase());

function Ports({ count = 8, active = 4 }) {
  return <div className="flex gap-[3px]">{Array.from({ length: count }).map((_, index) => <span key={index} className={`h-[7px] w-[10px] rounded-[2px] border ${index < active ? 'border-emerald-500/70 bg-emerald-400/60 shadow-[0_0_5px_rgba(16,185,129,.35)]' : 'border-slate-600 bg-slate-800'}`} />)}</div>;
}

function RouterNode({ data, selected }) {
  const online = data.status === 'online';
  return <div className={`relative w-[270px] rounded-[20px] border bg-white p-3 shadow-[0_15px_40px_rgba(15,23,42,.12)] transition ${selected ? 'border-emerald-400 ring-4 ring-emerald-100' : 'border-slate-200'}`}>
    <Handle type="target" position={Position.Top} className="!h-2 !w-2 !border-2 !border-white !bg-emerald-500" />
    <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex items-center gap-2"><span className="relative flex h-8 w-8 items-center justify-center rounded-xl bg-[#0c2117] text-emerald-300"><Icon name="router" className="h-4 w-4" /><i className={`absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-white ${online ? 'bg-emerald-500' : 'bg-rose-500'}`} /></span><div className="min-w-0"><b className="block truncate text-[12px] text-slate-950">{data.label}</b><span className="text-[8px] font-black uppercase tracking-[.14em] text-emerald-700">{roleLabel(data.role)}</span></div></div></div><span className="rounded-full bg-slate-100 px-2 py-1 text-[8px] font-black text-slate-500">{Math.round(Number(data.health || 0))}%</span></div>
    <div className="mt-3 rounded-xl border border-slate-700 bg-gradient-to-b from-[#202a32] to-[#0e1419] px-3 py-2 shadow-inner"><div className="mb-2 flex items-center justify-between"><span className="text-[7px] font-bold uppercase tracking-[.16em] text-slate-400">RouterOS hardware</span><span className={`h-1.5 w-1.5 rounded-full ${online ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,.8)]' : 'bg-rose-500'}`} /></div><div className="flex items-center justify-between gap-2"><Ports count={8} active={online ? Math.min(7, Math.max(2, Math.round(Number(data.wan_traffic_mbps || 0) / 40) + 2)) : 0} /><span className="rounded bg-slate-800 px-1.5 py-1 text-[7px] font-bold text-slate-300">SFP+</span></div></div>
    <div className="mt-2 grid grid-cols-3 gap-1.5"><div className="rounded-lg bg-slate-50 px-2 py-1.5"><span className="block text-[7px] font-bold uppercase text-slate-400">CPU</span><b className="text-[10px] text-slate-800">{data.cpu_load ?? '—'}%</b></div><div className="rounded-lg bg-slate-50 px-2 py-1.5"><span className="block text-[7px] font-bold uppercase text-slate-400">Sessions</span><b className="text-[10px] text-slate-800">{fmt(Number(data.active_pppoe || 0) + Number(data.active_hotspot || 0), 0)}</b></div><div className="rounded-lg bg-slate-50 px-2 py-1.5"><span className="block text-[7px] font-bold uppercase text-slate-400">WAN</span><b className="text-[10px] text-slate-800">{fmt(data.wan_traffic_mbps)}M</b></div></div>
    <Handle type="source" position={Position.Bottom} className="!h-2 !w-2 !border-2 !border-white !bg-emerald-500" />
  </div>;
}

function InternetNode({ data, selected }) {
  return <div className={`relative w-[190px] rounded-[24px] border bg-gradient-to-br from-[#071d13] via-[#0b3524] to-[#0d4a31] px-5 py-4 text-white shadow-[0_18px_45px_rgba(4,47,31,.25)] ${selected ? 'border-emerald-300 ring-4 ring-emerald-100' : 'border-emerald-900/40'}`}><div className="flex items-center gap-3"><div className="relative flex h-12 w-14 items-center justify-center"><span className="absolute left-0 top-4 h-7 w-8 rounded-full bg-emerald-300/20" /><span className="absolute right-0 top-3 h-8 w-9 rounded-full bg-emerald-300/20" /><span className="absolute left-4 top-0 h-10 w-10 rounded-full bg-white/15" /><Icon name="cloud" className="relative z-10 h-8 w-8 text-emerald-100" /></div><div><span className="text-[8px] font-black uppercase tracking-[.2em] text-emerald-200">Upstream</span><b className="mt-0.5 block text-base">{data.label}</b><span className="text-[9px] text-emerald-100/70">Transit / WAN</span></div></div><Handle type="source" position={Position.Bottom} className="!h-2 !w-2 !border-2 !border-white !bg-emerald-400" /></div>;
}

function DiscoveredNode({ data, selected }) {
  const color = data.role === 'olt' ? 'text-violet-600 bg-violet-50' : data.role === 'ap' ? 'text-sky-600 bg-sky-50' : 'text-amber-600 bg-amber-50';
  return <div className={`relative w-[220px] rounded-[18px] border bg-white p-3 shadow-[0_12px_28px_rgba(15,23,42,.09)] ${selected ? 'border-emerald-400 ring-4 ring-emerald-100' : 'border-slate-200'}`}><Handle type="target" position={Position.Top} className="!h-2 !w-2 !border-2 !border-white !bg-slate-500" /><div className="flex items-center gap-2.5"><span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${color}`}><Icon name={data.role === 'ap' ? 'pulse' : 'topology'} className="h-4 w-4" /></span><div className="min-w-0 flex-1"><b className="block truncate text-[11px] text-slate-900">{data.label}</b><span className="text-[8px] font-black uppercase tracking-[.12em] text-slate-400">{roleLabel(data.role)}</span></div><i className="h-2 w-2 rounded-full bg-emerald-500" /></div><div className="mt-2 rounded-lg bg-[#141b20] px-2.5 py-2"><div className="flex items-center justify-between"><Ports count={6} active={4} /><span className="text-[7px] text-slate-400">{data.platform || 'Neighbor'}</span></div></div><div className="mt-2 truncate text-[8px] text-slate-400">{data.address || data.mac_address || 'Discovered by RouterOS'}</div><Handle type="source" position={Position.Bottom} className="!h-2 !w-2 !border-2 !border-white !bg-slate-500" /></div>;
}

function ServiceNode({ data, selected }) {
  const hotspot = data.service === 'hotspot';
  return <div className={`relative w-[180px] rounded-[18px] border bg-white px-3 py-3 shadow-sm ${selected ? 'border-emerald-400 ring-4 ring-emerald-100' : 'border-slate-200'}`}><Handle type="target" position={Position.Top} className="!h-2 !w-2 !border-2 !border-white !bg-emerald-500" /><div className="flex items-center gap-2.5"><span className={`flex h-9 w-9 items-center justify-center rounded-full ${hotspot ? 'bg-sky-50 text-sky-600' : 'bg-emerald-50 text-emerald-600'}`}><Icon name="users" className="h-[18px] w-[18px]" /></span><div><b className="block text-lg leading-none text-slate-950">{fmt(data.count, 0)}</b><span className="mt-1 block text-[8px] font-black uppercase tracking-[.11em] text-slate-400">{data.label}</span></div></div></div>;
}

function PulseEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd }) {
  const [path, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 18 });
  const down = data?.status === 'down';
  const service = data?.kind === 'service';
  const color = down ? '#ef4444' : service ? '#94a3b8' : data?.kind === 'internet' ? '#059669' : Number(data?.traffic_mbps || 0) > 200 ? '#f59e0b' : '#10b981';
  const width = service ? 1.5 : Math.min(5, 2 + Number(data?.traffic_mbps || 0) / 250);
  return <>
    <BaseEdge id={id} path={path} markerEnd={markerEnd} style={{ stroke: color, strokeWidth: width, strokeDasharray: down ? '8 6' : service ? '5 5' : undefined, opacity: down ? .9 : .8 }} />
    {data?.livePulse && !down && !service && <circle r="3" fill={color}><animateMotion dur={`${Math.max(1.2, 3.6 - Math.min(2.2, Number(data?.traffic_mbps || 0) / 180))}s`} repeatCount="indefinite" path={path} /></circle>}
    {data?.label && <EdgeLabelRenderer><div className="nodrag nopan pointer-events-none absolute rounded-full border border-slate-200 bg-white/95 px-2 py-1 text-[7px] font-bold text-slate-500 shadow-sm" style={{ transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)` }}>{data.label}{Number(data.traffic_mbps || 0) > 0 ? ` · ${fmt(data.traffic_mbps)} Mbps` : ''}</div></EdgeLabelRenderer>}
  </>;
}

const nodeTypes = { router: RouterNode, internet: InternetNode, discovered: DiscoveredNode, service: ServiceNode };
const edgeTypes = { pulse: PulseEdge };

function nodeSize(node) {
  if (node.kind === 'internet') return { width: 190, height: 90 };
  if (node.kind === 'router') return { width: 270, height: 168 };
  if (node.kind === 'service') return { width: 180, height: 72 };
  return { width: 220, height: 118 };
}

async function layoutGraph(rawNodes, rawEdges) {
  const graph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'DOWN',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.spacing.nodeNode': '42',
      'elk.layered.spacing.nodeNodeBetweenLayers': '76',
      'elk.layered.spacing.edgeNodeBetweenLayers': '30',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
    },
    children: rawNodes.map((node) => ({ id: node.id, ...nodeSize(node) })),
    edges: rawEdges.map((edge) => ({ id: edge.id, sources: [edge.source], targets: [edge.target] })),
  };
  const result = await elk.layout(graph);
  const position = new Map((result.children || []).map((item) => [item.id, { x: item.x || 0, y: item.y || 0 }]));
  return rawNodes.map((node) => ({
    id: node.id,
    type: node.kind === 'router' ? 'router' : node.kind === 'internet' ? 'internet' : node.kind === 'service' ? 'service' : 'discovered',
    position: position.get(node.id) || { x: 0, y: 0 },
    data: node,
    draggable: true,
  }));
}

function MapCanvas({ topology, selectedId, onSelect }) {
  const elementRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  const routerNodes = useMemo(() => (topology?.nodes || []).filter((node) => node.kind === 'router' && node.latitude !== null && node.latitude !== undefined && node.latitude !== '' && node.longitude !== null && node.longitude !== undefined && node.longitude !== '' && Number.isFinite(Number(node.latitude)) && Number.isFinite(Number(node.longitude))), [topology]);

  useEffect(() => {
    if (!elementRef.current || mapRef.current) return undefined;
    mapRef.current = new maplibregl.Map({ container: elementRef.current, style: MAP_STYLE, center: [37.5, 0.2], zoom: 5.2, pitch: 38, bearing: -8, attributionControl: true });
    mapRef.current.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
    return () => { markersRef.current.forEach((marker) => marker.remove()); markersRef.current = []; mapRef.current?.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const update = () => {
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      const byId = new Map((topology?.nodes || []).map((node) => [node.id, node]));
      const features = (topology?.edges || []).map((edge) => {
        const source = byId.get(edge.source); const target = byId.get(edge.target);
        if (!source || !target || source.kind !== 'router' || target.kind !== 'router') return null;
        if ([source.latitude, source.longitude, target.latitude, target.longitude].some((value) => value === null || value === undefined || value === '' || !Number.isFinite(Number(value)))) return null;
        return { type: 'Feature', properties: { status: edge.status || 'up', traffic: Number(edge.traffic_mbps || 0) }, geometry: { type: 'LineString', coordinates: [[Number(source.longitude), Number(source.latitude)], [Number(target.longitude), Number(target.latitude)]] } };
      }).filter(Boolean);
      const collection = { type: 'FeatureCollection', features };
      if (map.getSource('nexa-links')) map.getSource('nexa-links').setData(collection);
      else {
        map.addSource('nexa-links', { type: 'geojson', data: collection });
        map.addLayer({ id: 'nexa-links-shadow', type: 'line', source: 'nexa-links', paint: { 'line-color': '#052e20', 'line-width': 7, 'line-opacity': .15 } });
        map.addLayer({ id: 'nexa-links', type: 'line', source: 'nexa-links', paint: { 'line-color': ['case', ['==', ['get', 'status'], 'down'], '#ef4444', ['>', ['get', 'traffic'], 200], '#f59e0b', '#10b981'], 'line-width': ['interpolate', ['linear'], ['get', 'traffic'], 0, 2, 500, 5], 'line-opacity': .9 } });
      }
      routerNodes.forEach((node) => {
        const el = document.createElement('button');
        el.type = 'button';
        el.title = node.label;
        el.style.cssText = `width:${selectedId === node.id ? 46 : 38}px;height:${selectedId === node.id ? 46 : 38}px;border-radius:14px;border:3px solid white;background:${node.status === 'online' ? '#0b3b29' : '#7f1d1d'};box-shadow:0 8px 22px rgba(2,6,23,.28);display:flex;align-items:center;justify-content:center;color:white;cursor:pointer;transition:.2s;`;
        el.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="7" width="18" height="10" rx="3"/><path d="M7 12h.01M11 12h.01M15 12h2M8 7V4m8 3V4"/></svg>';
        el.addEventListener('click', () => onSelect(node.id));
        const popupRoot = document.createElement('div');
        popupRoot.style.cssText = 'font-family:system-ui;padding:2px 0';
        const popupTitle = document.createElement('b');
        popupTitle.textContent = String(node.label || 'Router');
        const popupDetail = document.createElement('div');
        popupDetail.style.cssText = 'font-size:11px;color:#64748b;margin-top:3px';
        popupDetail.textContent = `${node.site_label || 'Network site'} · CPU ${node.cpu_load ?? '—'}% · ${fmt(node.wan_traffic_mbps)} Mbps`;
        popupRoot.append(popupTitle, popupDetail);
        const popup = new maplibregl.Popup({ offset: 24, closeButton: false }).setDOMContent(popupRoot);
        const marker = new maplibregl.Marker({ element: el }).setLngLat([Number(node.longitude), Number(node.latitude)]).setPopup(popup).addTo(map);
        markersRef.current.push(marker);
      });
      if (routerNodes.length) {
        const bounds = new maplibregl.LngLatBounds();
        routerNodes.forEach((node) => bounds.extend([Number(node.longitude), Number(node.latitude)]));
        map.fitBounds(bounds, { padding: 90, maxZoom: 13, duration: 700 });
      }
    };
    if (map.loaded()) update(); else map.once('load', update);
  }, [topology, routerNodes, selectedId, onSelect]);

  return <div className="relative h-[560px] overflow-hidden rounded-[22px] border border-slate-200 bg-slate-100 sm:h-[650px]"><div ref={elementRef} className="absolute inset-0" />{!routerNodes.length && <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-slate-950/10 p-6"><div className="max-w-sm rounded-2xl border border-white/70 bg-white/95 p-5 text-center shadow-2xl backdrop-blur"><span className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600"><Icon name="gps" className="h-5 w-5" /></span><b className="mt-3 block text-sm text-slate-900">Add real site coordinates</b><p className="mt-1 text-[10px] leading-4 text-slate-500">Select a router and save its latitude/longitude. The map will never invent device locations.</p></div></div>}</div>;
}

function Inspector({ node, onClose, onSaved }) {
  const [draft, setDraft] = useState({ latitude: '', longitude: '', site_label: '', role: 'access' });
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setDraft({ latitude: node?.latitude ?? '', longitude: node?.longitude ?? '', site_label: node?.site_label || '', role: node?.role || 'access' });
    setNotice(''); setError('');
  }, [node?.id]);

  if (!node) return <aside className="rounded-[22px] border border-slate-200 bg-white p-4 shadow-sm"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600"><Icon name="topology" /></span><h3 className="mt-3 text-sm font-black text-slate-900">Topology inspector</h3><p className="mt-1 text-[10px] leading-4 text-slate-500">Select a device or link endpoint to inspect live details, location and impact.</p></aside>;

  const useGps = () => {
    if (!navigator.geolocation) return setError('Browser GPS is not available on this device.');
    navigator.geolocation.getCurrentPosition((position) => {
      setDraft((current) => ({ ...current, latitude: position.coords.latitude.toFixed(6), longitude: position.coords.longitude.toFixed(6) }));
      setNotice('Current device GPS captured. Save only if you are physically at this network site.');
    }, () => setError('Could not read your current GPS location.'), { enableHighAccuracy: true, timeout: 12000 });
  };

  const save = async () => {
    if (node.kind !== 'router') return;
    try {
      setSaving(true); setError(''); setNotice('');
      await api.patch(`/noc/topology/routers/${node.router_id}/location`, draft);
      setNotice('Site location saved.');
      await onSaved?.();
    } catch (requestError) {
      setError(requestError.response?.data?.error || 'Could not save site location.');
    } finally { setSaving(false); }
  };

  return <aside className="overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-sm"><div className="flex items-start justify-between border-b border-slate-100 p-4"><div className="min-w-0"><span className="text-[8px] font-black uppercase tracking-[.16em] text-emerald-600">{node.kind === 'router' ? 'Managed device' : node.kind === 'service' ? 'Subscriber service' : node.kind === 'internet' ? 'Upstream' : 'Discovered neighbor'}</span><h3 className="mt-1 truncate text-base font-black text-slate-950">{node.label}</h3><span className="mt-1 inline-flex items-center gap-1.5 text-[9px] font-bold text-slate-400"><i className="h-2 w-2 rounded-full" style={{ background: statusTone(node.status) }} />{String(node.status || 'unknown').toUpperCase()}</span></div><button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"><Icon name="close" /></button></div>
    <div className="space-y-3 p-4">
      {node.kind === 'router' && <><div className="grid grid-cols-2 gap-2"><div className="rounded-xl bg-slate-50 p-2.5"><span className="text-[8px] font-bold uppercase text-slate-400">CPU</span><b className="mt-1 block text-sm text-slate-900">{node.cpu_load ?? '—'}%</b></div><div className="rounded-xl bg-slate-50 p-2.5"><span className="text-[8px] font-bold uppercase text-slate-400">Memory</span><b className="mt-1 block text-sm text-slate-900">{node.memory_used_percent ?? '—'}%</b></div><div className="rounded-xl bg-slate-50 p-2.5"><span className="text-[8px] font-bold uppercase text-slate-400">PPPoE</span><b className="mt-1 block text-sm text-slate-900">{fmt(node.active_pppoe, 0)}</b></div><div className="rounded-xl bg-slate-50 p-2.5"><span className="text-[8px] font-bold uppercase text-slate-400">Hotspot</span><b className="mt-1 block text-sm text-slate-900">{fmt(node.active_hotspot, 0)}</b></div></div><div className="rounded-xl border border-slate-100 p-3 text-[9px] leading-4 text-slate-500"><div className="flex justify-between gap-3"><span>RouterOS</span><b className="text-slate-800">{node.version || '—'}</b></div><div className="mt-1 flex justify-between gap-3"><span>Uptime</span><b className="truncate text-slate-800">{node.uptime || '—'}</b></div><div className="mt-1 flex justify-between gap-3"><span>WAN</span><b className="truncate text-slate-800">{node.wan_interface || '—'} {node.wan_link_speed || ''}</b></div><div className="mt-1 flex justify-between gap-3"><span>Traffic</span><b className="text-slate-800">{fmt(node.wan_traffic_mbps)} Mbps</b></div></div><div className="border-t border-slate-100 pt-3"><div className="flex items-center justify-between"><div><b className="text-[10px] text-slate-900">Physical site</b><p className="text-[8px] text-slate-400">Used by Geographic topology.</p></div><button type="button" onClick={useGps} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 text-[8px] font-black text-emerald-700"><Icon name="locate" className="h-3 w-3" />Use my GPS</button></div><label className="mt-2 block"><span className="text-[8px] font-bold uppercase text-slate-400">Site label</span><input value={draft.site_label} onChange={(event) => setDraft((current) => ({ ...current, site_label: event.target.value }))} placeholder="e.g. Kitengela POP" className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2.5 text-[10px] outline-none focus:border-emerald-400" /></label><div className="mt-2 grid grid-cols-2 gap-2"><label><span className="text-[8px] font-bold uppercase text-slate-400">Latitude</span><input value={draft.latitude} onChange={(event) => setDraft((current) => ({ ...current, latitude: event.target.value }))} placeholder="-1.2921" inputMode="decimal" className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2.5 text-[10px] outline-none focus:border-emerald-400" /></label><label><span className="text-[8px] font-bold uppercase text-slate-400">Longitude</span><input value={draft.longitude} onChange={(event) => setDraft((current) => ({ ...current, longitude: event.target.value }))} placeholder="36.8219" inputMode="decimal" className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2.5 text-[10px] outline-none focus:border-emerald-400" /></label></div><label className="mt-2 block"><span className="text-[8px] font-bold uppercase text-slate-400">Network role</span><select value={draft.role} onChange={(event) => setDraft((current) => ({ ...current, role: event.target.value }))} className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-[10px] outline-none focus:border-emerald-400"><option value="core">Core</option><option value="distribution">Distribution / POP</option><option value="access">Access</option><option value="olt">OLT</option><option value="switch">Switch</option><option value="ap">Wireless/AP</option></select></label>{notice && <p className="mt-2 rounded-lg bg-emerald-50 px-2.5 py-2 text-[8px] leading-3 text-emerald-700">{notice}</p>}{error && <p className="mt-2 rounded-lg bg-rose-50 px-2.5 py-2 text-[8px] leading-3 text-rose-700">{error}</p>}<button type="button" disabled={saving} onClick={save} className="mt-2 h-9 w-full rounded-lg bg-emerald-500 text-[9px] font-black text-white disabled:opacity-50">{saving ? 'Saving...' : 'Save site location'}</button></div></>}
      {node.kind === 'discovered' && <div className="space-y-2 text-[9px]"><div className="rounded-xl bg-slate-50 p-3"><span className="text-slate-400">Platform</span><b className="mt-1 block text-slate-900">{node.platform || roleLabel(node.role)}</b></div><div className="rounded-xl bg-slate-50 p-3"><span className="text-slate-400">Address</span><b className="mt-1 block text-slate-900">{node.address || node.mac_address || '—'}</b></div><div className="rounded-xl bg-slate-50 p-3"><span className="text-slate-400">Connected on</span><b className="mt-1 block text-slate-900">{node.local_interface || '—'} {node.remote_interface ? `→ ${node.remote_interface}` : ''}</b></div></div>}
      {node.kind === 'service' && <div className="rounded-2xl bg-emerald-50 p-4 text-center"><span className="text-[8px] font-black uppercase tracking-[.14em] text-emerald-600">Active now</span><b className="mt-1 block text-3xl text-emerald-950">{fmt(node.count, 0)}</b><span className="text-[9px] text-emerald-700">{node.label}</span></div>}
      {node.kind === 'internet' && <div className="rounded-2xl bg-slate-950 p-4 text-white"><span className="text-[8px] font-black uppercase tracking-[.14em] text-emerald-300">Network upstream</span><b className="mt-1 block text-base">Internet / Transit</b><p className="mt-1 text-[9px] leading-4 text-slate-300">WAN links from core and edge routers terminate here.</p></div>}
    </div></aside>;
}

export default function BillingTopology() {
  const [topology, setTopology] = useState(null);
  const [flowNodes, setFlowNodes] = useState([]);
  const [flowEdges, setFlowEdges] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [view, setView] = useState('logical');
  const [layer, setLayer] = useState('overview');
  const [livePulse, setLivePulse] = useState(true);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [flowInstance, setFlowInstance] = useState(null);

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setRefreshing(true);
    try {
      const { data } = await api.get('/noc/topology');
      setTopology(data || { nodes: [], edges: [], stats: {} });
      setError('');
    } catch (requestError) {
      setError(requestError.response?.data?.error || 'Network topology could not read the live network.');
    } finally { setLoading(false); if (!quiet) setRefreshing(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!livePulse) return undefined;
    const timer = window.setInterval(() => void load({ quiet: true }), 12000);
    return () => window.clearInterval(timer);
  }, [livePulse, load]);

  const visible = useMemo(() => {
    const rawNodes = topology?.nodes || [];
    const rawEdges = topology?.edges || [];
    const nodes = rawNodes.filter((node) => layer === 'physical' ? node.kind !== 'service' : layer === 'customers' ? ['internet', 'router', 'service'].includes(node.kind) : true);
    const ids = new Set(nodes.map((node) => node.id));
    const edges = rawEdges.filter((edge) => ids.has(edge.source) && ids.has(edge.target));
    return { nodes, edges };
  }, [topology, layer]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const nodes = await layoutGraph(visible.nodes, visible.edges);
        if (cancelled) return;
        setFlowNodes(nodes);
        setFlowEdges(visible.edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, type: 'pulse', data: { ...edge, livePulse }, markerEnd: undefined })));
        window.setTimeout(() => flowInstance?.fitView?.({ padding: .18, duration: 500 }), 80);
      } catch (layoutError) {
        console.error('Topology layout failed:', layoutError);
      }
    })();
    return () => { cancelled = true; };
  }, [visible, livePulse, flowInstance]);

  const selected = useMemo(() => (topology?.nodes || []).find((node) => node.id === selectedId) || null, [topology, selectedId]);
  const stats = topology?.stats || {};
  const nodeColor = (node) => node.data?.status === 'offline' ? '#ef4444' : node.type === 'internet' ? '#064e3b' : node.type === 'service' ? '#0ea5e9' : node.type === 'router' ? '#10b981' : '#f59e0b';

  if (loading) return <div className="-mx-3 -mt-3 min-h-[75vh] bg-[#f7f8fb] px-6 py-24 text-center text-xs font-bold text-slate-400 sm:-mx-8 sm:-mt-8">Building live network topology...</div>;

  return <div className="-mx-3 -mt-3 min-h-screen bg-[#f7f8fb] pb-16 sm:-mx-8 sm:-mt-8">
    <section className="relative overflow-hidden billing-network-hero bg-[#0a2417] px-5 pb-12 pt-5 text-white sm:px-8"><div className="relative z-10 flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-[9px] font-black uppercase tracking-[.2em] text-emerald-200">Network / Topology</p><h2 className="mt-1.5 text-2xl font-black tracking-tight sm:text-3xl">Network Topology</h2><p className="mt-1 max-w-xl text-[11px] leading-4 text-emerald-100 sm:text-xs">A live digital twin built from RouterOS neighbors, interfaces, traffic and real site coordinates.</p></div><div className="flex shrink-0 items-center gap-2"><button type="button" onClick={() => setLivePulse((value) => !value)} className={`hidden h-9 items-center gap-1.5 rounded-xl border px-3 text-[8px] font-black sm:flex ${livePulse ? 'border-emerald-300/40 bg-emerald-300/15 text-emerald-100' : 'border-white/20 bg-white/10 text-white'}`}><Icon name="pulse" className="h-3.5 w-3.5" />{livePulse ? 'Live pulse' : 'Paused'}</button><button type="button" disabled={refreshing} onClick={() => load()} aria-label="Refresh topology" title="Refresh topology" className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/20 bg-white/10 text-white hover:bg-white/20 disabled:opacity-50"><Icon name="refresh" className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /></button></div></div><div className="relative z-10 mt-3 flex items-center gap-2"><button type="button" onClick={() => setView('logical')} className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[9px] font-black ${view === 'logical' ? 'bg-white text-emerald-950' : 'bg-white/10 text-white'}`}><Icon name="topology" className="h-3.5 w-3.5" />Logical</button><button type="button" onClick={() => setView('geographic')} className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[9px] font-black ${view === 'geographic' ? 'bg-white text-emerald-950' : 'bg-white/10 text-white'}`}><Icon name="map" className="h-3.5 w-3.5" />Geographic</button></div><div className="pointer-events-none absolute -bottom-1 left-0 right-0 h-8"><svg viewBox="0 0 1200 180" preserveAspectRatio="none" className="h-full w-full"><path d="M0 100 C210 30 330 178 520 112 C735 36 850 170 1040 70 C1110 34 1165 55 1200 32 L1200 180 L0 180 Z" fill="#f7f8fb" /></svg></div></section>

    <div className="space-y-3 px-3 sm:px-8">
      {error && <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-[10px] font-semibold text-rose-700"><Icon name="warning" className="mt-0.5 h-3.5 w-3.5 shrink-0" />{error}</div>}
      <section className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">{[
        ['Routers', stats.routers || 0, `${stats.routers_online || 0} online`],
        ['Discovered', stats.discovered_devices || 0, 'RouterOS neighbors'],
        ['Links', stats.links || 0, 'Live connections'],
        ['Sessions', stats.active_sessions || 0, 'PPPoE + Hotspot'],
        ['Mapped sites', stats.mapped_sites || 0, 'GPS locations'],
        ['Status', stats.routers_offline ? `${stats.routers_offline} down` : 'Healthy', stats.routers_offline ? 'Needs attention' : 'No router offline'],
      ].map(([label, value, note]) => <article key={label} className="rounded-[16px] border border-slate-200 bg-white p-3 shadow-sm"><span className="text-[8px] font-black uppercase tracking-[.13em] text-slate-400">{label}</span><b className={`mt-1 block text-lg ${label === 'Status' && stats.routers_offline ? 'text-rose-600' : 'text-slate-950'}`}>{typeof value === 'number' ? fmt(value, 0) : value}</b><span className="mt-0.5 block text-[8px] text-slate-400">{note}</span></article>)}</section>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-[16px] border border-slate-200 bg-white p-2 shadow-sm"><div className="inline-flex rounded-xl bg-slate-100 p-1">{[['overview', 'Overview'], ['physical', 'Physical'], ['customers', 'Customers']].map(([key, label]) => <button key={key} type="button" onClick={() => setLayer(key)} className={`rounded-lg px-3 py-1.5 text-[9px] font-black ${layer === key ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-500'}`}>{label}</button>)}</div><div className="flex items-center gap-3 px-1 text-[8px] font-bold text-slate-400"><span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-emerald-500" />Healthy</span><span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-amber-500" />Busy / discovered</span><span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-rose-500" />Down</span></div></div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_300px]">
        <section className="overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-sm">
          {view === 'logical' ? <div className="h-[560px] sm:h-[650px]"><ReactFlow nodes={flowNodes} edges={flowEdges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onInit={setFlowInstance} onNodeClick={(_, node) => setSelectedId(node.id)} fitView minZoom={0.2} maxZoom={1.8} nodesConnectable={false} elementsSelectable panOnScroll selectionOnDrag={false} proOptions={{ hideAttribution: true }} className="bg-[#f8faf9]"><Background variant="dots" gap={20} size={1.2} color="#cbd5d1" /><MiniMap pannable zoomable nodeColor={nodeColor} maskColor="rgba(248,250,249,.76)" className="!border !border-slate-200 !bg-white" /><Controls showInteractive={false} className="!overflow-hidden !rounded-xl !border !border-slate-200 !bg-white !shadow-sm" /></ReactFlow></div> : <MapCanvas topology={topology} selectedId={selectedId} onSelect={setSelectedId} />}
        </section>
        <Inspector node={selected} onClose={() => setSelectedId('')} onSaved={() => load({ quiet: true })} />
      </div>

      <div className="flex flex-col gap-1 px-1 text-[8px] text-slate-400 sm:flex-row sm:items-center sm:justify-between"><span>{topology?.generated_at ? `Topology sampled ${new Date(topology.generated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : 'Waiting for network sample'}</span><span>Logical links are discovered from RouterOS neighbors; geographic links use saved real coordinates.</span></div>
    </div>
  </div>;
}

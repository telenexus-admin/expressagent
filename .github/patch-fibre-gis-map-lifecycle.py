from pathlib import Path

path = Path('frontend/src/pages/BillingFibreGis.jsx')
text = path.read_text()

old = """  const modeRef = useRef('browse');
  const draftRef = useRef([]);
  const dataRef = useRef({ assets: [], routes: [] });
"""
new = """  const modeRef = useRef('browse');
  const placementTypeRef = useRef('fat');
  const draftRef = useRef([]);
  const dataRef = useRef({ assets: [], routes: [] });
"""
if old not in text:
    raise SystemExit('ref marker not found')
text = text.replace(old, new, 1)

old = """  useEffect(() => { dataRef.current = data; }, [data]);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { draftRef.current = draftCoordinates; }, [draftCoordinates]);
"""
new = """  useEffect(() => { dataRef.current = data; }, [data]);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { placementTypeRef.current = placementType; }, [placementType]);
  useEffect(() => { draftRef.current = draftCoordinates; }, [draftCoordinates]);
"""
if old not in text:
    raise SystemExit('ref sync marker not found')
text = text.replace(old, new, 1)

old = """        setAssetModal({ ...emptyAsset, asset_type: placementType, latitude: event.lngLat.lat.toFixed(7), longitude: event.lngLat.lng.toFixed(7) });
"""
new = """        setAssetModal({ ...emptyAsset, asset_type: placementTypeRef.current, latitude: event.lngLat.lat.toFixed(7), longitude: event.lngLat.lng.toFixed(7) });
"""
if old not in text:
    raise SystemExit('placement marker not found')
text = text.replace(old, new, 1)

old = """  }, [placementType, updateDraftSource]);
"""
new = """  }, [updateDraftSource]);
"""
if old not in text:
    raise SystemExit('map dependency marker not found')
text = text.replace(old, new, 1)

path.write_text(text)

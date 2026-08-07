import React, {
  useEffect,
  useRef,
  useState,
} from 'react';

let leafletPromise =
  null;

const DEFAULT_CENTER = [
  -1.286389,
  36.817223,
];

function coordinate(
  value
) {
  const parsed =
    Number(value);

  return Number.isFinite(
    parsed
  )
    ? parsed
    : null;
}

function escapeHtml(
  value
) {
  return String(
    value ||
    ''
  )
    .replace(
      /&/g,
      '&amp;'
    )
    .replace(
      /</g,
      '&lt;'
    )
    .replace(
      />/g,
      '&gt;'
    )
    .replace(
      /"/g,
      '&quot;'
    )
    .replace(
      /'/g,
      '&#039;'
    );
}

function money(
  value
) {
  return `KSh ${Number(
    value ||
    0
  ).toLocaleString(
    'en-KE',
    {
      maximumFractionDigits:
        2,
    }
  )}`;
}

function ensureLeaflet() {
  if (
    typeof window ===
    'undefined'
  ) {
    return Promise.reject(
      new Error(
        'Maps require a browser'
      )
    );
  }

  if (window.L) {
    return Promise.resolve(
      window.L
    );
  }

  if (leafletPromise) {
    return leafletPromise;
  }

  leafletPromise =
    new Promise(
      (
        resolve,
        reject
      ) => {
        if (
          !document.getElementById(
            'leaflet-css'
          )
        ) {
          const stylesheet =
            document.createElement(
              'link'
            );

          stylesheet.id =
            'leaflet-css';

          stylesheet.rel =
            'stylesheet';

          stylesheet.href =
            'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';

          document.head
            .appendChild(
              stylesheet
            );
        }

        const complete =
          () => {
            if (window.L) {
              resolve(
                window.L
              );
            } else {
              leafletPromise =
                null;

              reject(
                new Error(
                  'The map library did not load'
                )
              );
            }
          };

        const fail =
          () => {
            leafletPromise =
              null;

            reject(
              new Error(
                'Could not load the map library'
              )
            );
          };

        let script =
          document.getElementById(
            'leaflet-js'
          );

        if (!script) {
          script =
            document.createElement(
              'script'
            );

          script.id =
            'leaflet-js';

          script.src =
            'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';

          script.async =
            true;

          script.addEventListener(
            'load',
            complete,
            {
              once:
                true,
            }
          );

          script.addEventListener(
            'error',
            fail,
            {
              once:
                true,
            }
          );

          document.head
            .appendChild(
              script
            );

          return;
        }

        if (window.L) {
          complete();
          return;
        }

        script.addEventListener(
          'load',
          complete,
          {
            once:
              true,
          }
        );

        script.addEventListener(
          'error',
          fail,
          {
            once:
              true,
          }
        );
      }
    );

  return leafletPromise;
}


export function AgentLocationPicker({
  latitude,
  longitude,
  onChange,
}) {
  const mapNode =
    useRef(null);

  const map =
    useRef(null);

  const marker =
    useRef(null);

  const changeHandler =
    useRef(
      onChange
    );

  const [
    status,
    setStatus,
  ] = useState(
    'loading'
  );

  const [
    locationError,
    setLocationError,
  ] = useState('');

  useEffect(
    () => {
      changeHandler.current =
        onChange;
    },
    [
      onChange,
    ]
  );

  const setPoint =
    (
      lat,
      lng,
      {
        center = true,
      } = {}
    ) => {
      if (
        !map.current ||
        !window.L
      ) {
        return;
      }

      if (
        marker.current
      ) {
        marker.current
          .setLatLng([
            lat,
            lng,
          ]);
      } else {
        marker.current =
          window.L.marker(
            [
              lat,
              lng,
            ],
            {
              draggable:
                true,
            }
          )
            .addTo(
              map.current
            );

        marker.current.on(
          'dragend',
          event => {
            const next =
              event.target
                .getLatLng();

            changeHandler.current?.({
              latitude:
                Number(
                  next.lat
                    .toFixed(
                      7
                    )
                ),

              longitude:
                Number(
                  next.lng
                    .toFixed(
                      7
                    )
                ),
            });
          }
        );
      }

      if (center) {
        map.current
          .setView(
            [
              lat,
              lng,
            ],
            Math.max(
              map.current
                .getZoom(),
              15
            )
          );
      }
    };

  useEffect(
    () => {
      let cancelled =
        false;

      ensureLeaflet()
        .then(
          L => {
            if (
              cancelled ||
              !mapNode.current
            ) {
              return;
            }

            if (
              map.current
            ) {
              map.current
                .remove();

              map.current =
                null;
            }

            const lat =
              coordinate(
                latitude
              );

            const lng =
              coordinate(
                longitude
              );

            const hasPin =
              lat !== null &&
              lng !== null;

            const center =
              hasPin
                ? [
                    lat,
                    lng,
                  ]
                : DEFAULT_CENTER;

            map.current =
              L.map(
                mapNode.current,
                {
                  zoomControl:
                    true,

                  attributionControl:
                    true,
                }
              )
                .setView(
                  center,
                  hasPin
                    ? 15
                    : 7
                );

            L.tileLayer(
              'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
              {
                maxZoom:
                  19,

                attribution:
                  '&copy; OpenStreetMap contributors',
              }
            )
              .addTo(
                map.current
              );

            if (hasPin) {
              setPoint(
                lat,
                lng,
                {
                  center:
                    false,
                }
              );
            }

            map.current.on(
              'click',
              event => {
                const nextLat =
                  Number(
                    event
                      .latlng
                      .lat
                      .toFixed(
                        7
                      )
                  );

                const nextLng =
                  Number(
                    event
                      .latlng
                      .lng
                      .toFixed(
                        7
                      )
                  );

                setPoint(
                  nextLat,
                  nextLng
                );

                changeHandler
                  .current?.({
                    latitude:
                      nextLat,

                    longitude:
                      nextLng,
                  });
              }
            );

            window.setTimeout(
              () =>
                map.current
                  ?.invalidateSize(),
              100
            );

            setStatus(
              'ready'
            );
          }
        )
        .catch(
          error => {
            if (
              cancelled
            ) {
              return;
            }

            setStatus(
              'error'
            );

            setLocationError(
              error.message ||
              'Could not load map'
            );
          }
        );

      return () => {
        cancelled =
          true;

        if (
          map.current
        ) {
          map.current
            .remove();

          map.current =
            null;
        }

        marker.current =
          null;
      };
    },
    []
  );

  const clearPin =
    () => {
      if (
        marker.current &&
        map.current
      ) {
        map.current
          .removeLayer(
            marker.current
          );

        marker.current =
          null;
      }

      changeHandler
        .current?.({
          latitude:
            null,

          longitude:
            null,
        });
    };

  const useCurrentLocation =
    () => {
      setLocationError('');

      if (
        !navigator.geolocation
      ) {
        setLocationError(
          'Location is not available on this device.'
        );

        return;
      }

      navigator.geolocation
        .getCurrentPosition(
          position => {
            const lat =
              Number(
                position
                  .coords
                  .latitude
                  .toFixed(
                    7
                  )
              );

            const lng =
              Number(
                position
                  .coords
                  .longitude
                  .toFixed(
                    7
                  )
              );

            setPoint(
              lat,
              lng
            );

            changeHandler
              .current?.({
                latitude:
                  lat,

                longitude:
                  lng,
              });
          },

          () => {
            setLocationError(
              'Could not read the device location. You can still tap the map to place the pin.'
            );
          },

          {
            enableHighAccuracy:
              true,

            timeout:
              10000,

            maximumAge:
              30000,
          }
        );
    };

  const hasPin =
    coordinate(
      latitude
    ) !== null &&
    coordinate(
      longitude
    ) !== null;

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">

        <div>
          <h4 className="text-xs font-black text-slate-800">
            Business map pin
          </h4>

          <p className="mt-1 text-[10px] text-slate-400">
            Tap the exact shop location. The pin can also be dragged.
          </p>
        </div>


        <div className="flex flex-wrap gap-2">

          <button
            type="button"
            onClick={
              useCurrentLocation
            }
            className="rounded-xl bg-violet-50 px-3 py-2 text-[10px] font-black text-violet-700"
          >
            Use my location
          </button>

          {hasPin && (
            <button
              type="button"
              onClick={
                clearPin
              }
              className="rounded-xl bg-rose-50 px-3 py-2 text-[10px] font-black text-rose-600"
            >
              Clear pin
            </button>
          )}
        </div>
      </div>


      <div className="relative">

        <div
          ref={
            mapNode
          }
          className="h-[300px] w-full bg-slate-100 sm:h-[360px]"
        />

        {status ===
        'loading' && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-slate-50 text-xs font-bold text-slate-400">
            Loading real map...
          </div>
        )}

        {status ===
        'error' && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-50 p-6 text-center text-xs font-bold text-rose-600">
            {
              locationError ||
              'Map unavailable'
            }
          </div>
        )}
      </div>


      <div className="border-t border-slate-100 px-4 py-3">

        {hasPin ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[10px] font-bold text-emerald-600">
              Business location pinned
            </span>

            <span className="font-mono text-[9px] text-slate-400">
              {Number(
                latitude
              ).toFixed(
                6
              )}
              {' , '}
              {Number(
                longitude
              ).toFixed(
                6
              )}
            </span>
          </div>
        ) : (
          <p className="text-[10px] font-bold text-amber-600">
            No location selected yet. Tap the map to place a pin.
          </p>
        )}

        {locationError &&
          status !==
            'error' && (
            <p className="mt-2 text-[10px] text-rose-500">
              {
                locationError
              }
            </p>
          )}
      </div>
    </section>
  );
}


export function AgentLocationOverview({
  agents = [],
}) {
  const mapNode =
    useRef(null);

  const map =
    useRef(null);

  const [
    status,
    setStatus,
  ] = useState(
    'loading'
  );

  const points =
    agents.filter(
      agent =>
        coordinate(
          agent.latitude
        ) !== null &&
        coordinate(
          agent.longitude
        ) !== null
    );

  useEffect(
    () => {
      let cancelled =
        false;

      ensureLeaflet()
        .then(
          L => {
            if (
              cancelled ||
              !mapNode.current
            ) {
              return;
            }

            if (
              map.current
            ) {
              map.current
                .remove();

              map.current =
                null;
            }

            map.current =
              L.map(
                mapNode.current,
                {
                  zoomControl:
                    true,
                }
              )
                .setView(
                  DEFAULT_CENTER,
                  7
                );

            L.tileLayer(
              'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
              {
                maxZoom:
                  19,

                attribution:
                  '&copy; OpenStreetMap contributors',
              }
            )
              .addTo(
                map.current
              );

            const bounds =
              [];

            points.forEach(
              agent => {
                const lat =
                  Number(
                    agent.latitude
                  );

                const lng =
                  Number(
                    agent.longitude
                  );

                const latlng =
                  [
                    lat,
                    lng,
                  ];

                bounds.push(
                  latlng
                );

                const active =
                  agent.status ===
                  'active';

                const marker =
                  L.circleMarker(
                    latlng,
                    {
                      radius:
                        9,

                      weight:
                        3,

                      color:
                        '#ffffff',

                      fillColor:
                        active
                          ? '#7c3aed'
                          : '#f43f5e',

                      fillOpacity:
                        1,
                    }
                  )
                    .addTo(
                      map.current
                    );

                const title =
                  escapeHtml(
                    agent.business_name ||
                    agent.name ||
                    'Agent'
                  );

                const owner =
                  escapeHtml(
                    agent.name ||
                    ''
                  );

                const area =
                  escapeHtml(
                    agent.business_area ||
                    agent.business_address ||
                    'Location pinned'
                  );

                marker.bindPopup(`
                  <div style="min-width:190px;font-family:system-ui,sans-serif">
                    <strong style="display:block;font-size:14px;margin-bottom:4px">
                      ${title}
                    </strong>

                    <span style="display:block;font-size:11px;color:#64748b;margin-bottom:8px">
                      ${owner}
                    </span>

                    <span style="display:block;font-size:11px;margin-bottom:4px">
                      ${area}
                    </span>

                    <span style="display:block;font-size:11px;margin-bottom:4px">
                      Wallet: ${escapeHtml(
                        money(
                          agent.voucher_balance
                        )
                      )}
                    </span>

                    <span style="display:block;font-size:11px">
                      Generated: ${escapeHtml(
                        money(
                          agent.total_generated
                        )
                      )}
                    </span>
                  </div>
                `);
              }
            );

            if (
              bounds.length >
              1
            ) {
              map.current
                .fitBounds(
                  bounds,
                  {
                    padding:
                      [
                        35,
                        35,
                      ],

                    maxZoom:
                      15,
                  }
                );
            } else if (
              bounds.length ===
              1
            ) {
              map.current
                .setView(
                  bounds[0],
                  14
                );
            }

            window.setTimeout(
              () =>
                map.current
                  ?.invalidateSize(),
              100
            );

            setStatus(
              'ready'
            );
          }
        )
        .catch(
          () => {
            if (
              !cancelled
            ) {
              setStatus(
                'error'
              );
            }
          }
        );

      return () => {
        cancelled =
          true;

        if (
          map.current
        ) {
          map.current
            .remove();

          map.current =
            null;
        }
      };
    },
    [
      agents,
    ]
  );

  const unmapped =
    Math.max(
      0,
      agents.length -
      points.length
    );

  return (
    <section className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">

      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 p-5 sm:p-6">

        <div>
          <div className="text-[10px] font-black uppercase tracking-[.17em] text-violet-600">
            Geographic coverage
          </div>

          <h3 className="mt-1 text-lg font-black text-slate-950">
            Agent business locations
          </h3>

          <p className="mt-1 text-xs leading-5 text-slate-400">
            Live visual map of your shops, salons and other network representatives.
          </p>
        </div>


        <div className="flex gap-2">

          <div className="rounded-xl bg-violet-50 px-3 py-2 text-center">
            <b className="block text-sm font-black text-violet-700">
              {
                points.length
              }
            </b>

            <small className="text-[8px] font-black uppercase text-violet-500">
              Mapped
            </small>
          </div>

          <div className="rounded-xl bg-amber-50 px-3 py-2 text-center">
            <b className="block text-sm font-black text-amber-700">
              {
                unmapped
              }
            </b>

            <small className="text-[8px] font-black uppercase text-amber-500">
              Not mapped
            </small>
          </div>
        </div>
      </div>


      <div className="relative">

        <div
          ref={
            mapNode
          }
          className="h-[330px] w-full bg-slate-100 sm:h-[430px] xl:h-[480px]"
        />

        {status ===
        'loading' && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-slate-50 text-xs font-bold text-slate-400">
            Loading agent location map...
          </div>
        )}

        {status ===
        'error' && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-50 px-6 text-center text-xs font-bold text-rose-600">
            Could not load the map tiles. Agent location data is still safely stored.
          </div>
        )}

        {status ===
          'ready' &&
          !points.length && (
            <div className="pointer-events-none absolute inset-x-4 top-4 rounded-2xl border border-violet-100 bg-white/95 p-4 shadow-sm backdrop-blur">
              <b className="block text-xs text-slate-800">
                No agents have been mapped yet
              </b>

              <span className="mt-1 block text-[10px] text-slate-400">
                Use Add agent and pin the business location. The marker will appear here automatically.
              </span>
            </div>
          )}
      </div>


      <div className="flex flex-wrap gap-4 border-t border-slate-100 px-5 py-3 text-[9px] font-bold text-slate-400">
        <span className="inline-flex items-center gap-1.5">
          <i className="h-2.5 w-2.5 rounded-full bg-violet-600" />
          Active agent
        </span>

        <span className="inline-flex items-center gap-1.5">
          <i className="h-2.5 w-2.5 rounded-full bg-rose-500" />
          Suspended agent
        </span>

        <span>
          Click a marker for business statistics.
        </span>
      </div>
    </section>
  );
}

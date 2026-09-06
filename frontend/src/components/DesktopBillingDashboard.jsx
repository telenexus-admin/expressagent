import React, {
  useEffect,
  useMemo,
  useState,
} from 'react';

import api from '../utils/api';


const TRAFFIC_RANGES = [
  ['1h', '1H'],
  ['6h', '6H'],
  ['24h', '24H'],
];


function formatNumber(value) {
  return Number(
    value || 0
  ).toLocaleString();
}


function formatMbps(value) {
  const amount =
    Number(value || 0);

  if (amount >= 1000) {
    return `${(
      amount / 1000
    ).toFixed(2)} Gbps`;
  }

  return `${amount.toFixed(
    amount >= 100
      ? 0
      : 1
  )} Mbps`;
}


function formatMoney(
  value,
  money
) {
  if (typeof money === 'function') {
    return money(value);
  }

  return `KSh ${Number(
    value || 0
  ).toLocaleString()}`;
}


function timeLabel(value) {
  if (!value) {
    return '';
  }

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return '';
  }

  return date
    .toLocaleTimeString(
      [],
      {
        hour: '2-digit',
        minute: '2-digit',
      }
    );
}


function dateTimeLabel(value) {
  if (!value) {
    return 'Not synced yet';
  }

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return 'Not synced yet';
  }

  return date.toLocaleString(
    [],
    {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }
  );
}


function routerOnline(router) {
  if (
    router?.is_active ===
    false
  ) {
    return false;
  }

  const status =
    String(
      router?.last_status ||
      router?.status ||
      ''
    )
      .trim()
      .toLowerCase();

  return [
    'online',
    'active',
  ].includes(status);
}


function sampleSeries(
  values,
  maximum = 180
) {
  if (
    !Array.isArray(values) ||
    values.length <= maximum
  ) {
    return Array.isArray(values)
      ? values
      : [];
  }

  const last =
    values.length - 1;

  return Array.from(
    {
      length: maximum,
    },
    (_, index) => {
      const position =
        Math.round(
          (
            index /
            (
              maximum -
              1
            )
          ) *
          last
        );

      return values[position];
    }
  );
}


function smoothPath(points) {
  if (!points.length) {
    return '';
  }

  if (
    points.length === 1
  ) {
    return `M ${points[0].x} ${points[0].y}`;
  }

  let path =
    `M ${points[0].x} ${points[0].y}`;

  for (
    let index = 0;
    index <
      points.length - 1;
    index += 1
  ) {
    const p0 =
      points[index - 1] ||
      points[index];

    const p1 =
      points[index];

    const p2 =
      points[index + 1];

    const p3 =
      points[index + 2] ||
      p2;

    const cp1x =
      p1.x +
      (
        p2.x -
        p0.x
      ) / 6;

    const cp1y =
      p1.y +
      (
        p2.y -
        p0.y
      ) / 6;

    const cp2x =
      p2.x -
      (
        p3.x -
        p1.x
      ) / 6;

    const cp2y =
      p2.y -
      (
        p3.y -
        p1.y
      ) / 6;

    path +=
      ` C ${cp1x} ${cp1y},` +
      ` ${cp2x} ${cp2y},` +
      ` ${p2.x} ${p2.y}`;
  }

  return path;
}


function DashboardIcon({
  kind,
}) {
  const paths = {
    users: (
      <>
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
      </>
    ),

    online: (
      <>
        <path d="M5 12.55a11 11 0 0 1 14.08 0" />
        <path d="M1.42 9a16 16 0 0 1 21.16 0" />
        <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
        <circle cx="12" cy="20" r="1" />
      </>
    ),

    wallet: (
      <>
        <path d="M4 7h15a2 2 0 0 1 2 2v10H5a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3h12" />
        <path d="M16 12h6v4h-6a2 2 0 1 1 0-4Z" />
      </>
    ),

    router: (
      <>
        <rect x="3" y="8" width="18" height="10" rx="2" />
        <path d="M7 13h.01M11 13h.01M15 13h2M12 8V4M9 4h6" />
      </>
    ),

    pulse: (
      <path d="M3 12h4l2-7 4 14 2-7h6" />
    ),

    arrow: (
      <path d="m9 18 6-6-6-6" />
    ),
  };

  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-5 w-5 fill-none stroke-current"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[kind] ||
        paths.pulse}
    </svg>
  );
}


function KpiCard({
  label,
  value,
  detail,
  icon,
  darkMode,
  tone = 'slate',
}) {
  const toneClass = {
    emerald:
      'bg-emerald-50 text-emerald-700',
    indigo:
      'bg-indigo-50 text-indigo-700',
    amber:
      'bg-amber-50 text-amber-700',
    slate:
      'bg-slate-100 text-slate-700',
  }[tone];

  return (
    <article
      className={
        darkMode
          ? 'rounded-[20px] border border-slate-800 bg-[#151a2d] p-4 shadow-sm'
          : 'rounded-[20px] border border-slate-200/80 bg-white p-4 shadow-[0_6px_24px_rgba(15,23,42,.04)]'
      }
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p
            className={
              darkMode
                ? 'text-[11px] font-semibold uppercase tracking-[.13em] text-slate-500'
                : 'text-[11px] font-semibold uppercase tracking-[.13em] text-slate-400'
            }
          >
            {label}
          </p>

          <p
            className={
              darkMode
                ? 'mt-2.5 text-[26px] font-bold tracking-[-.045em] text-white'
                : 'mt-2.5 text-[26px] font-bold tracking-[-.045em] text-slate-950'
            }
          >
            {value}
          </p>

          <p
            className={
              darkMode
                ? 'mt-1 text-xs text-slate-500'
                : 'mt-1 text-xs text-slate-400'
            }
          >
            {detail}
          </p>
        </div>

        <span
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${toneClass}`}
        >
          <DashboardIcon
            kind={icon}
          />
        </span>
      </div>
    </article>
  );
}


function TrafficChart({
  values,
  darkMode,
}) {
  const [
    hoverIndex,
    setHoverIndex,
  ] = useState(null);

  const width = 900;
  const height = 205;

  const padding = {
    left: 48,
    right: 18,
    top: 18,
    bottom: 40,
  };

  const data =
    useMemo(
      () =>
        sampleSeries(
          values,
          180
        ),
      [values]
    );

  const maximum =
    Math.max(
      1,
      ...data.map(
        item =>
          Math.max(
            Number(
              item.download_mbps ||
              0
            ),
            Number(
              item.upload_mbps ||
              0
            )
          )
      )
    ) * 1.12;

  const innerWidth =
    width -
    padding.left -
    padding.right;

  const innerHeight =
    height -
    padding.top -
    padding.bottom;

  const xAt =
    index =>
      padding.left +
      (
        data.length <= 1
          ? 0
          : (
              index /
              (
                data.length -
                1
              )
            ) *
            innerWidth
      );

  const yAt =
    value =>
      padding.top +
      innerHeight -
      (
        Math.max(
          0,
          Number(value || 0)
        ) /
        maximum
      ) *
      innerHeight;

  const downloadPoints =
    data.map(
      (
        item,
        index
      ) => ({
        x:
          xAt(index),

        y:
          yAt(
            item.download_mbps
          ),
      })
    );

  const uploadPoints =
    data.map(
      (
        item,
        index
      ) => ({
        x:
          xAt(index),

        y:
          yAt(
            item.upload_mbps
          ),
      })
    );

  const downloadPath =
    smoothPath(
      downloadPoints
    );

  const uploadPath =
    smoothPath(
      uploadPoints
    );

  const bottom =
    padding.top +
    innerHeight;

  const downloadArea =
    downloadPoints.length
      ? `${downloadPath} L ${
          downloadPoints[
            downloadPoints.length -
            1
          ].x
        } ${bottom} L ${
          downloadPoints[0].x
        } ${bottom} Z`
      : '';

  const uploadArea =
    uploadPoints.length
      ? `${uploadPath} L ${
          uploadPoints[
            uploadPoints.length -
            1
          ].x
        } ${bottom} L ${
          uploadPoints[0].x
        } ${bottom} Z`
      : '';

  const yTicks =
    [0, 0.25, 0.5, 0.75, 1];

  const xIndexes =
    data.length
      ? [
          0,
          Math.round(
            (
              data.length -
              1
            ) * 0.25
          ),
          Math.round(
            (
              data.length -
              1
            ) * 0.5
          ),
          Math.round(
            (
              data.length -
              1
            ) * 0.75
          ),
          data.length - 1,
        ]
          .filter(
            (
              value,
              index,
              array
            ) =>
              array.indexOf(
                value
              ) === index
          )
      : [];

  const hovered =
    hoverIndex === null
      ? null
      : data[hoverIndex];

  const onMouseMove =
    event => {
      if (!data.length) {
        return;
      }

      const rect =
        event.currentTarget
          .getBoundingClientRect();

      const position =
        (
          event.clientX -
          rect.left
        ) /
        rect.width *
        width;

      const normalized =
        Math.max(
          0,
          Math.min(
            1,
            (
              position -
              padding.left
            ) /
            innerWidth
          )
        );

      setHoverIndex(
        Math.round(
          normalized *
          (
            data.length -
            1
          )
        )
      );
    };

  if (!data.length) {
    return (
      <div
        className={
          darkMode
            ? 'flex h-[205px] items-center justify-center rounded-2xl bg-white/[.025] text-sm text-slate-500'
            : 'flex h-[205px] items-center justify-center rounded-2xl bg-slate-50 text-sm text-slate-400'
        }
      >
        Waiting for network telemetry…
      </div>
    );
  }

  const hoverX =
    hoverIndex === null
      ? null
      : xAt(
          hoverIndex
        );

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-[205px] w-full select-none overflow-visible"
        preserveAspectRatio="none"
        onMouseMove={
          onMouseMove
        }
        onMouseLeave={
          () =>
            setHoverIndex(
              null
            )
        }
      >
        <defs>
          <linearGradient
            id="polyizon-download-area"
            x1="0"
            x2="0"
            y1="0"
            y2="1"
          >
            <stop
              offset="0%"
              stopColor="#10b981"
              stopOpacity=".22"
            />
            <stop
              offset="100%"
              stopColor="#10b981"
              stopOpacity="0"
            />
          </linearGradient>

          <linearGradient
            id="polyizon-upload-area"
            x1="0"
            x2="0"
            y1="0"
            y2="1"
          >
            <stop
              offset="0%"
              stopColor="#6366f1"
              stopOpacity=".16"
            />
            <stop
              offset="100%"
              stopColor="#6366f1"
              stopOpacity="0"
            />
          </linearGradient>
        </defs>

        {yTicks.map(
          fraction => {
            const y =
              padding.top +
              innerHeight -
              fraction *
              innerHeight;

            const value =
              maximum *
              fraction;

            return (
              <g
                key={
                  fraction
                }
              >
                <line
                  x1={
                    padding.left
                  }
                  x2={
                    width -
                    padding.right
                  }
                  y1={y}
                  y2={y}
                  stroke={
                    darkMode
                      ? '#263047'
                      : '#e8edf4'
                  }
                  strokeWidth="1"
                  vectorEffect="non-scaling-stroke"
                />

                <text
                  x={
                    padding.left -
                    10
                  }
                  y={
                    y + 4
                  }
                  textAnchor="end"
                  fontSize="11"
                  fill={
                    darkMode
                      ? '#64748b'
                      : '#94a3b8'
                  }
                >
                  {value >= 1000
                    ? `${(
                        value /
                        1000
                      ).toFixed(
                        1
                      )}G`
                    : Math.round(
                        value
                      )}
                </text>
              </g>
            );
          }
        )}

        {xIndexes.map(
          index => (
            <text
              key={index}
              x={xAt(index)}
              y={
                height - 11
              }
              textAnchor={
                index === 0
                  ? 'start'
                  : index ===
                      data.length -
                      1
                    ? 'end'
                    : 'middle'
              }
              fontSize="11"
              fill={
                darkMode
                  ? '#64748b'
                  : '#94a3b8'
              }
            >
              {timeLabel(
                data[index]
                  ?.timestamp
              )}
            </text>
          )
        )}

        <path
          d={downloadArea}
          fill="url(#polyizon-download-area)"
        />

        <path
          d={uploadArea}
          fill="url(#polyizon-upload-area)"
        />

        <path
          d={downloadPath}
          fill="none"
          stroke="#10b981"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />

        <path
          d={uploadPath}
          fill="none"
          stroke="#6366f1"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />

        {hoverIndex !==
          null && (
          <>
            <line
              x1={hoverX}
              x2={hoverX}
              y1={
                padding.top
              }
              y2={bottom}
              stroke={
                darkMode
                  ? '#64748b'
                  : '#cbd5e1'
              }
              strokeDasharray="4 5"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />

            <circle
              cx={hoverX}
              cy={yAt(
                hovered
                  ?.download_mbps
              )}
              r="5"
              fill="#10b981"
              stroke={
                darkMode
                  ? '#151a2d'
                  : '#ffffff'
              }
              strokeWidth="3"
              vectorEffect="non-scaling-stroke"
            />

            <circle
              cx={hoverX}
              cy={yAt(
                hovered
                  ?.upload_mbps
              )}
              r="5"
              fill="#6366f1"
              stroke={
                darkMode
                  ? '#151a2d'
                  : '#ffffff'
              }
              strokeWidth="3"
              vectorEffect="non-scaling-stroke"
            />
          </>
        )}
      </svg>

      {hovered && (
        <div
          className={
            darkMode
              ? 'pointer-events-none absolute right-4 top-4 rounded-xl border border-slate-700 bg-[#101524]/95 px-3 py-2 text-xs shadow-xl'
              : 'pointer-events-none absolute right-4 top-4 rounded-xl border border-slate-200 bg-white/95 px-3 py-2 text-xs shadow-xl'
          }
        >
          <div
            className={
              darkMode
                ? 'font-semibold text-slate-300'
                : 'font-semibold text-slate-700'
            }
          >
            {timeLabel(
              hovered.timestamp
            )}
          </div>

          <div className="mt-1.5 flex items-center gap-2 text-emerald-500">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            Download
            <b>
              {formatMbps(
                hovered.download_mbps
              )}
            </b>
          </div>

          <div className="mt-1 flex items-center gap-2 text-indigo-500">
            <span className="h-2 w-2 rounded-full bg-indigo-500" />
            Upload
            <b>
              {formatMbps(
                hovered.upload_mbps
              )}
            </b>
          </div>
        </div>
      )}
    </div>
  );
}


function ClientTrendChart({
  values,
  darkMode,
}) {
  const data = useMemo(() => sampleSeries(values, 18), [values]);
  const maximum = Math.max(1, ...data.map((item) => Math.max(Number(item.pppoe_count || 0), Number(item.hotspot_count || 0))));

  if (!data.length) {
    return <div className={darkMode ? 'flex h-[138px] items-center justify-center rounded-2xl bg-white/[.025] text-xs text-slate-500' : 'flex h-[138px] items-center justify-center rounded-2xl bg-slate-50 text-xs text-slate-400'}>Waiting for client session snapshots…</div>;
  }

  return <div>
    <div className="flex h-[138px] items-end gap-1.5 px-1">
      {data.map((item, index) => {
        const pppoe = Number(item.pppoe_count || 0);
        const hotspot = Number(item.hotspot_count || 0);
        return <div key={`${item.timestamp || index}-${index}`} className="group relative flex min-w-0 flex-1 items-end justify-center gap-1" title={`${timeLabel(item.timestamp)} · PPPoE ${pppoe} · Hotspot ${hotspot}`}>
          <span className="w-full max-w-[12px] rounded-t-md bg-indigo-500/90 transition group-hover:bg-indigo-400" style={{ height: `${Math.max(4, (pppoe / maximum) * 100)}%` }} />
          <span className="w-full max-w-[12px] rounded-t-md bg-emerald-500/90 transition group-hover:bg-emerald-400" style={{ height: `${Math.max(4, (hotspot / maximum) * 100)}%` }} />
        </div>;
      })}
    </div>
    <div className={`mt-2 flex justify-between text-[10px] ${darkMode ? 'text-slate-500' : 'text-slate-400'}`}><span>{timeLabel(data[0]?.timestamp)}</span><span>Live sessions</span><span>{timeLabel(data[data.length - 1]?.timestamp)}</span></div>
  </div>;
}

function HealthRow({
  label,
  value,
  status = 'good',
  darkMode,
}) {
  const dot =
    status === 'bad'
      ? 'bg-rose-500'
      : status ===
          'warn'
        ? 'bg-amber-500'
        : 'bg-emerald-500';

  return (
    <div
      className={
        darkMode
          ? 'flex items-center justify-between border-b border-slate-800 py-3.5 last:border-0'
          : 'flex items-center justify-between border-b border-slate-100 py-3.5 last:border-0'
      }
    >
      <div className="flex items-center gap-2.5">
        <span
          className={`h-2 w-2 rounded-full ${dot}`}
        />

        <span
          className={
            darkMode
              ? 'text-sm text-slate-400'
              : 'text-sm text-slate-500'
          }
        >
          {label}
        </span>
      </div>

      <strong
        className={
          darkMode
            ? 'text-sm font-semibold text-slate-200'
            : 'text-sm font-semibold text-slate-800'
        }
      >
        {value}
      </strong>
    </div>
  );
}


export default function DesktopBillingDashboard({
  summary,
  bandwidthHistory = [],
  bandwidthTick = 0,
  active = 0,
  setTab,
  money,
  routers = [],
  radiusStatus,
  darkMode = false,
}) {
  const [
    trafficRange,
    setTrafficRange,
  ] = useState('24h');

  const [
    traffic,
    setTraffic,
  ] = useState(
    Array.isArray(
      bandwidthHistory
    )
      ? bandwidthHistory
      : []
  );

  const [
    noc,
    setNoc,
  ] = useState(null);

  const [
    trafficLoading,
    setTrafficLoading,
  ] = useState(false);


  useEffect(
    () => {
      if (
        trafficRange ===
          '24h' &&
        Array.isArray(
          bandwidthHistory
        ) &&
        bandwidthHistory.length
      ) {
        setTraffic(
          bandwidthHistory
        );
      }
    },
    [
      bandwidthHistory,
      bandwidthTick,
      trafficRange,
    ]
  );


  useEffect(
    () => {
      let alive = true;

      const loadTraffic =
        async (
          silent = false
        ) => {
          if (!silent) {
            setTrafficLoading(
              true
            );
          }

          try {
            const result =
              await api.get(
                `/noc/traffic/history?range=${trafficRange}`
              );

            if (
              alive &&
              Array.isArray(
                result.data
              )
            ) {
              setTraffic(
                result.data
              );
            }
          } catch (_) {
            // Preserve the previous
            // confirmed graph.
          } finally {
            if (
              alive &&
              !silent
            ) {
              setTrafficLoading(
                false
              );
            }
          }
        };

      void loadTraffic();

      const timer =
        window.setInterval(
          () =>
            void loadTraffic(
              true
            ),
          15000
        );

      return () => {
        alive = false;

        window.clearInterval(
          timer
        );
      };
    },
    [trafficRange]
  );


  useEffect(
    () => {
      let alive = true;

      const loadNoc =
        async () => {
          try {
            const result =
              await api.get(
                '/noc/overview'
              );

            if (alive) {
              setNoc(
                result.data ||
                null
              );
            }
          } catch (_) {
            // Keep previous live state.
          }
        };

      void loadNoc();

      const timer =
        window.setInterval(
          () =>
            void loadNoc(),
          5000
        );

      return () => {
        alive = false;

        window.clearInterval(
          timer
        );
      };
    },
    []
  );


  const latest =
    traffic[
      traffic.length - 1
    ] || {};

  const peak =
    traffic.reduce(
      (
        maximum,
        item
      ) =>
        Math.max(
          maximum,
          Number(
            item.download_mbps ||
            0
          ) +
          Number(
            item.upload_mbps ||
            0
          )
        ),
      0
    );

  const average =
    traffic.length
      ? traffic.reduce(
          (
            total,
            item
          ) =>
            total +
            Number(
              item.download_mbps ||
              0
            ) +
            Number(
              item.upload_mbps ||
              0
            ),
          0
        ) /
        traffic.length
      : 0;

  const routersOnline =
    routers.filter(
      routerOnline
    ).length;

  const totalRouters =
    routers.length;

  const totalSubscribers =
    Number(
      summary?.subscribers
        ?.total ||
      0
    );

  const onlineSubscribers =
    Number(
      summary?.subscribers
        ?.active ??
      active ??
      0
    );

  const onlinePercent =
    totalSubscribers
      ? Math.round(
          (
            onlineSubscribers /
            totalSubscribers
          ) *
          100
        )
      : 0;

  const health =
    Number(
      noc?.router_health_percent ||
      noc?.health_percent ||
      0
    );

  const healthStatus =
    health >= 90
      ? 'Healthy'
      : health >= 70
        ? 'Watch'
        : health > 0
          ? 'Attention'
          : routersOnline
            ? 'Online'
            : 'Checking';

  const wanStatus =
    String(
      noc?.wan_status ||
      'unknown'
    )
      .trim()
      .toLowerCase();

  const radiusHealthy =
    radiusStatus
      ? (
          radiusStatus.enabled !==
            false &&
          ![
            'failed',
            'error',
            'offline',
          ].includes(
            String(
              radiusStatus.status ||
              ''
            ).toLowerCase()
          )
        )
      : true;

  const topUsers =
    useMemo(
      () =>
        (
          Array.isArray(
            noc?.top_users
          )
            ? noc.top_users
            : []
        )
          .filter(
            user =>
              !user.disabled
          )
          .sort(
            (
              left,
              right
            ) =>
              Number(
                right.total_mbps ||
                0
              ) -
              Number(
                left.total_mbps ||
                0
              )
          )
          .slice(0, 6),
      [noc]
    );

  const maximumUser =
    Math.max(
      1,
      ...topUsers.map(
        user =>
          Number(
            user.total_mbps ||
            0
          )
      )
    );

  const recentPayments =
    Array.isArray(
      summary?.recent_payments
    )
      ? summary.recent_payments
          .slice(
            0,
            6
          )
      : [];

  const card =
    darkMode
      ? 'border-slate-800 bg-[#151a2d]'
      : 'border-slate-200/80 bg-white';

  const muted =
    darkMode
      ? 'text-slate-500'
      : 'text-slate-400';

  const heading =
    darkMode
      ? 'text-white'
      : 'text-slate-950';

  return (
    <div className="-mx-1.5 -mt-1.5 space-y-3 pb-5">

      <section className="grid grid-cols-4 gap-3">

        <KpiCard
          label="Subscribers"
          value={
            formatNumber(
              totalSubscribers
            )
          }
          detail={
            `${formatNumber(
              summary
                ?.subscribers
                ?.pppoe
            )} PPPoE · ${formatNumber(
              summary
                ?.subscribers
                ?.hotspot
            )} Hotspot`
          }
          icon="users"
          tone="indigo"
          darkMode={
            darkMode
          }
        />

        <KpiCard
          label="Online now"
          value={
            formatNumber(
              onlineSubscribers
            )
          }
          detail={
            `${onlinePercent}% of known subscribers`
          }
          icon="online"
          tone="emerald"
          darkMode={
            darkMode
          }
        />

        <KpiCard
          label="Collections"
          value={
            formatMoney(
              summary
                ?.payments
                ?.total,
              money
            )
          }
          detail="Current month"
          icon="wallet"
          tone="amber"
          darkMode={
            darkMode
          }
        />

        <KpiCard
          label="Routers"
          value={
            `${routersOnline}/${totalRouters}`
          }
          detail={
            totalRouters
              ? 'Confirmed online'
              : 'No routers registered'
          }
          icon="router"
          tone="slate"
          darkMode={
            darkMode
          }
        />

      </section>


      <section className="grid grid-cols-[minmax(0,1.75fr)_minmax(280px,.65fr)] gap-3">

        <article
          className={`rounded-[20px] border p-4 shadow-[0_6px_24px_rgba(15,23,42,.035)] ${card}`}
        >
          <div className="flex items-start justify-between gap-5">

            <div>
              <div className="flex items-center gap-2">
                <h3
                  className={`text-base font-semibold tracking-[-.02em] ${heading}`}
                >
                  Network traffic
                </h3>

                {trafficLoading && (
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                )}
              </div>

              <p
                className={`mt-1 text-xs ${muted}`}
              >
                Smooth live download and upload
                curves from MikroTik NOC snapshots.
              </p>
            </div>

            <div
              className={
                darkMode
                  ? 'flex rounded-xl bg-white/[.04] p-1'
                  : 'flex rounded-xl bg-slate-100 p-1'
              }
            >
              {TRAFFIC_RANGES.map(
                ([
                  value,
                  label,
                ]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={
                      () =>
                        setTrafficRange(
                          value
                        )
                    }
                    className={`rounded-lg px-3 py-1.5 text-[11px] font-semibold transition ${
                      trafficRange ===
                      value
                        ? darkMode
                          ? 'bg-slate-700 text-white shadow-sm'
                          : 'bg-white text-slate-900 shadow-sm'
                        : darkMode
                          ? 'text-slate-500 hover:text-slate-300'
                          : 'text-slate-400 hover:text-slate-700'
                    }`}
                  >
                    {label}
                  </button>
                )
              )}
            </div>

          </div>


          <div className="mt-4 grid grid-cols-4 gap-2.5">

            {[
              [
                'Download',
                formatMbps(
                  latest.download_mbps
                ),
                'bg-emerald-500',
              ],

              [
                'Upload',
                formatMbps(
                  latest.upload_mbps
                ),
                'bg-indigo-500',
              ],

              [
                'Peak',
                formatMbps(
                  peak
                ),
                'bg-slate-800',
              ],

              [
                'Average',
                formatMbps(
                  average
                ),
                'bg-amber-500',
              ],
            ].map(
              ([
                label,
                value,
                dot,
              ]) => (
                <div
                  key={label}
                  className={
                    darkMode
                      ? 'rounded-xl bg-white/[.035] px-3 py-2.5'
                      : 'rounded-xl bg-slate-50 px-3 py-2.5'
                  }
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-2 w-2 rounded-full ${dot}`}
                    />

                    <span
                      className={`text-[10px] font-semibold uppercase tracking-[.1em] ${muted}`}
                    >
                      {label}
                    </span>
                  </div>

                  <strong
                    className={`mt-2 block text-[15px] font-semibold ${heading}`}
                  >
                    {value}
                  </strong>
                </div>
              )
            )}

          </div>


          <div className="mt-2">
            <TrafficChart
              values={traffic}
              darkMode={
                darkMode
              }
            />
          </div>


          <div className="mt-2 flex items-center gap-5 text-[11px]">

            <span className="flex items-center gap-2 text-slate-500">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
              Download
            </span>

            <span className="flex items-center gap-2 text-slate-500">
              <span className="h-2.5 w-2.5 rounded-full bg-indigo-500" />
              Upload
            </span>

            <span
              className={`ml-auto ${muted}`}
            >
              Hover over the curve for details
            </span>

          </div>
        </article>


        <article
          className={`rounded-[20px] border p-4 shadow-[0_6px_24px_rgba(15,23,42,.035)] ${card}`}
        >
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[.14em] text-emerald-600">
              Live health
            </p>

            <div className="mt-2 flex items-end justify-between gap-3">
              <div>
                <h3
                  className={`text-xl font-semibold tracking-[-.035em] ${heading}`}
                >
                  {healthStatus}
                </h3>

                <p
                  className={`mt-1 text-xs ${muted}`}
                >
                  Current network condition
                </p>
              </div>

              {health > 0 && (
                <strong className="text-2xl font-semibold tracking-[-.04em] text-emerald-600">
                  {Math.round(
                    health
                  )}%
                </strong>
              )}
            </div>
          </div>


          <div className="mt-5">

            <HealthRow
              label="Routers"
              value={`${routersOnline}/${totalRouters} online`}
              status={
                totalRouters &&
                routersOnline <
                  totalRouters
                  ? 'warn'
                  : 'good'
              }
              darkMode={
                darkMode
              }
            />

            <HealthRow
              label="RADIUS"
              value={
                radiusHealthy
                  ? 'Healthy'
                  : 'Attention'
              }
              status={
                radiusHealthy
                  ? 'good'
                  : 'bad'
              }
              darkMode={
                darkMode
              }
            />

            <HealthRow
              label="WAN"
              value={
                wanStatus ===
                'stable'
                  ? 'Stable'
                  : wanStatus ===
                      'down'
                    ? 'Down'
                    : 'Checking'
              }
              status={
                wanStatus ===
                  'down'
                  ? 'bad'
                  : wanStatus ===
                      'stable'
                    ? 'good'
                    : 'warn'
              }
              darkMode={
                darkMode
              }
            />

            <HealthRow
              label="CPU"
              value={
                noc?.cpu_load ===
                  null ||
                noc?.cpu_load ===
                  undefined
                  ? '—'
                  : `${Number(
                      noc.cpu_load
                    ).toFixed(
                      0
                    )}%`
              }
              status={
                Number(
                  noc?.cpu_load ||
                  0
                ) >= 80
                  ? 'bad'
                  : Number(
                      noc?.cpu_load ||
                      0
                    ) >= 65
                    ? 'warn'
                    : 'good'
              }
              darkMode={
                darkMode
              }
            />

            <HealthRow
              label="Memory"
              value={
                noc
                  ?.memory_used_percent ===
                  null ||
                noc
                  ?.memory_used_percent ===
                  undefined
                  ? '—'
                  : `${Number(
                      noc
                        .memory_used_percent
                    ).toFixed(
                      0
                    )}%`
              }
              status={
                Number(
                  noc
                    ?.memory_used_percent ||
                  0
                ) >= 85
                  ? 'bad'
                  : Number(
                      noc
                        ?.memory_used_percent ||
                      0
                    ) >= 70
                    ? 'warn'
                    : 'good'
              }
              darkMode={
                darkMode
              }
            />

          </div>


          <button
            type="button"
            onClick={
              () =>
                setTab?.(
                  'noc'
                )
            }
            className={
              darkMode
                ? 'mt-5 flex w-full items-center justify-between rounded-xl bg-white/[.04] px-3.5 py-3 text-xs font-semibold text-slate-300 transition hover:bg-white/[.07]'
                : 'mt-5 flex w-full items-center justify-between rounded-xl bg-slate-50 px-3.5 py-3 text-xs font-semibold text-slate-600 transition hover:bg-slate-100'
            }
          >
            Full network diagnostics
            <DashboardIcon
              kind="arrow"
            />
          </button>
        </article>

      </section>


      <section className="grid grid-cols-[minmax(0,1.3fr)_minmax(340px,.7fr)] gap-3">

        <article
          className={`rounded-[20px] border p-4 shadow-[0_6px_24px_rgba(15,23,42,.035)] ${card}`}
        >
          <div className="flex items-center justify-between">

            <div>
              <h3
                className={`text-base font-semibold tracking-[-.02em] ${heading}`}
              >
                Top users right now
              </h3>

              <p
                className={`mt-1 text-xs ${muted}`}
              >
                Highest live bandwidth consumers
                reported by MikroTik queues.
              </p>
            </div>

            <span className="flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-[10px] font-semibold text-emerald-700">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              LIVE
            </span>

          </div>


          {topUsers.length ? (
            <div className="mt-3 space-y-0.5">

              {topUsers.map(
                (
                  user,
                  index
                ) => {
                  const total =
                    Number(
                      user.total_mbps ||
                      0
                    );

                  const width =
                    Math.max(
                      5,
                      (
                        total /
                        maximumUser
                      ) *
                      100
                    );

                  return (
                    <button
                      key={
                        `${user.name}-${index}`
                      }
                      type="button"
                      onClick={
                        () =>
                          setTab?.(
                            'subscribers'
                          )
                      }
                      className={
                        darkMode
                          ? 'group grid w-full grid-cols-[42px_minmax(0,1fr)_110px] items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-white/[.035]'
                          : 'group grid w-full grid-cols-[42px_minmax(0,1fr)_110px] items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-slate-50'
                      }
                    >

                      <span
                        className={
                          darkMode
                            ? 'flex h-9 w-9 items-center justify-center rounded-xl bg-white/[.04] text-xs font-semibold text-slate-400'
                            : 'flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-xs font-semibold text-slate-500'
                        }
                      >
                        {String(
                          index + 1
                        ).padStart(
                          2,
                          '0'
                        )}
                      </span>


                      <span className="min-w-0">

                        <span
                          className={`block truncate text-sm font-semibold ${heading}`}
                        >
                          {user.name ||
                            user.target ||
                            'Network user'}
                        </span>

                        <span
                          className={`mt-1 block truncate text-[11px] ${muted}`}
                        >
                          {user.target ||
                            user.service ||
                            'MikroTik session'}
                        </span>

                        <span
                          className={
                            darkMode
                              ? 'mt-2 block h-1.5 overflow-hidden rounded-full bg-slate-800'
                              : 'mt-2 block h-1.5 overflow-hidden rounded-full bg-slate-100'
                          }
                        >
                          <span
                            className="block h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-600"
                            style={{
                              width:
                                `${width}%`,
                            }}
                          />
                        </span>

                      </span>


                      <span className="text-right">

                        <strong
                          className={`block text-sm font-semibold ${heading}`}
                        >
                          {formatMbps(
                            total
                          )}
                        </strong>

                        <span
                          className={`mt-1 block text-[10px] ${muted}`}
                        >
                          ↓{' '}
                          {formatMbps(
                            user.download_mbps
                          )}{' '}
                          · ↑{' '}
                          {formatMbps(
                            user.upload_mbps
                          )}
                        </span>

                      </span>

                    </button>
                  );
                }
              )}

            </div>
          ) : (
            <div
              className={
                darkMode
                  ? 'mt-5 rounded-2xl bg-white/[.025] px-5 py-10 text-center'
                  : 'mt-5 rounded-2xl bg-slate-50 px-5 py-10 text-center'
              }
            >
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                <DashboardIcon
                  kind="pulse"
                />
              </div>

              <p
                className={`mt-3 text-sm font-semibold ${heading}`}
              >
                No live queue consumers yet
              </p>

              <p
                className={`mt-1 text-xs ${muted}`}
              >
                Active users will rank here as
                MikroTik reports their traffic.
              </p>
            </div>
          )}

        </article>


        <article
          className={`rounded-[20px] border p-4 shadow-[0_6px_24px_rgba(15,23,42,.035)] ${card}`}
        >
          <div className="flex items-center justify-between">
            <div>
              <h3
                className={`text-base font-semibold tracking-[-.02em] ${heading}`}
              >
                Live activity
              </h3>

              <p
                className={`mt-1 text-xs ${muted}`}
              >
                Latest collections and billing events.
              </p>
            </div>

            <button
              type="button"
              onClick={
                () =>
                  setTab?.(
                    'payments'
                  )
              }
              className="text-[11px] font-semibold text-emerald-600 hover:text-emerald-700"
            >
              View all
            </button>
          </div>


          {recentPayments.length ? (
            <div className="mt-3">

              {recentPayments.map(
                payment => (
                  <div
                    key={
                      payment.id
                    }
                    className={
                      darkMode
                        ? 'flex items-center gap-3 border-b border-slate-800 py-3.5 last:border-0'
                        : 'flex items-center gap-3 border-b border-slate-100 py-3.5 last:border-0'
                    }
                  >

                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                      <svg
                        viewBox="0 0 24 24"
                        className="h-4 w-4 fill-none stroke-current"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="m6 12 4 4 8-8" />
                      </svg>
                    </span>


                    <div className="min-w-0 flex-1">

                      <p
                        className={`truncate text-sm font-semibold ${heading}`}
                      >
                        {payment.reference ||
                          payment.invoice_number ||
                          'Payment received'}
                      </p>

                      <p
                        className={`mt-0.5 text-[10px] ${muted}`}
                      >
                        {payment.method ||
                          'Collection'}{' '}
                        ·{' '}
                        {timeLabel(
                          payment.paid_at
                        )}
                      </p>

                    </div>


                    <strong
                      className={`text-sm font-semibold ${heading}`}
                    >
                      {formatMoney(
                        payment.amount,
                        money
                      )}
                    </strong>

                  </div>
                )
              )}

            </div>
          ) : (
            <div
              className={`mt-8 text-center text-sm ${muted}`}
            >
              No recent payment activity.
            </div>
          )}

        </article>

      </section>
      <section>
        <article className={`rounded-[20px] border p-4 shadow-[0_6px_24px_rgba(15,23,42,.035)] ${card}`}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className={`text-base font-semibold tracking-[-.02em] ${heading}`}>Client sessions trend</h3>
              <p className={`mt-1 text-xs ${muted}`}>PPPoE and hotspot sessions from the same MikroTik snapshots.</p>
            </div>
            <div className="flex items-center gap-3 text-[11px] font-semibold"><span className="flex items-center gap-1.5 text-indigo-500"><i className="h-2 w-2 rounded-full bg-indigo-500" />PPPoE</span><span className="flex items-center gap-1.5 text-emerald-500"><i className="h-2 w-2 rounded-full bg-emerald-500" />Hotspot</span></div>
          </div>
          <div className="mt-4"><ClientTrendChart values={traffic} darkMode={darkMode} /></div>
        </article>
      </section>
    </div>
  );
}

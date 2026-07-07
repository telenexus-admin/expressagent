import React from 'react';

const base = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  viewBox: '0 0 24 24',
};

function makeIcon(path) {
  return function Icon({ className = 'w-5 h-5', ...rest }) {
    return (
      <svg className={className} {...base} {...rest}>
        {path}
      </svg>
    );
  };
}

export const ChatIcon = makeIcon(
  <path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.86 9.86 0 0 1-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8Z" />
);

export const LifebuoyIcon = makeIcon(
  <>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="3.5" />
    <path d="m4.93 4.93 4.6 4.6M14.47 14.47l4.6 4.6M19.07 4.93l-4.6 4.6M9.53 14.47l-4.6 4.6" />
  </>
);

export const TicketIcon = makeIcon(
  <>
    <path d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2.2a2.8 2.8 0 0 0 0 5.6V17a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2.2a2.8 2.8 0 0 0 0-5.6V7Z" />
    <path d="M9 8h6M9 12h6M9 16h4" />
  </>
);

export const PulseIcon = makeIcon(
  <path d="M3 12h3l2-5 4 10 2-5h7" />
);

export const ChartIcon = makeIcon(
  <>
    <path d="M3 21h18" />
    <rect x="6" y="13" width="3" height="6" rx="0.5" />
    <rect x="11" y="9" width="3" height="10" rx="0.5" />
    <rect x="16" y="5" width="3" height="14" rx="0.5" />
  </>
);

export const UsersIcon = makeIcon(
  <>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
    <circle cx="17" cy="9" r="2.8" />
    <path d="M15.5 14.5a4.5 4.5 0 0 1 6 4.5" />
  </>
);

export const CogIcon = makeIcon(
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
  </>
);

export const LogoutIcon = makeIcon(
  <>
    <path d="M15 17l5-5-5-5" />
    <path d="M20 12H9" />
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
  </>
);

export const CheckCircleIcon = makeIcon(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="m8.5 12.5 2.5 2.5 4.5-5" />
  </>
);

export const SearchIcon = makeIcon(
  <>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </>
);

export const RefreshIcon = makeIcon(
  <>
    <path d="M20 12a8 8 0 0 1-13.66 5.66" />
    <path d="M4 12A8 8 0 0 1 17.66 6.34" />
    <path d="M18 2v5h-5" />
    <path d="M6 22v-5h5" />
  </>
);

export const ShieldIcon = makeIcon(
  <>
    <path d="M12 3 20 6v6c0 5-3.4 8.5-8 9-4.6-.5-8-4-8-9V6l8-3Z" />
    <path d="m9 12 2 2 4-5" />
  </>
);

export const ActivityIcon = makeIcon(
  <circle cx="12" cy="12" r="4" />
);

export const WarningIcon = makeIcon(
  <>
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
  </>
);

export const AgentIcon = makeIcon(
  <>
    <rect x="4" y="7" width="16" height="12" rx="3" />
    <path d="M12 3v4" />
    <circle cx="12" cy="3" r="1" />
    <circle cx="9" cy="12" r="1" />
    <circle cx="15" cy="12" r="1" />
    <path d="M9 16h6" />
  </>
);

export const ArrowRightIcon = makeIcon(
  <>
    <path d="M5 12h14" />
    <path d="m13 6 6 6-6 6" />
  </>
);

export const WrenchIcon = makeIcon(
  <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4l-6 6a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l6-6a4 4 0 0 0 5.4-5.4l-2.5 2.5-1.8-.2-.2-1.8 2.5-2.5Z" />
);

export const DownloadIcon = makeIcon(
  <>
    <path d="M12 4v12" />
    <path d="m7 11 5 5 5-5" />
    <path d="M5 20h14" />
  </>
);

export const ShareIosIcon = makeIcon(
  <>
    <path d="M12 3v12" />
    <path d="m8 7 4-4 4 4" />
    <path d="M6 12H5a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5a2 2 0 0 0-2-2h-1" />
  </>
);

export const MenuIcon = makeIcon(
  <>
    <path d="M4 7h16" />
    <path d="M4 12h16" />
    <path d="M4 17h16" />
  </>
);

export const CloseIcon = makeIcon(
  <>
    <path d="M6 6l12 12" />
    <path d="M18 6 6 18" />
  </>
);

export const DotsVerticalIcon = makeIcon(
  <>
    <circle cx="12" cy="5" r="1.4" />
    <circle cx="12" cy="12" r="1.4" />
    <circle cx="12" cy="19" r="1.4" />
  </>
);

export const HomeIcon = makeIcon(
  <>
    <path d="M3 11.5 12 4l9 7.5" />
    <path d="M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9" />
  </>
);

export const BuildingIcon = makeIcon(
  <>
    <rect x="4" y="3" width="16" height="18" rx="1.5" />
    <path d="M9 8h.01M13 8h.01M9 12h.01M13 12h.01M9 16h.01M13 16h.01" />
    <path d="M10 21v-3h4v3" />
  </>
);

export const BriefcaseIcon = makeIcon(
  <>
    <rect x="3" y="7" width="18" height="13" rx="2" />
    <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <path d="M3 12h18" />
  </>
);

export const FlowIcon = makeIcon(
  <>
    <circle cx="6" cy="6" r="2" />
    <circle cx="18" cy="6" r="2" />
    <circle cx="6" cy="18" r="2" />
    <circle cx="18" cy="18" r="2" />
    <path d="M8 6h8M6 8v8M18 8v8M8 18h8" />
  </>
);

export const BrainIcon = makeIcon(
  <>
    <path d="M9 4a3 3 0 0 0-3 3v.5A3 3 0 0 0 4 10v1a3 3 0 0 0 2 2.8V15a3 3 0 0 0 3 3h.5" />
    <path d="M15 4a3 3 0 0 1 3 3v.5A3 3 0 0 1 20 10v1a3 3 0 0 1-2 2.8V15a3 3 0 0 1-3 3h-.5" />
    <path d="M12 4v16" />
  </>
);

export const BoltIcon = makeIcon(
  <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />
);

export const CreditCardIcon = makeIcon(
  <>
    <rect x="3" y="6" width="18" height="13" rx="2" />
    <path d="M3 10h18" />
    <path d="M7 15h3" />
  </>
);

export const PhoneIcon = makeIcon(
  <path d="M5 4h3l2 5-2.5 1.5a11 11 0 0 0 6 6L15 14l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z" />
);

export const HeartIcon = makeIcon(
  <path d="M12 21s-7-4.5-9.5-9A5.5 5.5 0 0 1 12 6a5.5 5.5 0 0 1 9.5 6c-2.5 4.5-9.5 9-9.5 9Z" />
);

export const QuestionIcon = makeIcon(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 1.5-2.5 2-2.5 4" />
    <path d="M12 17h.01" />
  </>
);

import React, { useEffect, useState } from 'react';
import InstallAppButton from '../components/InstallAppButton';
import PushNotificationsButton from '../components/PushNotificationsButton';
import { CheckCircleIcon, CogIcon, DownloadIcon, PulseIcon } from '../components/Icons';
import { applyTheme, getStoredTheme, saveTheme } from '../utils/theme';

const THEME_OPTIONS = [
  { key: 'system', label: 'Auto', helper: 'Match this phone or browser.' },
  { key: 'light', label: 'Light', helper: 'Bright dashboard for daytime use.' },
  { key: 'dark', label: 'Dark', helper: 'Low-light mode for night shifts.' },
];

function SettingsCard({ icon: Icon, title, description, children }) {
  return (
    <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
      <div className="flex items-start gap-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#efe9ff] text-[#4B16B5]">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-black text-slate-950">{title}</h2>
          <p className="mt-1 text-sm leading-relaxed text-slate-500">{description}</p>
          <div className="mt-4">{children}</div>
        </div>
      </div>
    </section>
  );
}

export default function Settings() {
  const [theme, setTheme] = useState(() => getStoredTheme());

  useEffect(() => {
    applyTheme(theme);
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    const syncSystem = () => {
      if (getStoredTheme() === 'system') applyTheme('system');
    };
    media?.addEventListener?.('change', syncSystem);
    return () => media?.removeEventListener?.('change', syncSystem);
  }, [theme]);

  const chooseTheme = (mode) => {
    setTheme(mode);
    saveTheme(mode);
  };

  return (
    <div className="flex-1 overflow-y-auto bg-[#f8fafc] p-5 sm:p-8">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6">
          <h1 className="text-2xl font-black text-slate-950">Settings</h1>
          <p className="mt-1 text-sm text-slate-500">Personal app controls for this device.</p>
        </div>

        <div className="grid gap-4">
          <SettingsCard
            icon={DownloadIcon}
            title="Install App"
            description="Add this dashboard to your phone or desktop for quicker access."
          >
            <div className="max-w-sm">
              <InstallAppButton variant="light" />
            </div>
          </SettingsCard>

          <SettingsCard
            icon={CogIcon}
            title="Theme"
            description="Choose how the dashboard should look on this device."
          >
            <div className="grid gap-3 sm:grid-cols-3">
              {THEME_OPTIONS.map((option) => {
                const selected = theme === option.key;
                return (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => chooseTheme(option.key)}
                    className={`rounded-2xl border p-4 text-left transition ${
                      selected
                        ? 'border-[#3535FF] bg-[#f3f2ff] text-[#2828DD]'
                        : 'border-slate-100 bg-slate-50 text-slate-700 hover:bg-white'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-black">{option.label}</span>
                      {selected && <CheckCircleIcon className="h-4 w-4" />}
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-slate-500">{option.helper}</p>
                  </button>
                );
              })}
            </div>
          </SettingsCard>

          <SettingsCard
            icon={PulseIcon}
            title="Phone Alerts"
            description="Allow this installed app to show notifications when customers message."
          >
            <div className="max-w-sm">
              <PushNotificationsButton variant="light" />
            </div>
          </SettingsCard>
        </div>
      </div>
    </div>
  );
}

import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';

function UpdateToast() {
  const [needRefresh, setNeedRefresh] = useState(false);
  const [updateSW, setUpdateSW] = useState(() => () => {});

  useEffect(() => {
    const update = registerSW({
      onNeedRefresh() {
        setNeedRefresh(true);
      },
    });
    setUpdateSW(() => update);
  }, []);

  if (!needRefresh) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[9999] bg-[#0A0A0F] text-white rounded-2xl shadow-xl px-4 py-3 flex items-center gap-3 text-sm">
      <span>A new version is available.</span>
      <button
        onClick={() => updateSW(true)}
        className="bg-[#3535FF] hover:bg-[#2828DD] text-white font-semibold px-3 py-1.5 rounded-lg text-xs"
      >
        Reload
      </button>
    </div>
  );
}

export function mountPWA() {
  const host = document.createElement('div');
  host.id = 'pwa-update-host';
  document.body.appendChild(host);
  createRoot(host).render(<UpdateToast />);
}

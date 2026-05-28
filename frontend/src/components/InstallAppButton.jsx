import React, { useEffect, useState } from 'react';
import { DownloadIcon, ShareIosIcon } from './Icons';

function isStandalone() {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  );
}

function isIosSafari() {
  const ua = window.navigator.userAgent || '';
  const isIos = /iPad|iPhone|iPod/.test(ua);
  const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
  return isIos && isSafari;
}

export default function InstallAppButton() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [installed, setInstalled] = useState(() => isStandalone());
  const [helpOpen, setHelpOpen] = useState(false);
  const isIos = isIosSafari();

  useEffect(() => {
    if (installed) return undefined;

    const onBeforeInstall = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    const onInstalled = () => {
      setDeferredPrompt(null);
      setInstalled(true);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, [installed]);

  if (installed) return null;

  const handleClick = async () => {
    if (deferredPrompt) {
      try {
        deferredPrompt.prompt();
        const choice = await deferredPrompt.userChoice;
        if (choice?.outcome === 'accepted') {
          setInstalled(true);
        }
      } catch {
        // ignore — browser may have invalidated the prompt
      } finally {
        setDeferredPrompt(null);
      }
      return;
    }
    setHelpOpen(true);
  };

  return (
    <>
      <button
        onClick={handleClick}
        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium bg-white/10 hover:bg-white/15 text-white transition-colors"
      >
        <DownloadIcon className="w-5 h-5 shrink-0" />
        <span className="flex-1 text-left">Install app</span>
      </button>

      {helpOpen && (
        <div
          className="fixed inset-0 z-[10000] bg-black/50 flex items-end sm:items-center justify-center p-4"
          onClick={() => setHelpOpen(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-5 text-sm text-gray-800"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 mb-3">
              <ShareIosIcon className="w-5 h-5 text-[#3535FF]" />
              <div className="font-semibold text-gray-900">Install this app</div>
            </div>
            {isIos ? (
              <ol className="space-y-2 list-decimal list-inside text-gray-700">
                <li>Tap the <span className="font-medium">Share</span> button in Safari.</li>
                <li>Scroll and tap <span className="font-medium">Add to Home Screen</span>.</li>
                <li>Tap <span className="font-medium">Add</span> in the top right.</li>
              </ol>
            ) : (
              <ol className="space-y-2 list-decimal list-inside text-gray-700">
                <li>Open this page in Chrome or Edge.</li>
                <li>Tap the browser menu.</li>
                <li>Choose <span className="font-medium">Install app</span> or <span className="font-medium">Add to Home screen</span>.</li>
              </ol>
            )}
            <button
              onClick={() => setHelpOpen(false)}
              className="mt-4 w-full bg-[#0A0A0F] hover:bg-black text-white font-semibold py-2 rounded-xl"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
}

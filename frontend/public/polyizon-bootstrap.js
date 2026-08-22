(function bootstrapPolyizon() {
  'use strict';

  var isHotspot = /^\/hotspot\/?$/.test(window.location.pathname);
  window.__nexaIsHotspot = isHotspot;
  var isOperator = window.location.pathname.indexOf('/onboarding') === 0;
  var isExpressNet = /express/i.test(window.location.hostname);

  if (!isHotspot) {
    var manifest = document.createElement('link');
    manifest.rel = 'manifest';
    manifest.href = isOperator
      ? '/nexus-manifest.webmanifest'
      : (isExpressNet ? '/expressnet-manifest.webmanifest' : '/manifest.webmanifest');
    document.head.appendChild(manifest);
  }

  if (isExpressNet && !isOperator) {
    document.title = 'ExpressNet Agent';
    var appleTitle = document.querySelector('meta[name="apple-mobile-web-app-title"]');
    if (appleTitle) appleTitle.setAttribute('content', 'ExpressNet');
    var primaryIcon = document.getElementById('primary-favicon');
    var icon32 = document.getElementById('favicon-32');
    var icon16 = document.getElementById('favicon-16');
    var appleIcon = document.getElementById('apple-touch-icon');
    if (primaryIcon) {
      primaryIcon.setAttribute('href', '/expressnet-favicon-32x32.png');
      primaryIcon.setAttribute('type', 'image/png');
      primaryIcon.setAttribute('sizes', '32x32');
    }
    if (icon32) icon32.setAttribute('href', '/expressnet-favicon-32x32.png');
    if (icon16) icon16.setAttribute('href', '/expressnet-favicon-16x16.png');
    if (appleIcon) appleIcon.setAttribute('href', '/expressnet-apple-touch-icon.png');
  }

  window.__nexaInstallPrompt = null;
  window.addEventListener('beforeinstallprompt', function rememberInstallPrompt(event) {
    event.preventDefault();
    window.__nexaInstallPrompt = event;
    window.dispatchEvent(new Event('nexa-install-prompt-ready'));
  });

  if (isHotspot) {
    var preload = document.createElement('link');
    preload.rel = 'preload';
    preload.as = 'image';
    preload.href = '/hotspot-templates/green-portrait-hotspot.webp?v=green-portrait-v1';
    preload.type = 'image/webp';
    preload.fetchPriority = 'high';
    document.head.appendChild(preload);
  }
})();

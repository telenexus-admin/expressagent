(function bootstrapPolyizon() {
  'use strict';

  var isHotspot = /^\/hotspot\/?$/.test(window.location.pathname);
  var isHotspotPreview = isHotspot && new URLSearchParams(window.location.search).get('preview') === '1';
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

  // The hotspot React page can have a cached/default theme available before the
  // current tenant configuration request finishes. Do not expose that stale paint:
  // keep a neutral bootstrap cover in place until the live config request resolves.
  // Preview mode is excluded because its configuration is supplied locally.
  if (isHotspot && !isHotspotPreview) {
    var coverId = 'polyizon-hotspot-bootstrap-cover';
    document.documentElement.classList.add('polyizon-hotspot-booting');

    var coverStyle = document.createElement('style');
    coverStyle.textContent =
      '.polyizon-hotspot-booting #root{visibility:hidden!important}' +
      '#' + coverId + '{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:#f8fafc;color:#0f172a;font-family:Arial,Helvetica,sans-serif;transition:opacity .14s ease}' +
      '#' + coverId + '.is-ready{opacity:0;pointer-events:none}' +
      '#' + coverId + ' .pzb-ring{width:30px;height:30px;border:3px solid #dbe4e8;border-top-color:#059669;border-radius:999px;animation:pzb-spin .75s linear infinite}' +
      '@keyframes pzb-spin{to{transform:rotate(360deg)}}';
    document.head.appendChild(coverStyle);

    var installCover = function installHotspotCover() {
      if (!document.body || document.getElementById(coverId)) return;
      var cover = document.createElement('div');
      cover.id = coverId;
      cover.setAttribute('role', 'status');
      cover.setAttribute('aria-label', 'Loading hotspot');
      cover.innerHTML = '<div class="pzb-ring" aria-hidden="true"></div>';
      document.body.appendChild(cover);
    };

    var revealHotspot = function revealHotspot() {
      var cover = document.getElementById(coverId);
      window.requestAnimationFrame(function () {
        window.requestAnimationFrame(function () {
          document.documentElement.classList.remove('polyizon-hotspot-booting');
          if (!cover) {
            if (coverStyle.parentNode) coverStyle.parentNode.removeChild(coverStyle);
            return;
          }
          cover.classList.add('is-ready');
          window.setTimeout(function () {
            if (cover.parentNode) cover.parentNode.removeChild(cover);
            if (coverStyle.parentNode) coverStyle.parentNode.removeChild(coverStyle);
          }, 180);
        });
      });
    };

    installCover();
    if (!document.body) {
      document.addEventListener('DOMContentLoaded', installCover, { once: true });
    }

    var nativeFetch = window.fetch.bind(window);
    window.fetch = function polyizonBootstrapFetch(input, init) {
      var requestUrl = '';
      try {
        requestUrl = typeof input === 'string' ? input : (input && input.url) || '';
      } catch (_) {
        requestUrl = '';
      }

      var request = nativeFetch(input, init);
      if (requestUrl.indexOf('/api/public/hotspot/config?') === -1) {
        return request;
      }

      return request.then(function (response) {
        // Give JSON parsing + the React state commit a short head-start, then reveal
        // the tenant-specific portal. This prevents the old blue/default portal flash.
        window.setTimeout(revealHotspot, response && response.ok ? 120 : 220);
        return response;
      }, function (error) {
        // Do not permanently cover the portal if the network itself fails; the React
        // page may still have an offline cached configuration or its own error state.
        window.setTimeout(revealHotspot, 220);
        throw error;
      });
    };

    // Fail-safe: never trap a captive-portal browser behind the cover indefinitely.
    window.setTimeout(revealHotspot, 10000);
  }
})();

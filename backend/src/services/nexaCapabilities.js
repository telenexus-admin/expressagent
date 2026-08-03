const MIKROTIK_CAPABILITY = {
  id: 'mikrotik_secure_onboarding',
  title: 'Secure MikroTik onboarding',
  action: { type: 'open_router_onboarding', label: 'Start MikroTik onboarding' },
};

function isMikrotikOnboardingQuestion(value) {
  const question = String(value || '').toLowerCase();
  const mentionsRouter = /\b(mikrotik|routeros|router|billing system)\b/.test(question);
  const asksForSetup = /\b(configure|configuration|setup|set up|add|install|connect|onboard|integrate|radius|pppoe|hotspot)\b/.test(question);
  return mentionsRouter && asksForSetup;
}

function mikrotikOnboardingAnswer() {
  return [
    "Yes. I can onboard and configure your MikroTik through Nexa's secure one-paste process.",
    '',
    'Tap "Start MikroTik onboarding", enter a router name and a temporary onboarding password, then paste the generated script into the MikroTik terminal.',
    '',
    'After the router calls back, I will register it to this billing account through its private WireGuard tunnel, identify its model and RouterOS version, discover its interfaces and capabilities, verify the protected executor account, and store its starting baseline. Nexa then prepares only compatible RADIUS, PPPoE and Hotspot changes for approval and post-change verification.',
    '',
    'I will not claim the router is configured until the callback, discovery and verification records confirm it.',
  ].join('\n');
}

function getCapabilityResponse(question) {
  if (!isMikrotikOnboardingQuestion(question)) return null;
  return {
    answer: mikrotikOnboardingAnswer(),
    sources: [{
      type: 'platform_capability',
      id: MIKROTIK_CAPABILITY.id,
      title: MIKROTIK_CAPABILITY.title,
    }],
    actions: [MIKROTIK_CAPABILITY.action],
  };
}

const PLATFORM_CAPABILITY_CONTEXT = [
  'Nexa has a production MikroTik one-paste onboarding workflow.',
  'It generates a one-time RouterOS script from Network > Add router.',
  'The bootstrap creates a private WireGuard management path and scoped read-only and executor identities, then calls Nexa back.',
  'After callback Nexa registers the router to the current tenant, discovers model, RouterOS version, interfaces and capabilities, verifies credentials, and records a baseline.',
  'RADIUS, PPPoE, Hotspot and repair changes are compatibility-checked, approval-gated and verified; never claim they were applied without execution evidence.',
].join(' ');

module.exports = {
  PLATFORM_CAPABILITY_CONTEXT,
  getCapabilityResponse,
  isMikrotikOnboardingQuestion,
  mikrotikOnboardingAnswer,
};

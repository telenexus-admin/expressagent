const MIKROTIK_CAPABILITY = {
  id: 'mikrotik_secure_onboarding',
  title: 'Secure MikroTik onboarding',
};

function isMikrotikOnboardingQuestion(value) {
  const question = String(value || '').toLowerCase();
  const mentionsRouter = /\b(mikrotik|routeros|router|billing system)\b/.test(question);
  const asksForSetup = /\b(configure|configuration|setup|set up|add|install|connect|onboard|integrate|radius|pppoe|hotspot)\b/.test(question);
  return mentionsRouter && asksForSetup;
}

function mikrotikOnboardingAnswer() {
  return [
    "Absolutely. I can add the MikroTik from here using Nexa's secure one-paste onboarding.",
    '',
    'What name should I call this MikroTik?',
    '',
    'For example: Main Office CCR or Westlands Tower Router.',
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
    flow: {
      type: 'mikrotik_onboarding',
      step: 'router_name',
    },
  };
}

const PLATFORM_CAPABILITY_CONTEXT = [
  'Nexa has a production MikroTik one-paste onboarding workflow available directly inside the Nexa chat.',
  'The guided conversation collects the router name and a confirmed API password without sending secrets to the LLM or saving them in chat history, then calls the tenant-scoped onboarding API and displays the one-time RouterOS script.',
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

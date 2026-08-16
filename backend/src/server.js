require('dotenv').config();
const express = require('express');
const cors = require('cors');
const db = require('./db');

const authRoutes = require('./routes/auth');
const conversationRoutes = require('./routes/conversations');
const adminRoutes = require('./routes/admins');
const settingsRoutes = require('./routes/settings');
const smsSettingsRoutes = require('./routes/smsSettings');
const escalationsRoutes = require('./routes/escalations');
const analyticsRoutes = require('./routes/analytics');
const clientRoutes = require('./routes/clients');
const billingOperatorRoutes = require('./routes/billingOperator');
const operatorAccessRoutes = require('./routes/operatorAccess');
const employeeRoutes = require('./routes/employees');
const workflowRoutes = require('./routes/workflows');
const activityRoutes = require('./routes/activity');
const reportRoutes = require('./routes/reports');
const invoiceRoutes = require('./routes/invoices');
const inventoryRoutes = require('./routes/inventory');
const ticketRoutes = require('./routes/tickets');
const billingRoutes = require('./routes/billing');
const billingWorkspaceRoutes = require('./routes/billingWorkspace');
const billingAgentRoutes = require('./routes/billingAgents');
const billingAgentPortalExtensions = require('./routes/billingAgentPortalExtensions');
const pppoePortalRoutes = require('./routes/pppoePortal');
const hotspotPortalRoutes = require('./routes/hotspotPortal');
const mediaLibraryRoutes = require('./routes/mediaLibrary');
const websiteKnowledgeRoutes = require('./routes/websiteKnowledge');
const mikrotikRoutes = require('./routes/mikrotik');
const nocRoutes = require('./routes/noc');
const tr069Routes = require('./routes/tr069');
const aiTaskRoutes = require('./routes/aiTasks');
const nexaKnowledgeRoutes = require('./routes/nexaKnowledge');
const incidentCommanderRoutes = require('./routes/incidentCommander');
const networkAgentRoutes = require('./routes/networkAgent');
const networkAutomationRoutes = require('./routes/networkAutomation');
const networkExecutorRoutes = require('./routes/networkExecutor');
const networkEnrollmentRoutes = require('./routes/networkEnrollment');
const helpBotRoutes = require('./routes/helpBot');
const pushRoutes = require('./routes/pushNotifications');
const customerIntakeRoutes = require('./routes/customerIntake');
const relocationRequestRoutes = require('./routes/relocationRequests');
const installationWorkOrderRoutes = require('./routes/installationWorkOrders');
const payheroRoutes = require('./routes/payhero');
const siteChatRoutes = require('./routes/siteChat');
const publicNocRoutes = require('./routes/publicNoc');
const mikrotikOnboardingPublicRoutes = require('./routes/mikrotikOnboardingPublic');
const operatorAgentRoutes = require('./routes/operatorAgent');
const operatorEvolutionRoutes = require('./routes/operatorEvolution');
const operatorUpdateContactRoutes = require('./routes/operatorUpdateContacts');
const evoSelfOnboardingRoutes = require('./routes/evoSelfOnboarding');
const evoClientRoutes = require('./routes/evoClients');
const evoRoutingRoutes = require('./routes/evoRouting');
const customerSurveyRoutes = require('./routes/feedbackWebhook');
const webhookRoutes = require('./routes/webhook');
const evolutionWebhookRoutes = require('./routes/evolutionWebhook');
const clientEvolutionWebhookRoutes = require('./routes/clientEvolutionWebhook');
const { startDailyReportScheduler } = require('./services/dailyReports');
const { startOperatorFollowUpScheduler } = require('./services/evolution');
const { startHumanTakeoverRecoveryScheduler } = require('./services/humanTakeoverRecovery');
const { startWebsiteKnowledgeScheduler } = require('./services/websiteKnowledge');
const { startAiTaskScheduler } = require('./services/aiTasks');
const { startMikrotikMonitorScheduler } = require('./services/mikrotikMonitor');
const { startRadiusSyncJobScheduler } = require('./services/radiusJobs');
const { startRadiusSessionEventScheduler } = require('./services/radiusSessionEvents');
const { startKnowledgeProcessorScheduler } = require('./services/knowledgeProcessor');
const { startKnowledgeBootstrapScheduler } = require('./services/knowledgeBootstrap');
const { startKnowledgeLLMScheduler } = require('./services/knowledgeLLM');
const { startDigitalTwinScheduler } = require('./services/digitalTwin');
const { startTwinStabilitySchedulers } = require('./services/twinStability');
const { startIncidentCommanderScheduler } = require('./services/incidentCommander');
const { startNetworkObservabilityScheduler } = require('./services/networkObservability');
const { startNetworkShadowPlannerScheduler } = require('./services/networkAutomation');
const { startNetworkExecutorScheduler } = require('./services/networkExecutor');
const { startNetworkEnrollmentScheduler } = require('./services/networkEnrollment');
const { ensureEventSchema } = require('./services/events');
const { openAIModelSummary } = require('./services/openai');
const {
  startHotspotSubscriberScheduler,
} = require('./services/hotspotSubscriberAccess');

const app = express();

const tenantCorsCache = new Map();
const TENANT_CORS_CACHE_MS = 60 * 1000;

async function isAllowedCorsOrigin(origin) {
  if (!origin) return true;
  const allowed = [
    process.env.FRONTEND_URL || 'http://localhost:5173',
    'https://neemainternet.co.ke',
    'https://www.neemainternet.co.ke',
    'https://neemainternetsolution.co.ke',
    'https://www.neemainternetsolution.co.ke',
    'https://billing.polyizon.tech',
    ...String(process.env.SITE_CHAT_ALLOWED_ORIGINS || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  ];
  if (allowed.includes(origin)) return true;

  try {
    const url = new URL(origin);
    const host = url.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === 'neemainternet.co.ke' ||
      host.endsWith('.neemainternet.co.ke') ||
      host.endsWith('.neemainternetsolution.co.ke') ||
      ((host.includes('neema') || host.includes('nis')) && host.endsWith('.ondigitalocean.app'))
    ) return true;

    if (url.protocol !== 'https:' || !host.endsWith('.polyizon.tech')) return false;
    const cached = tenantCorsCache.get(host);
    if (cached && cached.expiresAt > Date.now()) return cached.allowed;
    const result = await db.query(
      `SELECT 1 FROM client_domains WHERE LOWER(domain) = $1 AND status = 'active' LIMIT 1`,
      [host]
    );
    const tenantAllowed = Boolean(result.rows[0]);
    tenantCorsCache.set(host, { allowed: tenantAllowed, expiresAt: Date.now() + TENANT_CORS_CACHE_MS });
    return tenantAllowed;
  } catch {
    return false;
  }
}

app.use((req, res, next) => {
  const isPublicApi =
    req.path.startsWith('/api/public/site-chat') ||
    req.path.startsWith('/api/public/noc') ||
    req.path.startsWith('/api/public/hotspot');
  return cors({
    origin(origin, callback) {
      if (isPublicApi) return callback(null, true);
      isAllowedCorsOrigin(origin)
        .then((allowed) => callback(null, allowed))
        .catch((error) => callback(error));
    },
    credentials: !isPublicApi,
  })(req, res, next);
});
app.use('/webhook', express.json(), customerSurveyRoutes, webhookRoutes);
app.use('/webhook/evolution', express.json(), evolutionWebhookRoutes, clientEvolutionWebhookRoutes);

app.use(express.json({ limit: '12mb' }));
app.use('/api/public/evo-onboarding', evoSelfOnboardingRoutes);
app.use('/api/public/customer-intake', customerIntakeRoutes);
app.use('/api/public/relocation-request', relocationRequestRoutes);
app.use('/api/public/installation-work-orders', installationWorkOrderRoutes);
app.use('/api/public/payhero', payheroRoutes);
app.use('/api/public/site-chat', siteChatRoutes);
app.use('/api/public/noc', publicNocRoutes);
app.use('/api/public/mikrotik', mikrotikOnboardingPublicRoutes);
app.use('/api/public/hotspot', hotspotPortalRoutes);
app.use('/api/pppoe-portal', pppoePortalRoutes.portalRouter);
app.get('/api/public/invoices/:token', invoiceRoutes.publicInvoiceHandler);
app.use('/api/auth', authRoutes);
app.use('/api/conversations', conversationRoutes);
app.use('/api/admins', adminRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/sms-settings', smsSettingsRoutes);
app.use('/api/escalations', escalationsRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/billing-operator', billingOperatorRoutes);
app.use('/api/operator-access', operatorAccessRoutes);
app.use('/api/evo-clients', evoClientRoutes);
app.use('/api/evo-routing', evoRoutingRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/workflows', workflowRoutes);
app.use('/api/activity', activityRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/billing-workspace', billingWorkspaceRoutes);
app.use('/api/billing-workspace/pppoe-portal', pppoePortalRoutes.adminRouter);
app.use('/api/billing-agents', billingAgentRoutes.adminRouter);
app.use('/api/agent-portal/extensions', billingAgentPortalExtensions);
app.use('/api/agent-portal', billingAgentRoutes.portalRouter);
app.use('/api/media-library', mediaLibraryRoutes);
app.use('/api/website-knowledge', websiteKnowledgeRoutes);
app.use('/api/mikrotik', mikrotikRoutes);
app.use('/api/noc', nocRoutes);
app.use('/api/tr069', tr069Routes);
app.use('/api/ai-tasks', aiTaskRoutes);
app.use('/api/nexa-knowledge', nexaKnowledgeRoutes);
app.use('/api/incident-commander', incidentCommanderRoutes);
app.use('/api/network-agent', networkAgentRoutes);
app.use('/api/network-agent', networkAutomationRoutes);
app.use('/api/network-agent', networkExecutorRoutes);
app.use('/api/network-agent', networkEnrollmentRoutes);
app.use('/api/help-bot', helpBotRoutes);
app.use('/api/push', pushRoutes);
app.use('/api/operator-agent', operatorAgentRoutes);
app.use('/api/operator-evolution', operatorEvolutionRoutes);
app.use('/api/operator-update-contacts', operatorUpdateContactRoutes);

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`WhatsApp Support backend running on port ${PORT}`);
  console.log(`OpenAI runtime config: ${JSON.stringify(openAIModelSummary())}`);
  billingAgentPortalExtensions.ensureSchema()
    .then(() => console.log('Agent portal extension schema ready.'))
    .catch((error) => console.error('Agent portal extension schema initialization failed:', error.message));
  pppoePortalRoutes.ensureSchema()
    .then(() => console.log('PPPoE customer portal schema ready.'))
    .catch((error) => console.error('PPPoE customer portal schema initialization failed:', error.message));
  pppoePortalRoutes.startPppoePortalScheduler();
  ensureEventSchema()
    .then(() => console.log('Billing event schema ready.'))
    .catch((error) => console.error('Billing event schema initialization failed:', error.message));
  startDailyReportScheduler();
  startOperatorFollowUpScheduler();
  startHumanTakeoverRecoveryScheduler();
  startWebsiteKnowledgeScheduler();
  startAiTaskScheduler();
  startMikrotikMonitorScheduler();
  startHotspotSubscriberScheduler();
  startRadiusSyncJobScheduler();
  startRadiusSessionEventScheduler();
  startKnowledgeProcessorScheduler();
  startKnowledgeBootstrapScheduler();
  startKnowledgeLLMScheduler();
  startDigitalTwinScheduler();
  tr069Routes.startTr069TelemetryScheduler?.();
  startTwinStabilitySchedulers();
  startIncidentCommanderScheduler();
  startNetworkObservabilityScheduler();
  startNetworkShadowPlannerScheduler();
  startNetworkExecutorScheduler();
  startNetworkEnrollmentScheduler();
});

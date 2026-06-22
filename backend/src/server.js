require('dotenv').config();
const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const conversationRoutes = require('./routes/conversations');
const adminRoutes = require('./routes/admins');
const settingsRoutes = require('./routes/settings');
const smsSettingsRoutes = require('./routes/smsSettings');
const escalationsRoutes = require('./routes/escalations');
const analyticsRoutes = require('./routes/analytics');
const clientRoutes = require('./routes/clients');
const operatorAccessRoutes = require('./routes/operatorAccess');
const employeeRoutes = require('./routes/employees');
const workflowRoutes = require('./routes/workflows');
const activityRoutes = require('./routes/activity');
const reportRoutes = require('./routes/reports');
const invoiceRoutes = require('./routes/invoices');
const ticketRoutes = require('./routes/tickets');
const billingRoutes = require('./routes/billing');
const mediaLibraryRoutes = require('./routes/mediaLibrary');
const helpBotRoutes = require('./routes/helpBot');
const pushRoutes = require('./routes/pushNotifications');
const customerIntakeRoutes = require('./routes/customerIntake');
const payheroRoutes = require('./routes/payhero');
const siteChatRoutes = require('./routes/siteChat');
const operatorAgentRoutes = require('./routes/operatorAgent');
const operatorEvolutionRoutes = require('./routes/operatorEvolution');
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
const { openAIModelSummary } = require('./services/openai');

const app = express();

function isAllowedCorsOrigin(origin) {
  if (!origin) return true;
  const allowed = [
        process.env.FRONTEND_URL || 'http://localhost:5173',
        'https://neemainternet.co.ke',
        'https://www.neemainternet.co.ke',
        'https://neemainternetsolution.co.ke',
        'https://www.neemainternetsolution.co.ke',
    ...String(process.env.SITE_CHAT_ALLOWED_ORIGINS || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  ];
  if (allowed.includes(origin)) return true;
  try {
    const url = new URL(origin);
      const host = url.hostname.toLowerCase();
      return (
        host === 'localhost' ||
        host === 'neemainternet.co.ke' ||
        host.endsWith('.neemainternet.co.ke') ||
        host.endsWith('.neemainternetsolution.co.ke') ||
        ((host.includes('neema') || host.includes('nis')) && host.endsWith('.ondigitalocean.app'))
      );
  } catch {
    return false;
  }
}

app.use((req, res, next) => {
  const isPublicSiteChat = req.path.startsWith('/api/public/site-chat');
  return cors({
    origin(origin, callback) {
      if (isPublicSiteChat) return callback(null, true);
      if (isAllowedCorsOrigin(origin)) return callback(null, true);
      return callback(new Error('Not allowed by CORS'));
    },
    credentials: !isPublicSiteChat,
  })(req, res, next);
});

app.use('/webhook', express.json(), customerSurveyRoutes, webhookRoutes);
app.use('/webhook/evolution', express.json(), evolutionWebhookRoutes, clientEvolutionWebhookRoutes);

app.use(express.json({ limit: '12mb' }));
app.use('/api/public/evo-onboarding', evoSelfOnboardingRoutes);
app.use('/api/public/customer-intake', customerIntakeRoutes);
app.use('/api/public/payhero', payheroRoutes);
app.use('/api/public/site-chat', siteChatRoutes);
app.get('/api/public/invoices/:token', invoiceRoutes.publicInvoiceHandler);
app.use('/api/auth', authRoutes);
app.use('/api/conversations', conversationRoutes);
app.use('/api/admins', adminRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/sms-settings', smsSettingsRoutes);
app.use('/api/escalations', escalationsRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/operator-access', operatorAccessRoutes);
app.use('/api/evo-clients', evoClientRoutes);
app.use('/api/evo-routing', evoRoutingRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/workflows', workflowRoutes);
app.use('/api/activity', activityRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/media-library', mediaLibraryRoutes);
app.use('/api/help-bot', helpBotRoutes);
app.use('/api/push', pushRoutes);
app.use('/api/operator-agent', operatorAgentRoutes);
app.use('/api/operator-evolution', operatorEvolutionRoutes);

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`WhatsApp Support backend running on port ${PORT}`);
  console.log(`OpenAI runtime config: ${JSON.stringify(openAIModelSummary())}`);
  startDailyReportScheduler();
  startOperatorFollowUpScheduler();
  startHumanTakeoverRecoveryScheduler();
});

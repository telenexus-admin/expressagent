require('dotenv').config();
const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const conversationRoutes = require('./routes/conversations');
const adminRoutes = require('./routes/admins');
const settingsRoutes = require('./routes/settings');
const escalationsRoutes = require('./routes/escalations');
const analyticsRoutes = require('./routes/analytics');
const clientRoutes = require('./routes/clients');
const employeeRoutes = require('./routes/employees');
const workflowRoutes = require('./routes/workflows');
const activityRoutes = require('./routes/activity');
const reportRoutes = require('./routes/reports');
const ticketRoutes = require('./routes/tickets');
const billingRoutes = require('./routes/billing');
const helpBotRoutes = require('./routes/helpBot');
const pushRoutes = require('./routes/pushNotifications');
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

const app = express();

app.use(
  cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true,
  })
);

app.use('/webhook', express.json(), customerSurveyRoutes, webhookRoutes);
app.use('/webhook/evolution', express.json(), evolutionWebhookRoutes, clientEvolutionWebhookRoutes);

app.use(express.json());
app.use('/api/public/evo-onboarding', evoSelfOnboardingRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/conversations', conversationRoutes);
app.use('/api/admins', adminRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/escalations', escalationsRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/evo-clients', evoClientRoutes);
app.use('/api/evo-routing', evoRoutingRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/workflows', workflowRoutes);
app.use('/api/activity', activityRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/billing', billingRoutes);
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
  startDailyReportScheduler();
  startOperatorFollowUpScheduler();
});

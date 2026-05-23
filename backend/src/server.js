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
const operatorAgentRoutes = require('./routes/operatorAgent');
const webhookRoutes = require('./routes/webhook');
const evolutionWebhookRoutes = require('./routes/evolutionWebhook');
const { startDailyReportScheduler } = require('./services/dailyReports');

const app = express();

app.use(
  cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true,
  })
);

app.use('/webhook', express.json(), webhookRoutes);
app.use('/webhook/evolution', express.json(), evolutionWebhookRoutes);

app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/conversations', conversationRoutes);
app.use('/api/admins', adminRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/escalations', escalationsRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/workflows', workflowRoutes);
app.use('/api/activity', activityRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/operator-agent', operatorAgentRoutes);

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`WhatsApp Support backend running on port ${PORT}`);
  startDailyReportScheduler();
});

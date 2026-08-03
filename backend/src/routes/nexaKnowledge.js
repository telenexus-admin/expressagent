const express = require('express');
const { authMiddleware, scopeMiddleware } = require('../middleware/auth');
const { generateAIResponse } = require('../services/openai');
const {
  buildNexaKnowledgeContext,
  getKnowledgeEntity,
  getKnowledgeHealth,
  getKnowledgeSummary,
  listKnowledgeEntities,
  searchKnowledge,
} = require('../services/knowledgeProcessor');
const {
  getLLMHealth,
  listKnowledgeInsights,
  sanitizeTextForLLM,
} = require('../services/knowledgeLLM');
const {
  buildNexaTwinContext,
  getTwinEntity,
  getTwinHealth,
  getTwinImpact,
  listTwinEntities,
} = require('../services/digitalTwin');
const {
  getTwinStabilityReport,
  listTwinAlerts,
} = require('../services/twinStability');
const { buildIncidentContext } = require('../services/incidentCommander');
const { buildNetworkAutomationContext } = require('../services/networkAutomation');
const { buildNetworkExecutionContext } = require('../services/networkExecutor');
const {
  PLATFORM_CAPABILITY_CONTEXT,
  getCapabilityResponse,
} = require('../services/nexaCapabilities');

const router = express.Router();
router.use(authMiddleware, scopeMiddleware);

function resolveTargetClient(req, res) {
  if (req.scope.isSuperadmin && !req.scope.clientId) {
    res.status(400).json({ error: 'clientId query parameter is required for superadmin' });
    return null;
  }
  return req.scope.clientId;
}

function cleanQuestion(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 1000);
}

function cleanHistory(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(-8).map((item) => ({
    role: item?.role === 'assistant' ? 'assistant' : 'user',
    content: sanitizeTextForLLM(String(item?.content || ''), 1600),
  })).filter((item) => item.content);
}

router.get('/health', async (req, res) => {
  const clientId = resolveTargetClient(req, res);
  if (!clientId) return;
  try {
    const [knowledge, llm] = await Promise.all([
      getKnowledgeHealth(clientId),
      getLLMHealth(clientId),
    ]);
    res.json({ ...knowledge, llm });
  } catch (error) {
    console.error('GET /nexa-knowledge/health error:', error.message);
    res.status(500).json({ error: 'Failed to load Nexa knowledge health' });
  }
});

router.get('/insights', async (req, res) => {
  const clientId = resolveTargetClient(req, res);
  if (!clientId) return;
  try {
    const insights = await listKnowledgeInsights(clientId, {
      riskLevel: req.query.riskLevel,
      insightType: req.query.insightType,
      entityType: req.query.entityType,
      entityId: req.query.entityId,
      limit: req.query.limit,
    });
    res.json({ insights });
  } catch (error) {
    console.error('GET /nexa-knowledge/insights error:', error.message);
    res.status(500).json({ error: 'Failed to load Nexa intelligence insights' });
  }
});

router.get('/summary', async (req, res) => {
  const clientId = resolveTargetClient(req, res);
  if (!clientId) return;
  try {
    res.json(await getKnowledgeSummary(clientId, {
      from: req.query.from,
      to: req.query.to,
    }));
  } catch (error) {
    console.error('GET /nexa-knowledge/summary error:', error.message);
    res.status(500).json({ error: 'Failed to load Nexa knowledge summary' });
  }
});

router.get('/search', async (req, res) => {
  const clientId = resolveTargetClient(req, res);
  if (!clientId) return;
  try {
    const facts = await searchKnowledge(clientId, req.query.q, {
      category: req.query.category,
      entityType: req.query.entityType,
      from: req.query.from,
      to: req.query.to,
      limit: req.query.limit,
    });
    res.json({ facts });
  } catch (error) {
    console.error('GET /nexa-knowledge/search error:', error.message);
    res.status(500).json({ error: 'Failed to search Nexa knowledge' });
  }
});

router.get('/entities', async (req, res) => {
  const clientId = resolveTargetClient(req, res);
  if (!clientId) return;
  try {
    const entities = await listKnowledgeEntities(clientId, {
      entityType: req.query.entityType,
      query: req.query.q,
      limit: req.query.limit,
    });
    res.json({ entities });
  } catch (error) {
    console.error('GET /nexa-knowledge/entities error:', error.message);
    res.status(500).json({ error: 'Failed to load Nexa knowledge entities' });
  }
});

router.get('/entities/:entityType/:entityId', async (req, res) => {
  const clientId = resolveTargetClient(req, res);
  if (!clientId) return;
  try {
    const [entity, insights] = await Promise.all([
      getKnowledgeEntity(
        clientId,
        req.params.entityType,
        req.params.entityId,
        req.query.limit
      ),
      listKnowledgeInsights(clientId, {
        entityType: req.params.entityType,
        entityId: req.params.entityId,
        limit: req.query.limit,
      }),
    ]);
    if (!entity) return res.status(404).json({ error: 'Knowledge entity not found' });
    res.json({ ...entity, insights });
  } catch (error) {
    console.error('GET /nexa-knowledge/entities/:type/:id error:', error.message);
    res.status(500).json({ error: 'Failed to load Nexa knowledge entity' });
  }
});

router.get('/twin/health', async (req, res) => {
  const clientId = resolveTargetClient(req, res);
  if (!clientId) return;
  try {
    res.json(await getTwinHealth(clientId));
  } catch (error) {
    console.error('GET /nexa-knowledge/twin/health error:', error.message);
    res.status(500).json({ error: 'Failed to load Nexa digital twin health' });
  }
});

router.get('/twin/stability', async (req, res) => {
  const clientId = resolveTargetClient(req, res);
  if (!clientId) return;
  try {
    res.json(await getTwinStabilityReport(clientId));
  } catch (error) {
    console.error('GET /nexa-knowledge/twin/stability error:', error.message);
    res.status(500).json({ error: 'Failed to load Nexa digital twin stability' });
  }
});

router.get('/twin/alerts', async (req, res) => {
  const clientId = resolveTargetClient(req, res);
  if (!clientId) return;
  try {
    res.json({ alerts: await listTwinAlerts(clientId, {
      status: req.query.status,
      limit: req.query.limit,
    }) });
  } catch (error) {
    console.error('GET /nexa-knowledge/twin/alerts error:', error.message);
    res.status(500).json({ error: 'Failed to load Nexa digital twin alerts' });
  }
});

router.get('/twin/entities', async (req, res) => {
  const clientId = resolveTargetClient(req, res);
  if (!clientId) return;
  try {
    const entities = await listTwinEntities(clientId, {
      entityType: req.query.entityType,
      operationalStatus: req.query.operationalStatus,
      healthStatus: req.query.healthStatus,
      query: req.query.q,
      limit: req.query.limit,
    });
    res.json({ entities });
  } catch (error) {
    console.error('GET /nexa-knowledge/twin/entities error:', error.message);
    res.status(500).json({ error: 'Failed to load Nexa digital twin entities' });
  }
});

router.get('/twin/entities/:entityType/:entityId', async (req, res) => {
  const clientId = resolveTargetClient(req, res);
  if (!clientId) return;
  try {
    const entity = await getTwinEntity(clientId, req.params.entityType, req.params.entityId);
    if (!entity) return res.status(404).json({ error: 'Digital twin entity not found' });
    res.json(entity);
  } catch (error) {
    console.error('GET /nexa-knowledge/twin/entities/:type/:id error:', error.message);
    res.status(500).json({ error: 'Failed to load Nexa digital twin entity' });
  }
});

router.get('/twin/impact/:entityType/:entityId', async (req, res) => {
  const clientId = resolveTargetClient(req, res);
  if (!clientId) return;
  try {
    const root = await getTwinEntity(clientId, req.params.entityType, req.params.entityId);
    if (!root) return res.status(404).json({ error: 'Digital twin entity not found' });
    res.json(await getTwinImpact(clientId, req.params.entityType, req.params.entityId, {
      depth: req.query.depth,
    }));
  } catch (error) {
    console.error('GET /nexa-knowledge/twin/impact/:type/:id error:', error.message);
    res.status(500).json({ error: 'Failed to calculate digital twin impact' });
  }
});

router.post('/ask', async (req, res) => {
  const clientId = resolveTargetClient(req, res);
  if (!clientId) return;
  const question = cleanQuestion(req.body?.question);
  const history = cleanHistory(req.body?.history);
  if (!question) return res.status(400).json({ error: 'question is required' });

  const capabilityResponse = getCapabilityResponse(question);
  if (capabilityResponse) return res.json(capabilityResponse);

  try {
    const [knowledge, twin, incidents, networkPlans, networkExecutions] = await Promise.all([
      buildNexaKnowledgeContext(clientId, question, {
        from: req.body?.from,
        to: req.body?.to,
        category: req.body?.category,
        entityType: req.body?.entity_type,
        limit: 15,
      }),
      buildNexaTwinContext(clientId, question, { limit: 15, depth: 3 }),
      buildIncidentContext(clientId, question, { limit: 10 }),
      buildNetworkAutomationContext(clientId, question, { limit: 10 }),
      buildNetworkExecutionContext(clientId, question, { limit: 10 }),
    ]);
    if (!knowledge.context && !twin.context && !incidents.context && !networkPlans.context && !networkExecutions.context) {
      return res.json({
        answer: 'I do not have enough recorded account evidence to answer that yet.',
        sources: [],
      });
    }

    const systemPrompt = [
      'You are Nexa, an operations intelligence assistant for one ISP billing account.',
      'Answer only from the ACCOUNT KNOWLEDGE supplied below.',
      'Never infer information about another account or claim an action happened without evidence.',
      'If evidence is incomplete, say exactly what is missing.',
      'Respond naturally like an experienced human ISP operations assistant, never as raw JSON.',
      'Lead with the direct answer, then explain the cause, affected scope, evidence freshness, and next best step.',
      'Treat stale digital-twin observations as historical evidence, not confirmed live status.',
      'Be concise, operationally useful, and mention event IDs in parentheses for important historical claims.',
      'Do not reveal raw credentials, tokens, passwords, private keys or authentication data.',
      'Incident Commander recommendations are advisory. Never say an operational action was executed unless explicit execution evidence is supplied.',
      'Network repair plans are shadow previews only. Clearly distinguish a proposed plan from an executed repair.',
      'Do not confuse approval-gated execution with lack of capability. Accurately explain the installed platform capabilities below.',
      '',
      'INSTALLED PLATFORM CAPABILITIES:',
      PLATFORM_CAPABILITY_CONTEXT,
      '',
      'APPROVED NETWORK EXECUTION HISTORY:',
      sanitizeTextForLLM(networkExecutions.context, 10000) || 'No matching execution requests.',
      '',
      'SHADOW NETWORK REPAIR PLANS:',
      sanitizeTextForLLM(networkPlans.context, 10000) || 'No matching shadow plans.',
      '',
      'ACTIVE AND RECENT INCIDENTS:',
      sanitizeTextForLLM(incidents.context, 8000) || 'No matching incidents.',
      '',
      'CURRENT DIGITAL TWIN:',
      sanitizeTextForLLM(twin.context, 12000) || 'No matching current twin state.',
      '',
      'ACCOUNT EVENT EVIDENCE:',
      sanitizeTextForLLM(knowledge.context, 12000) || 'No matching historical events.',
    ].join('\n');
    const answer = await generateAIResponse(systemPrompt, [
      ...history,
      { role: 'user', content: question },
    ]);
    res.json({ answer, sources: [...networkExecutions.sources, ...networkPlans.sources, ...incidents.sources, ...twin.sources, ...knowledge.sources] });
  } catch (error) {
    console.error('POST /nexa-knowledge/ask error:', error.message);
    res.status(500).json({ error: 'Nexa could not answer from account knowledge' });
  }
});

module.exports = router;

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

router.get('/health', async (req, res) => {
  const clientId = resolveTargetClient(req, res);
  if (!clientId) return;
  try {
    res.json(await getKnowledgeHealth(clientId));
  } catch (error) {
    console.error('GET /nexa-knowledge/health error:', error.message);
    res.status(500).json({ error: 'Failed to load Nexa knowledge health' });
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
    const entity = await getKnowledgeEntity(
      clientId,
      req.params.entityType,
      req.params.entityId,
      req.query.limit
    );
    if (!entity) return res.status(404).json({ error: 'Knowledge entity not found' });
    res.json(entity);
  } catch (error) {
    console.error('GET /nexa-knowledge/entities/:type/:id error:', error.message);
    res.status(500).json({ error: 'Failed to load Nexa knowledge entity' });
  }
});

router.post('/ask', async (req, res) => {
  const clientId = resolveTargetClient(req, res);
  if (!clientId) return;
  const question = cleanQuestion(req.body?.question);
  if (!question) return res.status(400).json({ error: 'question is required' });

  try {
    const knowledge = await buildNexaKnowledgeContext(clientId, question, {
      from: req.body?.from,
      to: req.body?.to,
      category: req.body?.category,
      entityType: req.body?.entity_type,
      limit: 15,
    });
    if (!knowledge.context) {
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
      'Be concise, operationally useful, and mention event IDs in parentheses for important claims.',
      'Do not reveal raw credentials, tokens, passwords, private keys or authentication data.',
      '',
      'ACCOUNT KNOWLEDGE:',
      knowledge.context,
    ].join('\n');
    const answer = await generateAIResponse(systemPrompt, [
      { role: 'user', content: question },
    ]);
    res.json({ answer, sources: knowledge.sources });
  } catch (error) {
    console.error('POST /nexa-knowledge/ask error:', error.message);
    res.status(500).json({ error: 'Nexa could not answer from account knowledge' });
  }
});

module.exports = router;

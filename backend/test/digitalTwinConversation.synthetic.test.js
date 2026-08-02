const { generateAIResponse } = require('../src/services/openai');
const { sanitizeTextForLLM } = require('../src/services/knowledgeLLM');

async function run() {
  const syntheticTwin = [
    '[twin:router:synthetic-router-1] Router Alpha | lifecycle=active | operational=offline | health=critical',
    '| observed=2026-07-31T15:50:00.000Z | stale=false | confidence=1.000',
    '[impact:router:synthetic-router-1] affected=12 counts={"subscriber":12}',
  ].join(' ');
  const syntheticEvents = [
    '[event:00000000-0000-4000-8000-000000000001 | 2026-07-31T15:49:55.000Z | router.offline]',
    'Router Alpha stopped responding after two checks. Possible uplink or power failure.',
  ].join(' ');
  const systemPrompt = [
    'You are Nexa, an operations intelligence assistant for one ISP billing account.',
    'Answer only from the synthetic account evidence below.',
    'Respond naturally like an experienced human ISP operations assistant, never as raw JSON.',
    'Lead with the direct answer, then explain affected scope, evidence freshness, and next best step.',
    'Do not claim an action was performed.',
    '',
    'CURRENT DIGITAL TWIN:',
    sanitizeTextForLLM(syntheticTwin, 4000),
    '',
    'ACCOUNT EVENT EVIDENCE:',
    sanitizeTextForLLM(syntheticEvents, 4000),
  ].join('\n');
  const answer = await generateAIResponse(systemPrompt, [{
    role: 'user',
    content: 'Why are customers under Router Alpha offline, and what should I do?',
  }]);
  if (typeof answer !== 'string' || answer.trim().length < 40) throw new Error('Nexa returned no useful answer');
  if (/^[\[{]/.test(answer.trim())) throw new Error('Nexa returned dry JSON instead of a human answer');
  if (!/Router Alpha/i.test(answer) || !/(12|twelve)/i.test(answer) || !/(offline|outage|respond)/i.test(answer)) {
    throw new Error('Nexa did not use the supplied twin and impact evidence');
  }
  console.log(JSON.stringify({
    status: 'ok',
    human_answer: true,
    used_current_state: true,
    used_impact_scope: true,
    answer,
  }, null, 2));
}

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

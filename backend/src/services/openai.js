const OpenAI = require('openai');

let client = null;

function getClient() {
  if (!client) {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
}

async function generateAIResponse(systemPrompt, messageHistory) {
  const messages = [
    { role: 'system', content: systemPrompt },
    ...messageHistory.map((msg) => ({
      role: msg.role === 'user' ? 'user' : 'assistant',
      content: msg.content,
    })),
  ];

  const response = await getClient().chat.completions.create({
    model: 'gpt-4o',
    messages,
    max_tokens: 1024,
    temperature: 0.7,
  });

  return response.choices[0].message.content;
}

module.exports = { generateAIResponse };

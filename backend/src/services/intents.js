// Canonical workflow intents. Shared by the workflows API, intent classifier,
// and webhook dispatcher. Keep this list in sync with frontend src/utils/intents.js.
const INTENTS = [
  {
    key: 'new_installation',
    label: 'New Installation Request',
    description: 'Customer wants to sign up for internet / book a new installation.',
    examples: ['I want to install fibre at my place', 'Naomba kuunganishwa', 'How do I subscribe?'],
    department: 'Sales / Field Team',
  },
  {
    key: 'payment_billing',
    label: 'Payment or Billing Issue',
    description: 'Payment problems, overcharges, refunds, M-Pesa, invoices, late bills.',
    examples: ['I paid but my internet is still off', 'You charged me twice', 'I need a refund'],
    department: 'Finance',
  },
  {
    key: 'technical_issue',
    label: 'Technical Problem',
    description: 'Internet down, slow speeds, equipment broken, red lights on router.',
    examples: ['My internet is not working', 'Speeds are too slow', 'Red light on my router'],
    department: 'Technical Support',
  },
  {
    key: 'human_request',
    label: 'Wants to Speak to a Human',
    description: 'Customer explicitly asks for a real person, is frustrated, or wants escalation.',
    examples: ['Can I talk to someone?', 'I need a human agent', 'This is ridiculous'],
    department: 'Customer Support / Manager',
  },
  {
    key: 'compliment_feedback',
    label: 'Compliment or Feedback',
    description: 'Positive feedback, thanks, or suggestions worth flagging to a manager.',
    examples: ['Your service is great!', 'I love the new speeds', 'Suggestion: please add...'],
    department: 'Manager',
  },
  {
    key: 'general_inquiry',
    label: 'General Inquiry',
    description: 'Pricing, hours, coverage, plans, general questions. AI handles these directly.',
    examples: ['What are your plans?', 'Do you cover Kasarani?', 'What time are you open?'],
    department: 'AI handles — no human notification',
    isPassthrough: true,
  },
];

const INTENT_KEYS = INTENTS.map((i) => i.key);
const ROUTABLE_INTENT_KEYS = INTENTS.filter((i) => !i.isPassthrough).map((i) => i.key);

module.exports = { INTENTS, INTENT_KEYS, ROUTABLE_INTENT_KEYS };

// LLM access for the tutor's conversation, via OpenRouter.

const OR_KEY = process.env.OPEN_ROUTER_API_KEY?.trim();
const OR_MODEL = process.env.OPEN_ROUTER_MODEL?.trim() || 'anthropic/claude-haiku-4.5';

export const llmAvailable = Boolean(OR_KEY);
export const llmStatus = () => (OR_KEY ? `OpenRouter(${OR_MODEL})` : 'none');

// Returns a parsed JSON object from the model.
export async function chatJSON(messages) {
  if (!OR_KEY) throw new Error('Set OPEN_ROUTER_API_KEY to enable the tutor.');
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OR_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'http://localhost',
      'X-Title': 'Dutch Buddy',
    },
    body: JSON.stringify({
      model: OR_MODEL,
      temperature: 0.7,
      messages,
      response_format: { type: 'json_object' },
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return JSON.parse(data.choices?.[0]?.message?.content ?? '{}');
}

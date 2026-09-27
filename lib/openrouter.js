export async function streamOpenRouter({ apiKey, model, messages, systemPrompt, onChunk }) {
  const apiMessages = systemPrompt
    ? [{ role: 'system', content: systemPrompt }, ...messages]
    : messages;

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': `chrome-extension://${chrome.runtime.id}`,
      'X-Title': 'AI Browser Agent'
    },
    body: JSON.stringify({
      model: model || 'openrouter/free',
      messages: apiMessages,
      stream: true
    })
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`OpenRouter ${res.status}: ${t.slice(0, 350)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const json = JSON.parse(payload);
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) onChunk(delta);
      } catch {}
    }
  }
}

export async function listOpenRouterModels(apiKey) {
  const fallback = [
    'openrouter/free',
    'deepseek/deepseek-r1:free',
    'meta-llama/llama-3.3-70b-instruct:free',
    'google/gemma-3-27b-it:free',
    'qwen/qwen-2.5-72b-instruct:free',
    'mistralai/mistral-small-3.1-24b-instruct:free'
  ];
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models', {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
    });
    if (!res.ok) return fallback;
    const data = await res.json();
    const ids = (data.data || [])
      .filter(m => m.id.endsWith(':free') || m.id === 'openrouter/free')
      .map(m => m.id)
      .slice(0, 40);
    return ids.length ? ids : fallback;
  } catch {
    return fallback;
  }
}

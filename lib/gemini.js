export async function streamGemini({ apiKey, model, messages, systemPrompt, onChunk }) {
  const contents = messages
    .filter(m => m.role !== 'system')
    .map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));

  const body = {
    contents,
    generationConfig: { temperature: 0.7, maxOutputTokens: 8192 }
  };
  if (systemPrompt) body.systemInstruction = { parts: [{ text: systemPrompt }] };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini ${res.status}: ${errText.slice(0, 300)}`);
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
        const parts = json.candidates?.[0]?.content?.parts || [];
        for (const p of parts) if (p.text) onChunk(p.text);
      } catch {}
    }
  }
}

export async function listGeminiModels(apiKey) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
  );
  if (!res.ok) throw new Error(`Gemini models ${res.status}`);
  const data = await res.json();
  return (data.models || [])
    .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
    .map(m => m.name.replace('models/', ''));
}
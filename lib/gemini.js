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
  if (systemPrompt) {
    body.systemInstruction = { parts: [{ text: systemPrompt }] };
  }

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Gemini ${res.status}: ${t.slice(0, 350)}`);
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
        for (const p of json.candidates?.[0]?.content?.parts || []) {
          if (p.text) onChunk(p.text);
        }
      } catch {}
    }
  }
}

export async function listGeminiModels(apiKey) {
  const fallback = [
    'gemini-3.8-flash',
    'gemini-3.5-flash-lite',
    'gemini-2.5-flash-lite',
    'gemini-2.5-flash'
  ];
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`
    );
    if (!res.ok) return fallback;
    const data = await res.json();
    const ids = (data.models || [])
      .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
      .map(m => m.name.replace(/^models\//, ''))
      .filter(id => /gemini/i.test(id) && !/embedding|aqa|tts|imagen|audio|live|transcribe/i.test(id));
    ids.sort((a, b) => {
      const s = (x) =>
        (/3\.8/.test(x) ? 50 : /3\.5/.test(x) ? 40 : /3\./.test(x) ? 35 : /2\.5/.test(x) ? 30 : 0) +
        (/flash-lite/i.test(x) ? 3 : /flash/i.test(x) ? 5 : 0);
      return s(b) - s(a);
    });
    return ids.length ? ids : fallback;
  } catch {
    return fallback;
  }
}

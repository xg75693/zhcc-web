import dotenv from 'dotenv';
dotenv.config();

const API_BASE = 'https://open.bigmodel.cn/api/paas/v4';
const DEFAULT_MODEL = process.env.ZHIPU_MODEL || 'glm-4-flash';
const API_KEY = process.env.ZHIPU_API_KEY || '';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function chatCompletion(messages, model = DEFAULT_MODEL, retry = 2) {
  if (!API_KEY) {
    throw new Error('ZHIPU_API_KEY 未配置');
  }

  let lastErr;
  for (let i = 0; i <= retry; i++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);

      const res = await fetch(`${API_BASE}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${API_KEY}`
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.1,
          top_p: 0.9
        })
      });
      clearTimeout(timeout);

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`智谱 API 错误 ${res.status}: ${text}`);
      }

      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error('智谱 API 返回内容为空');
      }
      return content;
    } catch (err) {
      lastErr = err;
      if (i < retry) {
        await sleep(1000 * (i + 1));
      }
    }
  }
  throw lastErr;
}

export function extractJsonFromMarkdown(text) {
  if (!text) return null;
  const trimmed = text.trim();
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = codeBlockMatch ? codeBlockMatch[1].trim() : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

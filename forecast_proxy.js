// Optional helper for local desktop use only.
// The hosted/live HTML app now runs with Forecast Brain set to LOCAL,
// so this proxy is not required for normal public access.
// Keep this file only if you later want to re-enable OpenAI or Gemini
// forecasts from a machine that can run a local Node server.

const http = require("http");

const PORT = 8787;

function sendJson(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
  });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  return await new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

async function callOpenAI(apiKey, model, prompt, systemPrompt) {
  const messages = systemPrompt
    ? [{ role: "system", content: systemPrompt }, { role: "user", content: prompt }]
    : [{ role: "user", content: prompt }];
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + apiKey
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.15,
      max_tokens: 1200
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || "OpenAI request failed");
  return data.choices?.[0]?.message?.content || "";
}

async function callGemini(apiKey, model, prompt) {
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }]
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || "Gemini request failed");
  return data.candidates?.[0]?.content?.parts?.map(part => part.text || "").join("\n") || "";
}

async function fetchForexNews() {
  const ffUrl = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";
  try {
    const resp = await fetch(ffUrl);
    const events = await resp.json();
    const highImpact = events.filter(e =>
      e.country === "USD" && e.impact === "High" &&
      Date.now() - new Date(e.date).getTime() < 12 * 60 * 60 * 1000
    ).slice(0, 5).map(e => ({
      title: e.title,
      time: e.date,
      impact: e.impact,
      actual: e.actual || "pending",
      forecast: e.forecast || "N/A",
      previous: e.previous || "N/A"
    }));
    return highImpact;
  } catch (err) {
    return [];
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.url === "/news" && req.method === "GET") {
    try {
      const news = await fetchForexNews();
      sendJson(res, 200, { news });
    } catch (err) {
      sendJson(res, 200, { news: [] });
    }
    return;
  }

  if (req.url !== "/forecast" || req.method !== "POST") {
    sendJson(res, 404, { error: "Not found" });
    return;
  }

  try {
    const { provider, apiKey, model, prompt, systemPrompt } = await readJson(req);
    if (!provider || !apiKey || !model || !prompt) {
      sendJson(res, 400, { error: "provider, apiKey, model, and prompt are required" });
      return;
    }

    const text = provider === "openai"
      ? await callOpenAI(apiKey, model, prompt, systemPrompt)
      : provider === "gemini"
        ? await callGemini(apiKey, model, prompt)
        : null;

    if (!text) {
      sendJson(res, 400, { error: "Unsupported provider" });
      return;
    }

    sendJson(res, 200, { text });
  } catch (err) {
    sendJson(res, 500, { error: err.message || "Proxy request failed" });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("Forecast proxy listening on http://127.0.0.1:" + PORT);
});

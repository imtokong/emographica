// api/emotion.js — Vercel Serverless Function
export default async function handler(req, res) {
  // ✅ CORS 설정 (GitHub Pages 도메인만 허용하고 싶다면 "*" 대신 "https://imtokong.github.io")
  res.setHeader("Access-Control-Allow-Origin", "https://imtokong.github.io");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    // Preflight 요청에 즉시 응답
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "method_not_allowed" });
  }

  try {
    const text = (req.body?.text ?? "").toString();
    if (!text) {
      return res.status(400).json({ error: "no text" });
    }

    const r = await fetch(
      `https://api-inference.huggingface.co/models/${process.env.MODEL_ID}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.HF_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ inputs: text }),
      }
    );

    const data = await r.json().catch(() => ({}));
    return res.status(r.status).json(data);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "proxy_failed" });
  }
}


// api/emotion.js — Vercel Serverless Function
export default async function handler(req, res) {
  // CORS (GitHub Pages에서 호출하므로 허용)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    // Vercel에서는 body가 자동 파싱되어 들어오지만 안전하게 처리
    const text = (req.body?.text ?? "").toString();
    if (!text) return res.status(400).json({ error: "no text" });

    const r = await fetch(`https://api-inference.huggingface.co/models/${process.env.MODEL_ID}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.HF_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ inputs: text }),
    });

    // HF 응답 그대로 전달
    const data = await r.json().catch(() => ({}));
    return res.status(r.status).json(data);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "proxy_failed" });
  }
}


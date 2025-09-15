// api/emotion.js — Vercel Serverless Function
export default async function handler(req, res) {
  // ✅ CORS: 테스트용으로 전부 허용 (배포 후엔 * 대신 GitHub Pages 도메인 넣으면 안전)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");

  // Preflight (OPTIONS) 요청 빠르게 응답
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // POST만 허용
  if (req.method !== "POST") {
    return res.status(405).json({ error: "method_not_allowed" });
  }

  try {
    // body 안전하게 처리
    const text = (req.body?.text ?? "").toString();
    if (!text) {
      return res.status(400).json({ error: "no text" });
    }

    // Hugging Face API 호출
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

    // HF 응답 그대로 전달
    const data = await r.json().catch(() => ({}));
    return res.status(r.status).json(data);

  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "proxy_failed" });
  }
}


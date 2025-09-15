// /api/emotion.js
export default async function handler(req, res) {
  // --- CORS ---
  const ALLOW_ORIGINS = ["*"]; // 배포 후 ["https://너의프론트도메인"] 으로 바꾸는 걸 추천
  const origin = req.headers.origin || "*";
  res.setHeader("Access-Control-Allow-Origin", ALLOW_ORIGINS.includes("*") ? "*" : (ALLOW_ORIGINS.includes(origin) ? origin : "null"));
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    // --- 입력 파싱 ---
    const text = (req.body?.text ?? "").toString().trim();
    if (!text) return res.status(400).json({ error: "no text" });

    // --- OpenAI Responses API 호출 ---
    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        // 가성비 좋은 추천: gpt-4.1-mini (필요시 gpt-4.1로 상향)
        model: "gpt-4.1-mini",

        // JSON 스키마 강제(형식 일탈 방지)
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "EmotionResult",
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                label: { type: "string", enum: ["공포","놀람","분노","슬픔","중립","행복","혐오"] },
                confidence: { type: "number", minimum: 0, maximum: 1 }
              },
              required: ["label","confidence"]
            }
          }
        },

        // 프롬프트(시스템 역할 + few-shot + 유저 입력)
        input: [
          {
            role: "system",
            content: "너는 한국어 감정 분류 모델이다. 반드시 JSON만 반환한다. 설명/추가텍스트 금지."
          },

          // --- few-shot: 라벨별 1개 (짧고 명확한 문장) ---
          { role: "user", content: JSON.stringify({ text: "심장이 벌렁거리고 무서워 죽을 것 같아", labels: ["공포","놀람","분노","슬픔","중립","행복","혐오"] }) },
          { role: "assistant", content: JSON.stringify({ label: "공포", confidence: 0.93 }) },

          { role: "user", content: JSON.stringify({ text: "세상에 이럴 수가! 완전 믿기지 않아", labels: ["공포","놀람","분노","슬픔","중립","행복","혐오"] }) },
          { role: "assistant", content: JSON.stringify({ label: "놀람", confidence: 0.91 }) },

          { role: "user", content: JSON.stringify({ text: "진짜 열받네, 또 이런 식이야?", labels: ["공포","놀람","분노","슬픔","중립","행복","혐오"] }) },
          { role: "assistant", content: JSON.stringify({ label: "분노", confidence: 0.95 }) },

          { role: "user", content: JSON.stringify({ text: "마음이 무겁고 울컥해", labels: ["공포","놀람","분노","슬픔","중립","행복","혐오"] }) },
          { role: "assistant", content: JSON.stringify({ label: "슬픔", confidence: 0.92 }) },

          { role: "user", content: JSON.stringify({ text: "그냥 그렇네. 딱히 느낌 없어", labels: ["공포","놀람","분노","슬픔","중립","행복","혐오"] }) },
          { role: "assistant", content: JSON.stringify({ label: "중립", confidence: 0.89 }) },

          { role: "user", content: JSON.stringify({ text: "너무 신나고 행복해!", labels: ["공포","놀람","분노","슬픔","중립","행복","혐오"] }) },
          { role: "assistant", content: JSON.stringify({ label: "행복", confidence: 0.96 }) },

          { role: "user", content: JSON.stringify({ text: "정말 역겹고 보기 싫어", labels: ["공포","놀람","분노","슬픔","중립","행복","혐오"] }) },
          { role: "assistant", content: JSON.stringify({ label: "혐오", confidence: 0.94 }) },

          // --- 실제 유저 입력 ---
          { role: "user", content: JSON.stringify({ text, labels: ["공포","놀람","분노","슬픔","중립","행복","혐오"] }) }
        ],

        // 디버그용 태그(선택)
        metadata: { task: "ko_emotion_classification_v1" }
      })
    });

    // --- 응답 파싱 ---
    const data = await r.json().catch(() => ({}));
    // Responses API 형식: data.output[0].content[0].text ← 여기에 JSON 문자열
    const raw = data?.output?.[0]?.content?.[0]?.text ?? null;

    let parsed = null;
    if (raw) {
      try { parsed = JSON.parse(raw); } catch {}
    }

    // 실패 시 원본도 함께 반환(디버깅에 도움)
    return res.status(r.status).json(parsed ?? { error: "bad_model_output", raw: data });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "proxy_failed" });
  }
}

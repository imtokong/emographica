// /api/emotion.js — Node 22, ESM ("type":"module")
export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    const textInput = (req.body?.text ?? "").toString().trim();
    if (!textInput) return res.status(400).json({ error: "no text" });

    const LABELS = ["공포","놀람","분노","슬픔","중립","행복","혐오"];

    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini-2024-07-18",
        temperature: 0,

        // ✅ 최상위 object 스키마 + 내부 emotions 배열(7개)
        text: {
          format: {
            type: "json_schema",
            name: "KoEmotionHFObject",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["emotions"],
              properties: {
                emotions: {
                  type: "array",
                  minItems: 7,
                  maxItems: 7,
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["label","score"],
                    properties: {
                      label: { type: "string", enum: LABELS },
                      score: { type: "number", minimum: 0, maximum: 1 }
                    }
                  }
                }
              }
            }
          }
        },

        // 프롬프트 (few-shot 2개 + 실제 입력)
        input: [
          { role: "system",
            content: "너는 한국어 감정 분류기다. 반드시 JSON(스키마 준수)만 반환한다. 설명 금지." },

          { role: "user", content: JSON.stringify({ text: "진짜 열받네, 또 이런 식이야?" }) },
          { role: "assistant", content: JSON.stringify({
            emotions: [
              {"label":"공포","score":0.02},{"label":"놀람","score":0.03},{"label":"분노","score":0.78},
              {"label":"슬픔","score":0.06},{"label":"중립","score":0.05},{"label":"행복","score":0.02},{"label":"혐오","score":0.04}
            ]
          })},

          { role: "user", content: JSON.stringify({ text: "너무 행복하고 설렌다!" }) },
          { role: "assistant", content: JSON.stringify({
            emotions: [
              {"label":"공포","score":0.01},{"label":"놀람","score":0.06},{"label":"분노","score":0.01},
              {"label":"슬픔","score":0.01},{"label":"중립","score":0.07},{"label":"행복","score":0.80},{"label":"혐오","score":0.04}
            ]
          })},

          { role: "user", content: JSON.stringify({ text: textInput }) }
        ],

        metadata: { task: "ko_emotion_classification_hf_style_v4" }
      })
    });

    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = data?.error?.message || data?.message || r.statusText || "unknown_error";
      return res.status(r.status).json({ error: msg });
    }

    // ---- 파싱: parsed(객체) 우선 → text → 최종 배열 뽑기 ----
    function extractEmotions(d) {
      const c0 = d?.output?.[0]?.content?.[0];

      if (c0 && typeof c0.parsed !== "undefined") {
        const obj = c0.parsed;
        if (obj && Array.isArray(obj.emotions)) return obj.emotions;
      }

      const txt = c0?.text ?? null;
      if (typeof txt === "string") {
        let s = txt.trim();
        if (s.startsWith("```")) {
          s = s.replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "");
        }
        try {
          const obj = JSON.parse(s);
          if (obj && Array.isArray(obj.emotions)) return obj.emotions;
        } catch {}
      }
      return null;
    }

    let arr = extractEmotions(data);
    if (!Array.isArray(arr)) {
      return res.status(200).json({ error: "bad_model_output", raw: data });
    }

    // 라벨 보정 + 정규화
    const map = new Map();
    for (const it of arr) {
      if (!it || typeof it !== "object") continue;
      const { label, score } = it;
      if (LABELS.includes(label)) {
        map.set(label, (map.get(label) || 0) + (Number(score) || 0));
      }
    }
    for (const lab of LABELS) if (!map.has(lab)) map.set(lab, 0);

    let sum = 0; for (const v of map.values()) sum += v;
    if (!(sum > 0)) {
      const w = 1 / LABELS.length;
      arr = LABELS.map(lab => ({ label: lab, score: w }));
    } else {
      arr = LABELS.map(lab => ({ label: lab, score: map.get(lab) / sum }));
    }

    // 🎯 프런트(app.js)에서 기대하는 HF 스타일 배열로 반환
    return res.status(200).json(arr);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "proxy_failed" });
  }
}


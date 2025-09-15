// /api/emotion.js  — Node 22, ESM ("type":"module")
export default async function handler(req, res) {
  // CORS (배포 후 * 대신 프런트 도메인으로 제한 추천)
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
        // Structured Outputs를 공식 지원하는 모델 권장
        model: "gpt-4o-mini-2024-07-18",
        temperature: 0,

        // ✅ 여기! response_format → text.format 로 이동
        text: {
          format: {
            type: "json_schema",
            name: "KoEmotionHFArray",
            strict: true,
            schema: {
              type: "array",
              minItems: 7,
              maxItems: 7,
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  label: { type: "string", enum: LABELS },
                  score: { type: "number", minimum: 0, maximum: 1 }
                },
                required: ["label","score"]
              }
            }
          }
        },

        // 프롬프트 (few-shot 2개 + 실제 입력)
        input: [
          { role: "system",
            content: "너는 한국어 감정 분류기다. 반드시 JSON(스키마 준수)만 반환한다. 설명 금지." },

          { role: "user", content: JSON.stringify({ text: "진짜 열받네, 또 이런 식이야?" }) },
          { role: "assistant", content: JSON.stringify([
            {"label":"공포","score":0.02},{"label":"놀람","score":0.03},{"label":"분노","score":0.78},
            {"label":"슬픔","score":0.06},{"label":"중립","score":0.05},{"label":"행복","score":0.02},{"label":"혐오","score":0.04}
          ])},

          { role: "user", content: JSON.stringify({ text: "너무 행복하고 설렌다!" }) },
          { role: "assistant", content: JSON.stringify([
            {"label":"공포","score":0.01},{"label":"놀람","score":0.06},{"label":"분노","score":0.01},
            {"label":"슬픔","score":0.01},{"label":"중립","score":0.07},{"label":"행복","score":0.80},{"label":"혐오","score":0.04}
          ])},

          { role: "user", content: JSON.stringify({ text: textInput }) }
        ],

        metadata: { task: "ko_emotion_classification_hf_style_v3" }
      })
    });

    // JSON 파싱 및 에러 핸들링
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = data?.error?.message || data?.message || r.statusText || "unknown_error";
      return res.status(r.status).json({ error: msg });
    }

    // ---- 견고한 파서 ----
    function tryExtractArray(d) {
      const c0 = d?.output?.[0]?.content?.[0];

      // 일부 SDK/런타임은 parsed를 제공
      if (c0 && typeof c0.parsed !== "undefined") return c0.parsed;

      // 일반적으로 text 필드에 JSON 문자열이 들어옴
      const txt = c0?.text ?? null;
      if (typeof txt === "string") {
        let s = txt.trim();
        if (s.startsWith("```")) {
          s = s.replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "");
        }
        const a = s.indexOf("[");
        const b = s.lastIndexOf("]");
        if (a !== -1 && b !== -1 && b > a) s = s.slice(a, b + 1);
        try { return JSON.parse(s); } catch {}
      }
      return null;
    }

    let arr = tryExtractArray(data);
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

    // 🎯 HF 스타일 배열로 반환 → app.js가 그대로 사용
    return res.status(200).json(arr);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "proxy_failed" });
  }
}


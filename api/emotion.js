// /api/emotion.js  — ESM (package.json에 "type": "module" 권장)
export default async function handler(req, res) {
  // --- CORS (배포 후엔 * 대신 프론트 도메인으로 제한 추천) ---
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  try {
    const text = (req.body?.text ?? "").toString().trim();
    if (!text) return res.status(400).json({ error: "no text" });

    // ---- OpenAI Responses API 호출 ----
    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        temperature: 0, // 분류 일관성↑

        // ✅ 최종 출력 형식을 "HF 스타일 배열"로 강제
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "KoEmotionHFArray",
            schema: {
              // 최상위가 "배열" (너의 app.js가 기대하는 형태)
              type: "array",
              minItems: 7,
              maxItems: 7,
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  label: {
                    type: "string",
                    // app.js의 LABEL_MAP 키와 "완전히 동일한" 한글 라벨 7종
                    enum: ["공포","놀람","분노","슬픔","중립","행복","혐오"]
                  },
                  score: { type: "number", minimum: 0, maximum: 1 }
                },
                required: ["label","score"]
              }
            }
          }
        },

        // 📌 지시: 7개 라벨 모두의 확률(또는 점수)을 0~1로 출력, 합계는 1±0.01로 맞추기
        input: [
          {
            role: "system",
            content: [
              "너는 한국어 감정 분류기다.",
              "반드시 JSON(스키마 준수)만 반환한다. 설명·텍스트 금지.",
              "라벨은 ['공포','놀람','분노','슬픔','중립','행복','혐오'] 정확히 7개 모두를 포함한 배열로 내라.",
              "각 원소는 {label, score}이며 score는 0~1, 전체 합계는 1에 가깝게 정규화해라."
            ].join(" ")
          },

          // --- few-shot: 분포 형태를 보여줘서 '배열'로 답하도록 유도 ---
          { role: "user", content: JSON.stringify({ text: "진짜 열받네, 또 이런 식이야?" }) },
          { role: "assistant", content: JSON.stringify([
            { "label":"공포","score":0.02 }, { "label":"놀람","score":0.03 }, { "label":"분노","score":0.78 },
            { "label":"슬픔","score":0.06 }, { "label":"중립","score":0.05 }, { "label":"행복","score":0.02 },
            { "label":"혐오","score":0.04 }
          ]) },

          { role: "user", content: JSON.stringify({ text: "너무 행복하고 설렌다!" }) },
          { role: "assistant", content: JSON.stringify([
            { "label":"공포","score":0.01 }, { "label":"놀람","score":0.06 }, { "label":"분노","score":0.01 },
            { "label":"슬픔","score":0.01 }, { "label":"중립","score":0.07 }, { "label":"행복","score":0.80 },
            { "label":"혐오","score":0.04 }
          ]) },

          // --- 실제 입력 ---
          { role: "user", content: JSON.stringify({ text }) }
        ],

        // 디버깅 태그(선택)
        metadata: { task: "ko_emotion_classification_hf_style_v1" }
      })
    });

    const data = await r.json().catch(() => ({}));
    // Responses API → data.output[0].content[0].text 에 JSON 문자열
    const raw = data?.output?.[0]?.content?.[0]?.text ?? null;

    let arr = null;
    if (raw) {
      try { arr = JSON.parse(raw); } catch {}
    }

    // 안전장치: 형식이 다르면 원본을 돌려서 프런트에서 오류 표기
    if (!Array.isArray(arr)) {
      return res.status(200).json({ error: "bad_model_output", raw: data });
    }

    // 추가 안전장치: score 정규화(합계가 0이면 균등 분배)
    const sum = arr.reduce((s, x) => s + (Number(x.score) || 0), 0);
    if (sum > 0) {
      arr = arr.map(x => ({ label: x.label, score: (Number(x.score)||0) / sum }));
    } else {
      const w = 1 / arr.length;
      arr = arr.map(x => ({ label: x.label, score: w }));
    }

    // 🎯 최종: HF 스타일 그대로 반환 → app.js의 파서가 그대로 먹는다
    return res.status(200).json(arr);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "proxy_failed" });
  }
}

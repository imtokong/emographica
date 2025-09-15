// /api/emotion.js — ESM
export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  async try {
    const text = (req.body?.text ?? "").toString().trim();
    if (!text) return res.status(400).json({ error: "no text" });

    // 1) OpenAI Responses API 호출
    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        temperature: 0,

        // 스키마: 7개 라벨의 배열 형태를 강제
        text.format: {
          type: "json_schema",
          json_schema: {
            name: "KoEmotionHFArray",
            schema: {
              type: "array",
              minItems: 7,
              maxItems: 7,
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  label: { type: "string", enum: ["공포","놀람","분노","슬픔","중립","행복","혐오"] },
                  score: { type: "number", minimum: 0, maximum: 1 }
                },
                required: ["label","score"]
              }
            }
          }
        },

        input: [
          { role: "system",
            content: "너는 한국어 감정 분류기다. 반드시 JSON(스키마 준수)만 반환한다. 설명/텍스트 금지. 7개 라벨 모두를 배열로 출력한다." },

          // few-shot (분포 예시 2개)
          { role: "user", content: JSON.stringify({ text: "진짜 열받네, 또 이런 식이야?" }) },
          { role: "assistant", content: JSON.stringify([
            {"label":"공포","score":0.02},{"label":"놀람","score":0.03},{"label":"분노","score":0.78},
            {"label":"슬픔","score":0.06},{"label":"중립","score":0.05},{"label":"행복","score":0.02},{"label":"혐오","score":0.04}
          ]) },

          { role: "user", content: JSON.stringify({ text: "너무 행복하고 설렌다!" }) },
          { role: "assistant", content: JSON.stringify([
            {"label":"공포","score":0.01},{"label":"놀람","score":0.06},{"label":"분노","score":0.01},
            {"label":"슬픔","score":0.01},{"label":"중립","score":0.07},{"label":"행복","score":0.80},{"label":"혐오","score":0.04}
          ]) },

          // 실제 입력
          { role: "user", content: JSON.stringify({ text }) }
        ],

        metadata: { task: "ko_emotion_classification_hf_style_v2" }
      })
    });

    // 2) 상태 코드가 200이 아니면 그대로 반환(키 오류, 잔액 등)
    if (!r.ok) {
      const errBody = await r.json().catch(()=>null);
      return res.status(r.status).json(errBody || { error: "openai_error" });
    }

    const data = await r.json().catch(() => ({}));

    // 3) === 견고 파싱 유틸 ===
    // Responses API는 여러 필드를 가질 수 있어: output_text, output[].content[].text 등
    const extractJSON = (obj) => {
      if (!obj) return null;

      // (a) 이미 배열로 왔으면 바로 반환
      if (Array.isArray(obj)) return obj;

      // (b) 편의 필드: output_text
      if (typeof obj.output_text === "string" && obj.output_text.trim()) {
        const s = stripFence(obj.output_text);
        const j = tryJSON(s);
        if (Array.isArray(j)) return j;
      }

      // (c) 표준 필드: output[0].content[*].text
      const blocks = obj?.output?.[0]?.content;
      if (Array.isArray(blocks)) {
        for (const b of blocks) {
          const t = (b?.text ?? b?.content ?? "");
          if (typeof t === "string" && t.trim()) {
            const s = stripFence(t);
            const j = tryJSON(s);
            if (Array.isArray(j)) return j;
          }
        }
      }

      return null;
    };

    const stripFence = (s) => {
      // ```json ... ``` 제거 & 공백 정리
      return s.replace(/```json\s*([\s\S]*?)\s*```/gi, "$1").trim();
    };
    const tryJSON = (s) => {
      try { return JSON.parse(s); } catch { return null; }
    };

    let arr = extractJSON(data);

    // 4) 스키마를 살짝 어겨도 복구: {label, score} 7개로 보정 + 정규화
    const LABELS = ["공포","놀람","분노","슬픔","중립","행복","혐오"];
    if (!Array.isArray(arr)) {
      // 마지막 안전망: 전부 0, 중립만 1.0 같은 기본값
      arr = LABELS.map(l => ({ label: l, score: l === "중립" ? 1 : 0 }));
    } else {
      // 라벨 누락/오타 보정 & 정규화
      const map = new Map(arr.map(x => [String(x.label), Number(x.score)||0]));
      arr = LABELS.map(l => ({ label: l, score: map.has(l) ? map.get(l) : 0 }));
      const sum = arr.reduce((s,x)=>s+x.score,0);
      if (sum > 0) arr = arr.map(x => ({ ...x, score: x.score / sum }));
      else arr = LABELS.map(l => ({ label: l, score: l==="중립" ? 1 : 0 }));
    }

    // 5) 최종: HF 스타일 배열 그대로 반환
    return res.status(200).json(arr);

  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "proxy_failed" });
  }
}

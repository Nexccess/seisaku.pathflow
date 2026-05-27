// api/diagnose.js  ─  Path-Flow v3.4
// クライアント仕様: 日本政策金融公庫・保証協会 融資審査伴走コンサルティング（Nexcess）
// Gemini モデル優先順: gemini-2.5-flash-lite → gemini-1.5-flash → gemini-1.5-flash-8b
// 全モデル失敗時: ルールベースの固定フォールバックを返す

const { GoogleGenerativeAI } = require('@google/generative-ai');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// ── クライアント料金表・メニュー一覧
const MENU_LIST = `
【サービス一覧（日本政策金融公庫・保証協会 融資審査伴走コンサルティング）】

1. 定額伴走プラン（3ヶ月）
   - 月額 50,000円（税別） × 3ヶ月
   - 事業計画書作成・申請書類整備・面談シミュレーション・審査フォロー・条件交渉補佐
   - 着手金なし・成果報酬なし・月払い定額

2. 単月スポットプラン（1ヶ月）
   - 月額 50,000円（税別） × 1ヶ月
   - ヒアリング・書類ドラフト・申請ルート設計

3. 初回無料相談
   - 無料
   - 融資可能性診断・最適申請ルート提案（公庫 or 保証協会）・必要書類確認
`.trim();

// ── Gemini モデル候補（優先順）
const MODEL_CANDIDATES = [
  'gemini-2.5-flash-lite',
  'gemini-1.5-flash',
  'gemini-1.5-flash-8b',
];

// ── Gemini 診断プロンプト生成
function buildPrompt(answers) {
  return `
あなたは日本政策金融公庫・保証協会の融資審査に特化したコンサルタントです。
以下の5つの診断回答をもとに、融資審査の通過可能性と最適なプランを診断してください。

${MENU_LIST}

【診断回答】
Q1（業種・業界）: ${answers[0] || '未回答'}
Q2（現在の融資に関する課題）: ${answers[1] || '未回答'}
Q3（希望融資額・使用目的）: ${answers[2] || '未回答'}
Q4（融資で実現したいこと・困っていること）: ${answers[3] || '未回答'}
Q5（融資申請の希望時期）: ${answers[4] || '未回答'}

以下のJSON形式のみで回答してください。前置き・後置き・マークダウン不要。
{
  "score": 数値（0〜100。融資審査通過の可能性スコア）,
  "grade": "A" または "B" または "C",
  "headline": "診断結果の一言まとめ（20字以内）",
  "summary": "融資状況の総評と推奨アクション（100〜150字）",
  "pain_points": [
    { "title": "課題タイトル（15字以内）", "detail": "課題の説明（40字以内）", "severity": 1〜3の数値 },
    { "title": "課題タイトル", "detail": "課題の説明", "severity": 数値 }
  ],
  "recommended_features": [
    { "feature": "推奨サービス名（上記メニューから）", "reason": "推薦理由（40字以内）" },
    { "feature": "サービス名", "reason": "理由" }
  ],
  "roi_estimate": {
    "workload_reduction": "書類作成工数の削減目安（例：約60%削減）",
    "conversion_improvement": "審査通過率の改善見込み（例：+30%向上）",
    "payback_period": "融資実行までの目安期間（例：1〜2ヶ月）"
  }
}
`.trim();
}

// ── ルールベース フォールバック
function fallbackResult(answers) {
  const urgent = (answers[4] || '').includes('1ヶ月');
  return {
    score: 65,
    grade: 'B',
    headline: '融資の可能性があります',
    summary: '現状の課題・事業状況を整理することで融資審査の通過率を高められます。着手金なしの無料相談から始め、最適な申請ルートをご提案します。',
    pain_points: [
      { title: '書類整備が不十分', detail: '事業計画書・資金繰り表の整備が審査通過の鍵です', severity: 2 },
      { title: '申請ルートが不明確', detail: '公庫・保証協会のどちらが適切か判断が必要です', severity: 2 },
    ],
    recommended_features: [
      { feature: urgent ? '単月スポットプラン（1ヶ月）' : '定額伴走プラン（3ヶ月）', reason: urgent ? '急ぎの申請に対応。書類作成から申請まで最短対応' : '計画書作成から審査フォローまで一貫してサポート' },
      { feature: '初回無料相談', reason: '現状の融資可能性と最適ルートを無料で診断します' },
    ],
    roi_estimate: {
      workload_reduction: '約60%削減',
      conversion_improvement: '+30%向上',
      payback_period: '1〜3ヶ月',
    },
  };
}

// ── Gemini API 呼び出し（モデル自動フォールバック）
async function callGemini(prompt) {
  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

  for (const modelName of MODEL_CANDIDATES) {
    try {
      const model  = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(prompt);
      const text   = result.response.text().trim();

      const cleaned = text.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
      const parsed  = JSON.parse(cleaned);
      return parsed;
    } catch (err) {
      const status = err?.status || err?.code || '';
      if (status === 429 || status === 503 ||
          String(err.message).includes('429') ||
          String(err.message).includes('503')) {
        console.warn(`[diagnose] ${modelName} failed (${status}), trying next model...`);
        continue;
      }
      console.warn(`[diagnose] ${modelName} error:`, err.message);
    }
  }
  return null;
}

// ── メインハンドラー
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const body = req.body;
    let answers = body.answers;

    // diagnosis.html の複合ペイロードから5問分の回答を組み立てる
    if (!Array.isArray(answers) || answers.length < 1) {
      const allAns = body.all_answers || {};
      answers = [
        body.industry          || allAns['業種']                      || '未回答',
        (Array.isArray(body.challenges) ? body.challenges.join('、') : body.challenges) || '未回答',
        [body.monthly_inquiries, body.current_tools].filter(Boolean).join(' / ') || '未回答',
        body.goals             || allAns['融資で実現したいこと・困っていること'] || '未回答',
        body.budget_timing     || allAns['融資申請の希望時期']         || '未回答',
      ];
    }

    const prompt       = buildPrompt(answers);
    const geminiResult = await callGemini(prompt);

    if (geminiResult) {
      return res.status(200).json(geminiResult);
    }

    console.warn('[diagnose] All Gemini models failed. Returning rule-based fallback.');
    return res.status(200).json(fallbackResult(answers));

  } catch (err) {
    console.error('[diagnose] error:', err);
    return res.status(500).json({ error: err.message });
  }
};

// api/diagnose.js  ─  Path-Flow v3.4
// クライアント仕様: 日本政策金融公庫 融資審査伴走コンサルティング（Nexcess）
// Gemini モデル優先順: gemini-2.5-flash-lite → gemini-1.5-flash → gemini-1.5-flash-8b
// 全モデル失敗時: ルールベースの固定フォールバックを返す

const { GoogleGenerativeAI } = require('@google/generative-ai');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// ── クライアント料金表・メニュー一覧
const MENU_LIST = `
【メニュー一覧（日本政策金融公庫 融資審査伴走コンサルティング）】

1. 定額伴走プラン（3ヶ月）
   - 月額 50,000円（税別） × 3ヶ月 ＝ 総額 150,000円（税別）
   - 事業計画書作成・申請書類整備・面談シミュレーション・審査フォロー・条件交渉補佐・融資実行後の問い合わせ対応（無償）
   - 着手金なし・成果報酬なし・月払い定額・中途解約可（成果物完納）

2. 単月スポットプラン（1ヶ月）
   - 月額 50,000円（税別） × 1ヶ月
   - ヒアリング・書類ドラフト・申請ルート設計の成果物を完成してお渡し
   - 着手金なし・成果報酬なし・解約後も成果物完納

3. 初回無料相談
   - 無料
   - 現状の融資可能性診断・最適申請ルートの提案（公庫 or 保証協会）・必要書類の確認
   - 所要 30〜60分（オンライン or 電話）
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
あなたは日本政策金融公庫の融資審査に特化したコンサルタントです。
以下の5つの診断回答をもとに、最適なプランを1つ提案してください。

${MENU_LIST}

【診断回答】
Q1（融資の目的）: ${answers[0] || '未回答'}
Q2（事業の状況）: ${answers[1] || '未回答'}
Q3（融資希望額）: ${answers[2] || '未回答'}
Q4（融資経験）: ${answers[3] || '未回答'}
Q5（直近の課題）: ${answers[4] || '未回答'}

以下のJSON形式のみで回答してください。前置き・後置き・マークダウン不要。
{
  "recommended_menu": "メニュー名（上記メニュー一覧の名称をそのまま使用）",
  "price": "料金の文字列（例: 月額50,000円（税別））",
  "score": 数値（0〜100）,
  "level": "A" or "B" or "C",
  "reason": "推薦理由（100〜150文字で具体的に）"
}
`.trim();
}

// ── ルールベース フォールバック
function fallbackResult(answers) {
  const answer4 = (answers[3] || '').toString().toLowerCase();
  const hasExperience = answer4.includes('ある') || answer4.includes('受けた');
  return {
    recommended_menu: hasExperience ? '定額伴走プラン（3ヶ月）' : '初回無料相談',
    price: hasExperience ? '月額50,000円（税別）× 3ヶ月' : '無料',
    score: 60,
    level: 'B',
    reason:
      '融資経験・事業状況から、まず現状の課題を整理した上で最適な申請ルートをご提案します。初回無料相談から着手金なしでスタートできます。',
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

      // JSON 抽出（```json フェンス除去）
      const cleaned = text.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
      const parsed  = JSON.parse(cleaned);
      return parsed;
    } catch (err) {
      const status = err?.status || err?.code || '';
      // 429 / 503 の場合は次モデルへフォールバック
      if (status === 429 || status === 503 ||
          String(err.message).includes('429') ||
          String(err.message).includes('503')) {
        console.warn(`[diagnose] ${modelName} failed (${status}), trying next model...`);
        continue;
      }
      // その他エラーも次モデルへ
      console.warn(`[diagnose] ${modelName} error:`, err.message);
    }
  }

  // 全モデル失敗
  return null;
}

// ── メインハンドラー
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { answers } = req.body;

    if (!Array.isArray(answers) || answers.length < 5) {
      return res.status(400).json({ error: 'answers must be an array of 5 items' });
    }

    const prompt = buildPrompt(answers);
    const geminiResult = await callGemini(prompt);

    if (geminiResult) {
      return res.status(200).json(geminiResult);
    }

    // 全モデル失敗時: ルールベース固定結果
    console.warn('[diagnose] All Gemini models failed. Returning rule-based fallback.');
    return res.status(200).json(fallbackResult(answers));

  } catch (err) {
    console.error('[diagnose] error:', err);
    return res.status(500).json({ error: err.message });
  }
};

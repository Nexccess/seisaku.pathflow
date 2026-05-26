// api/diagnose.js  ─  Path-Flow Ver 3.4  /  3030_shigyo（士業）
// Gemini AI診断エンジン  |  モデルフォールバック: 2.5-flash-lite → 1.5-flash → 1.5-flash-8b

const { GoogleGenerativeAI } = require('@google/generative-ai');

const MODELS = [
  'gemini-2.5-flash-lite',
  'gemini-1.5-flash',
  'gemini-1.5-flash-8b',
];

const SYSTEM_PROMPT = `あなたは士業（税理士・社労士・行政書士）事務所向けDXコンサルタントです。
診断スコアと回答内容に基づき、最適なサービスを1つ推薦してください。

【サービスメニュー一覧】
─ 税務・会計 ─
・月次顧問（税務）      月額 30,000円〜
・確定申告（個人）      55,000円〜
・確定申告（法人）      110,000円〜
・決算申告サポート      165,000円〜
・税務調査立会い        220,000円〜（別途日当）
─ 社会保険・労務 ─
・月次顧問（社労士）    月額 33,000円〜
・給与計算代行          月額 22,000円〜（〜10名）
・就業規則策定・改定    165,000円〜
・助成金申請代行        成功報酬20%（最低55,000円）
・社会保険新規適用手続き 55,000円〜
─ 行政書士・許認可 ─
・会社設立フルサポート  165,000円〜
・建設業許可（新規）    165,000円〜
・建設業許可（更新）    99,000円〜
・経営事項審査（経審）  110,000円〜
・産廃業許可            220,000円〜
・各種変更届            55,000円〜
─ DX・IT化支援 ─
・Path-Flow AI診断・予約システム導入   450,000円（一括）
・IT導入補助金申請サポート            110,000円〜

【回答ルール（JSON形式で返答）】
{
  "recommended_menu": "サービス名（上記一覧から1件）",
  "price": "料金（上記の通り）",
  "score": "A/B/C のいずれか",
  "level": "レベル名（例：DX未着手・レベル1）",
  "reason": "推薦理由（100〜150字の日本語）"
}
上記JSON以外の文字を一切含めないこと。`;

function ruleBasedResult(answers, score) {
  if (score <= 8) {
    return {
      recommended_menu: 'Path-Flow AI診断・予約システム導入',
      price: '450,000円（一括）',
      score: 'C',
      level: 'DX未着手 — レベル1',
      reason: '問い合わせ・データ管理・情報発信・予約すべてがアナログ段階です。まずAI診断・予約自動化システムで業務基盤を整え、顧問契約の獲得効率を抜本的に改善することを推奨します。',
    };
  } else if (score <= 12) {
    return {
      recommended_menu: '月次顧問（社労士）',
      price: '月額 33,000円〜',
      score: 'B',
      level: 'DX入門期 — レベル2',
      reason: '基礎的なデジタル化は進んでいますが、労務管理の定期的なサポートが未整備です。月次顧問契約で給与計算・社保手続きを一元化し、経営者の工数を削減することを優先します。',
    };
  } else if (score <= 16) {
    return {
      recommended_menu: '就業規則策定・改定',
      price: '165,000円〜',
      score: 'B',
      level: 'DX移行期 — レベル3',
      reason: 'DX化は進んでいますが、労務コンプライアンスの整備が次の成長段階で重要になります。就業規則の策定・改定で法的リスクを排除し、採用・組織拡大の基盤を整えましょう。',
    };
  } else {
    return {
      recommended_menu: 'IT導入補助金申請サポート',
      price: '110,000円〜',
      score: 'A',
      level: 'DX活用期 — レベル4',
      reason: '高水準のDX活用が実現されています。IT導入補助金を活用してさらなるシステム投資を行うことで、補助金を得ながら業務効率化とコスト削減を同時に達成できます。',
    };
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { answers, score } = req.body || {};
  const numericScore = Number(score) || 0;

  const userMessage = `診断スコア: ${numericScore}/20\n回答内容: ${JSON.stringify(answers)}\n上記に基づき最適なサービスを1件推薦してください。`;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn('[diagnose] GEMINI_API_KEY未設定 → ルールベースフォールバック');
    return res.status(200).json(ruleBasedResult(answers, numericScore));
  }

  const genAI = new GoogleGenerativeAI(apiKey);

  for (const modelName of MODELS) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction: SYSTEM_PROMPT,
        generationConfig: { responseMimeType: 'application/json' },
      });
      const result = await model.generateContent(userMessage);
      const text = result.response.text().trim();
      const json = JSON.parse(text.replace(/```json|```/g, '').trim());
      console.log(`[diagnose] ${modelName} → success`);
      return res.status(200).json(json);
    } catch (err) {
      const status = err?.status || err?.httpError || 0;
      console.warn(`[diagnose] ${modelName} failed (${status}):`, err.message);
      if (status !== 429 && status !== 503) {
        // 429/503以外のエラーは次モデルへフォールバックせず終了
        break;
      }
      // 429/503 → 次モデルへ
    }
  }

  console.warn('[diagnose] 全モデル失敗 → ルールベースフォールバック');
  return res.status(200).json(ruleBasedResult(answers, numericScore));
};

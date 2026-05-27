// api/save-shigyou.js  ─  Path-Flow v3.4
// ・Nodemailer + Gmail App Password によるメール通知
// ・date: スラッシュ形式禁止 → ハイフン形式 (YYYY-MM-DD) 強制
// ・answers: 配列禁止 → 文字列型 (answersStr) 強制

const { google } = require('googleapis');
const nodemailer  = require('nodemailer');

// ── 定数（本案件固定値）
const SHEET_NAME     = '診断結果';
const NOTIFY_EMAIL   = 'info.nexccess@gmail.com';

// ── 環境変数
const SPREADSHEET_ID = process.env.SHIGYOU_SPREADSHEET_ID;
const CALENDAR_ID    = process.env.CALENDAR_ID;
const GMAIL_USER     = process.env.GMAIL_USER;
const GMAIL_APP_PASS = process.env.GMAIL_APP_PASSWORD;

// ── Google Auth（Sheets + Calendar）
function getAuth() {
  const sa = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  return new google.auth.GoogleAuth({
    credentials: sa,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/calendar',
    ],
  });
}

// ── Nodemailer トランスポーター
function getTransporter() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: GMAIL_USER,
      pass: GMAIL_APP_PASS,
    },
  });
}

// ── メインハンドラー
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const {
      lp,
      name,
      phone,
      email,
      date,
      date2,
      time,
      recommended_menu,
      score,
      level,
      answers,
    } = req.body;

    // ── [バグ防止] answers が配列のままだと Sheets エラー → 必ず文字列化
    const answersStr = Array.isArray(answers)
      ? answers.join(' / ')
      : String(answers || '');

    // ── [バグ防止] date のスラッシュ形式禁止。type="date" 由来は通常 YYYY-MM-DD だが
    //    万一スラッシュが混入した場合に備えてハイフン正規化を実施
    const safeDate  = (date  || '').replace(/\//g, '-').trim();
    const safeDate2 = (date2 || '').replace(/\//g, '-').trim();

    // ── SS 格納用の日時文字列（§3-2 列F仕様: yyyy-mm-dd HH:MM）
    const dateStr  = (safeDate && time) ? `${safeDate} ${time}` : safeDate;
    const date2Str = safeDate2;

    // ── JST タイムスタンプ（送信日時列A）
    const now = new Date().toLocaleString('ja-JP', {
      timeZone: 'Asia/Tokyo',
      year:   'numeric',
      month:  '2-digit',
      day:    '2-digit',
      hour:   '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    const auth       = getAuth();
    const authClient = await auth.getClient();

    // ────────────────────────────────────────────────
    // 1. スプレッドシート書き込み
    //    ヘッダー行が存在しない場合のみ自動挿入（§3-2 仕様）
    // ────────────────────────────────────────────────
    const sheets = google.sheets({ version: 'v4', auth: authClient });

    const headerCheck = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A1:A1`,
    });
    const hasHeader =
      headerCheck.data.values &&
      headerCheck.data.values[0] &&
      headerCheck.data.values[0][0] === '送信日時';

    if (!hasHeader) {
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!A1`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [[
            '送信日時', 'LP_ID', 'お名前', '携帯電話', 'メールアドレス',
            '希望日時（第1）', '希望日時（第2）',
            'おすすめメニュー', 'スコア', 'レベル', '診断回答',
          ]],
        },
      });
    }

    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A1`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [[
          now,
          lp             || '',
          name           || '',
          phone          || '',
          email          || '',
          dateStr,
          date2Str,
          recommended_menu || '',
          score          ?? '',
          level          || '',
          answersStr,
        ]],
      },
    });

    // ────────────────────────────────────────────────
    // 2. Google Calendar 仮予約登録
    //    終日イベント（date 形式）で登録
    // ────────────────────────────────────────────────
    if (safeDate) {
      const calendar = google.calendar({ version: 'v3', auth: authClient });
      await calendar.events.insert({
        calendarId: CALENDAR_ID,
        requestBody: {
          summary: `【仮予約】${name} 様`,
          description: [
            `メニュー: ${recommended_menu}`,
            `スコア: ${score} ／ レベル: ${level}`,
            `携帯: ${phone}`,
            `メール: ${email}`,
            `希望日時②: ${date2Str}`,
            `診断回答: ${answersStr}`,
            `LP_ID: ${lp}`,
          ].join('\n'),
          start: { date: safeDate },
          end:   { date: safeDate },
        },
      });
    }

    // ────────────────────────────────────────────────
    // 3. Gmail メール通知（Nodemailer + App Password）
    // ────────────────────────────────────────────────
    const transporter = getTransporter();
    await transporter.sendMail({
      from:    `"Path-Flow 予約通知" <${GMAIL_USER}>`,
      to:      NOTIFY_EMAIL,
      subject: `【新規予約】${name} 様 ／ ${recommended_menu}`,
      text: [
        '■ 新規予約が届きました',
        '',
        `お名前　　　　: ${name}`,
        `携帯電話　　　: ${phone}`,
        `メール　　　　: ${email}`,
        `希望日時（第1）: ${dateStr}`,
        `希望日時（第2）: ${date2Str}`,
        '',
        `おすすめメニュー: ${recommended_menu}`,
        `スコア: ${score}　レベル: ${level}`,
        '',
        '診断回答:',
        answersStr,
        '',
        `送信日時: ${now}`,
        `LP_ID: ${lp}`,
      ].join('\n'),
    });

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('[save-shigyou] error:', err);
    return res.status(500).json({ error: err.message });
  }
};

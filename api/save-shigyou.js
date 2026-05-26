// api/save-shigyou.js  ─  Path-Flow Ver 3.4  /  3030_shigyo（士業）
// Google Sheets 書込み + Google Calendar 仮予約登録 + Nodemailer メール通知

'use strict';

const { google } = require('googleapis');
const nodemailer  = require('nodemailer');

/* ═══════════════════════════════════════
   定数
═══════════════════════════════════════ */
const SHEET_NAME   = 'AI診断結果';
const NOTIFY_EMAIL = 'info.nexccess@gmail.com';
const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/calendar',
];

/* ═══════════════════════════════════════
   Google Auth 共通
═══════════════════════════════════════ */
function getAuth() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON が未設定です');
  const creds = JSON.parse(raw);
  return new google.auth.GoogleAuth({ credentials: creds, scopes: SCOPES });
}

/* ═══════════════════════════════════════
   JST 日時文字列
═══════════════════════════════════════ */
function nowJST() {
  return new Date().toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).replace(/\//g, '-');
}

/* ═══════════════════════════════════════
   Sheets 書込み
═══════════════════════════════════════ */
async function writeToSheet(auth, body) {
  const {
    lp = '',
    name = '',
    office = '',
    email = '',
    phone = '',
    date = '',
    date2 = '',
    recommended_menu = '',
    score = '',
    level = '',
    answersStr = '',
  } = body;

  const spreadsheetId = process.env.SHIGYOU_SPREADSHEET_ID;
  if (!spreadsheetId) throw new Error('SHIGYOU_SPREADSHEET_ID が未設定です');

  const SHEET_NAME = '士業DX診断結果';

  const sheets = google.sheets({ version: 'v4', auth });

  // ヘッダー存在確認
  let hasHeader = false;
  try {
    const check = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${SHEET_NAME}!A1:A1`,
    });
    hasHeader = !!(check.data.values && check.data.values[0]);
  } catch (e) {
    hasHeader = false; // シート空 or 未取得時
  }

  const rows = [];

  // ヘッダーが無い場合のみ追加
  if (!hasHeader) {
    rows.push([
      '送信日時',
      'LP_ID',
      'お名前',
      '携帯電話',
      'メールアドレス',
      '希望日時（第1）',
      '希望日時（第2）',
      'おすすめメニュー',
      'スコア',
      'レベル',
      '診断回答',
    ]);
  }

  // データ行
  rows.push([
    nowJST(),
    lp,
    name,
    phone,
    email,
    date,
    date2,
    recommended_menu,
    score,
    level,
    answersStr,
  ]);

  // 追記（append）
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${SHEET_NAME}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: rows,
    },
  });
}

/* ═══════════════════════════════════════
   Google Calendar 仮予約登録
═══════════════════════════════════════ */
async function addCalendarEvent(auth, body) {
  const calendarId = process.env.CALENDAR_ID;
  if (!calendarId) { console.warn('[save] CALENDAR_ID未設定 → カレンダー登録スキップ'); return; }

  const { name = '', phone = '', email = '', date = '', score = '', level = '' } = body;

  const calendar = google.calendar({ version: 'v3', auth });

  // 希望日が YYYY-MM-DD 形式の場合は終日イベント、それ以外は翌日00:00で代替
  let startDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date.split(' ')[0])
    ? date.split(' ')[0]
    : new Date(Date.now() + 86400000).toISOString().split('T')[0];

  const endDate = (() => {
    const d = new Date(startDate);
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  })();

  await calendar.events.insert({
    calendarId,
    requestBody: {
      summary: `【仮予約】${name} 様`,
      description:
        `士業DX診断スコア: ${score}（${level}）\n` +
        `TEL: ${phone}\nEmail: ${email}`,
      start: { date: startDate },
      end:   { date: endDate },
    },
  });
}

/* ═══════════════════════════════════════
   Nodemailer メール通知
═══════════════════════════════════════ */
async function sendNotifyMail(body) {
  const gmailUser = process.env.GMAIL_USER;
  const gmailPass = process.env.GMAIL_APP_PASSWORD;
  if (!gmailUser || !gmailPass) {
    console.warn('[save] GMAIL_USER / GMAIL_APP_PASSWORD 未設定 → メール送信スキップ');
    return;
  }

  const {
    name = '', office = '', phone = '', email = '',
    date = '', date2 = '',
    recommended_menu = '', price = '', score = '', level = '', answersStr = '',
  } = body;

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: gmailUser, pass: gmailPass },
  });

  const mailBody = `
━━━━━━━━━━━━━━━━━━━━━━━
Path-Flow 士業DX診断　予約通知
━━━━━━━━━━━━━━━━━━━━━━━

■ お名前　　　: ${name}
■ 事務所名　　: ${office}
■ 携帯電話　　: ${phone}
■ メール　　　: ${email}
■ 希望日（第1）: ${date}
■ 希望日（第2）: ${date2}

■ 推奨メニュー: ${recommended_menu}
■ 料金目安　　: ${price}
■ DXスコア　　: ${score}（${level}）
■ 診断回答　　: ${answersStr}

━━━━━━━━━━━━━━━━━━━━━━━
送信元: Path-Flow システム
`.trim();

  await transporter.sendMail({
    from: `"Path-Flow 診断システム" <${gmailUser}>`,
    to:   NOTIFY_EMAIL,
    subject: `【Path-Flow】${name} 様より予約が入りました`,
    text: mailBody,
  });
}

/* ═══════════════════════════════════════
   エントリポイント
═══════════════════════════════════════ */
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const body = req.body || {};
  const errors = [];

  try {
    const auth = await getAuth();

    // 並列実行（Sheets・Calendar・メール）
    const [, , mailErr] = await Promise.allSettled([
      writeToSheet(auth, body).catch(e => { errors.push(`Sheets: ${e.message}`); }),
      addCalendarEvent(auth, body).catch(e => { errors.push(`Calendar: ${e.message}`); }),
      sendNotifyMail(body).catch(e => { errors.push(`Mail: ${e.message}`); }),
    ]);

    if (errors.length > 0) {
      console.warn('[save] 一部エラー:', errors);
      return res.status(207).json({ ok: false, errors });
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[save] Fatal:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
};

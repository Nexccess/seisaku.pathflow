// api/book.js  ─  Path-Flow v3.4 にて廃止
// §9-1 に基づき本ファイルは使用しない。
// 理想的な対応: リポジトリからファイルごと削除する。
// 削除できない場合の暫定措置として、全リクエストを 410 Gone で返す。

module.exports = (req, res) => {
  res.status(410).json({ error: 'This endpoint has been removed in v3.4. Use /api/save-shigyou instead.' });
};

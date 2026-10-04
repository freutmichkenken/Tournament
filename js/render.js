// トーナメント表を SVG で描く（左右対称の山、中央が決勝）
(function (root) {
  'use strict';

  var L = root.TournamentLogic;

  var ROW_H = 34;
  var BOX_W = 190;
  var BOX_H = 22;
  var COL_W = 88;
  var X0 = 10;
  var CENTER_GAP = 2 * COL_W;
  var TITLE_H = 80;
  var INFO_W = COL_W - 8; // 各試合の記入欄の幅
  var FONT = "'Hiragino Kaku Gothic ProN', 'Hiragino Sans', Meiryo, 'Noto Sans JP', sans-serif";

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // 全角1文字＝1、半角＝0.55 として、文字幅をおおまかに見積もる
  function textWidth(s, size) {
    var w = 0;
    for (var i = 0; i < s.length; i++) w += s.charCodeAt(i) < 128 ? 0.55 : 1;
    return w * size;
  }

  // 幅に収まらない文字は横に縮めて表示する
  function fitText(x, y, s, size, maxW, attrs) {
    var fit = textWidth(s, size) > maxW ? ' textLength="' + maxW + '" lengthAdjust="spacingAndGlyphs"' : '';
    return '<text x="' + x + '" y="' + y + '" font-size="' + size + '"' + fit + (attrs || '') + '>' + esc(s) + '</text>';
  }

  // 各試合の記入欄（線の上に審判、線の下に時間とコート）。blank なら空欄の見出しだけ。
  // x は欄の左端、y は線の高さ。
  function matchInfo(out, x, y, width, row) {
    var u = row ? row.umpire : '';
    var t = row ? row.time : '';
    var c = row && row.court ? 'コート' + row.court : '';
    out.push('<text x="' + x + '" y="' + (y - 4) + '" font-size="8" class="info-label">審判</text>');
    if (u) out.push(fitText(x + 18, y - 4, u, 10, width - 18, ' class="info-val"'));
    if (row) {
      out.push(fitText(x, y + 11, t, 10, 30, ' class="info-val"'));
      if (c) out.push(fitText(x + 34, y + 11, c, 10, width - 34, ' class="info-val"'));
    } else {
      out.push('<text x="' + x + '" y="' + (y + 11) + '" font-size="8" class="info-label">時間</text>');
      out.push('<text x="' + (x + 34) + '" y="' + (y + 11) + '" font-size="8" class="info-label">コート</text>');
    }
  }

  // state: { title, entries, bracket }, opts: { order, rows, blank, selectedSlot, clashSlots }
  // rows: 試合進行表の { 試合id: { time, court, umpire } }。blank が true なら記入欄を空欄にする。
  function renderBracket(state, opts) {
    opts = opts || {};
    var bracket = state.bracket;
    var rows = opts.blank ? {} : (opts.rows || {});
    var byId = L.indexEntries(state.entries);
    var built = L.buildMatches(bracket, opts.order);
    var R = built.rounds;
    var size = bracket.size;
    var half = size / 2;
    var halfW = X0 + BOX_W + (R - 1) * COL_W;
    var totalW = 2 * halfW + CENTER_GAP;
    var cx = totalW / 2;

    // 左右それぞれ、実在するチームだけを詰めて縦に並べる
    var rowOf = {};
    var rowsPerSide = [0, 0];
    bracket.slots.forEach(function (id, i) {
      if (id === null) return;
      var side = i < half ? 0 : 1;
      rowOf[i] = rowsPerSide[side]++;
    });
    var maxRows = Math.max(rowsPerSide[0], rowsPerSide[1]);
    var top = TITLE_H + 90; // 決勝の記入欄の分を空ける
    function slotY(i) {
      var side = i < half ? 0 : 1;
      return top + (maxRows - rowsPerSide[side]) / 2 * ROW_H + (rowOf[i] + 0.5) * ROW_H;
    }
    var height = top + maxRows * ROW_H + 20;

    var out = [];
    function ax(x, side) { return side === 0 ? x : totalW - x; }
    function line(x1, y1, x2, y2, side) {
      out.push('<line x1="' + ax(x1, side) + '" y1="' + y1 + '" x2="' + ax(x2, side) + '" y2="' + y2 + '" stroke="#333"/>');
    }

    // タイトル
    var title = L.titleFor(state.title, 'トーナメント表');
    var titleW = Math.min(totalW - 40, Math.max(360, textWidth(title, 24) + 60));
    out.push('<g class="title">');
    out.push('<rect x="' + (cx - titleW / 2) + '" y="16" width="' + titleW + '" height="46" rx="2" fill="#ffd966" stroke="#222" stroke-width="3"/>');
    out.push(fitText(cx, 47, title, 24, titleW - 30, ' text-anchor="middle" font-weight="bold" fill="#111"'));
    out.push('</g>');

    // チーム名の枠
    var anchors = {}; // 'L0' = 枠0、'r1k3' = 1回戦の3番目の結節点
    bracket.slots.forEach(function (id, i) {
      if (id === null) return;
      var e = byId[id];
      var side = i < half ? 0 : 1;
      var y = slotY(i);
      var left = side === 0 ? X0 : totalW - X0 - BOX_W;
      var cls = 'entry';
      if (opts.selectedSlot === i) cls += ' selected';
      if (opts.clashSlots && opts.clashSlots[i]) cls += ' clash';
      var clubW = e.club ? Math.min(textWidth(e.club, 10), 70) : 0;
      var label = (e.seed ? '[' + e.seed + '] ' : '') + e.name;
      out.push('<g class="' + cls + '" data-slot="' + i + '">');
      out.push('<rect x="' + left + '" y="' + (y - BOX_H / 2) + '" width="' + BOX_W + '" height="' + BOX_H + '" rx="2" fill="#fff" stroke="#333"/>');
      out.push(fitText(left + 6, y + 4.5, label, 13, BOX_W - 12 - (clubW ? clubW + 8 : 0), ' class="name"'));
      if (e.club) out.push(fitText(left + BOX_W - 6 - clubW, y + 4, e.club, 10, clubW, ' class="club"'));
      out.push('</g>');
      anchors['L' + i] = { x: X0 + BOX_W, y: y, side: side };
    });

    // 各回戦の線（決勝の手前まで）
    out.push('<g class="lines">');
    var labels = [];
    var infos = [];
    for (var r = 1; r <= R - 1; r++) {
      var X = X0 + BOX_W + r * COL_W;
      var count = size / Math.pow(2, r);
      for (var k = 0; k < count; k++) {
        var side = k < count / 2 ? 0 : 1;
        var node = built.nodes[r][k];
        var a = r === 1 ? anchors['L' + 2 * k] : anchors['r' + (r - 1) + 'k' + 2 * k];
        var b = r === 1 ? anchors['L' + (2 * k + 1)] : anchors['r' + (r - 1) + 'k' + (2 * k + 1)];
        if (node.kind === 'walkover') {
          var only = a || b;
          line(only.x, only.y, X, only.y, side);
          anchors['r' + r + 'k' + k] = { x: X, y: only.y, side: side };
          continue;
        }
        line(a.x, a.y, X, a.y, side);
        line(b.x, b.y, X, b.y, side);
        line(X, a.y, X, b.y, side);
        var mid = (a.y + b.y) / 2;
        anchors['r' + r + 'k' + k] = { x: X, y: mid, side: side };
        labels.push({ x: ax(X - 4, side), y: mid + 4, anchor: side === 0 ? 'end' : 'start', no: node.no });
        infos.push({ x: side === 0 ? X + 4 : totalW - X - COL_W + 4, y: mid, row: rows[node.id] });
      }
    }

    // 決勝
    var final = built.nodes[R][0];
    var fa = R === 1 ? anchors.L0 : anchors['r' + (R - 1) + 'k0'];
    var fb = R === 1 ? anchors.L1 : anchors['r' + (R - 1) + 'k1'];
    out.push('<line x1="' + ax(fa.x, 0) + '" y1="' + fa.y + '" x2="' + cx + '" y2="' + fa.y + '" stroke="#333"/>');
    out.push('<line x1="' + ax(fb.x, 1) + '" y1="' + fb.y + '" x2="' + cx + '" y2="' + fb.y + '" stroke="#333"/>');
    if (fa.y !== fb.y) out.push('<line x1="' + cx + '" y1="' + fa.y + '" x2="' + cx + '" y2="' + fb.y + '" stroke="#333"/>');
    out.push('</g>');
    var fy = Math.min(fa.y, fb.y);
    out.push('<text x="' + cx + '" y="' + (fy - 84) + '" font-size="18" font-weight="bold" text-anchor="middle" class="final">決勝</text>');
    out.push('<text x="' + cx + '" y="' + (fy - 66) + '" font-size="11" text-anchor="middle" class="match-no">第' + final.no + '試合</text>');
    infos.push({ x: cx - INFO_W / 2, y: fy - 42, row: rows[final.id] });

    infos.forEach(function (f) { matchInfo(out, f.x, f.y, INFO_W, f.row); });
    labels.forEach(function (lb) {
      out.push('<text x="' + lb.x + '" y="' + lb.y + '" font-size="11" text-anchor="' + lb.anchor + '" class="match-no">' + lb.no + '</text>');
    });

    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + totalW + ' ' + height + '" ' +
      'preserveAspectRatio="xMidYMin meet" font-family="' + esc(FONT) + '" class="bracket-svg" role="img" aria-label="トーナメント表">' +
      out.join('') + '</svg>';
  }

  root.TournamentRender = { renderBracket: renderBracket, esc: esc };
})(this);

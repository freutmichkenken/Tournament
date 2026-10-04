// トーナメント表を SVG で描く（左右対称の山、中央が決勝）
(function (root) {
  'use strict';

  var L = root.TournamentLogic;

  var ROW_H = 34;
  var BOX_W = 190;
  var BOX_H = 22;
  var COL_W = 88;
  var X0 = 10;
  var NUM_W = 34; // チームの番号（3〜4桁）を枠の外に置くために足す余白
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
    if (u) {
      // 長い審判（「〜から1人ずつ」など）は2行に分ける
      var cut = u.indexOf('から');
      if (textWidth(u, 10) > width - 18 && cut > 0) {
        out.push(fitText(x + 18, y - 15, u.slice(0, cut), 9, width - 18, ' class="info-val"'));
        out.push(fitText(x + 18, y - 4, u.slice(cut), 9, width - 18, ' class="info-val"'));
      } else {
        out.push(fitText(x + 18, y - 4, u, 10, width - 18, ' class="info-val"'));
      }
    }
    if (row) {
      out.push(fitText(x, y + 11, t, 10, 30, ' class="info-val"'));
      if (c) out.push(fitText(x + 34, y + 11, c, 10, width - 34, ' class="info-val"'));
    } else {
      out.push('<text x="' + x + '" y="' + (y + 11) + '" font-size="8" class="info-label">時間</text>');
      out.push('<text x="' + (x + 34) + '" y="' + (y + 11) + '" font-size="8" class="info-label">コート</text>');
    }
  }

  // 試合番号を書いた「第○試合の敗者」などの枠
  function refBox(out, x, y, s) {
    out.push('<rect x="' + x + '" y="' + (y - BOX_H / 2) + '" width="' + BOX_W + '" height="' + BOX_H + '" rx="2" fill="#f7f7f5" stroke="#888" class="ref-box"/>');
    out.push(fitText(x + 6, y + 4.5, s, 12, BOX_W - 12, ' class="ref-label"'));
  }

  // 3位決定戦・5〜8位決定戦の山。y0 から下に描き、描いた高さを返す。
  // ms: 部門の全試合、label(side): 枠に書く文字、info(m, x, y): 記入欄、no(m): 試合番号
  function renderPlacement(out, y0, ms, label, info, no) {
    var byStage = {};
    ms.forEach(function (m) { (byStage[m.stage] = byStage[m.stage] || []).push(m); });
    if (!byStage.third) return 0;
    var lines = [];
    function line(x1, y1, x2, y2) { lines.push('<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="#333"/>'); }
    function heading(x, y, s) { out.push('<text x="' + x + '" y="' + y + '" font-size="14" font-weight="bold" class="final">' + esc(s) + '</text>'); }
    // 2つの枠を線でつなぎ、つないだ点を返す
    function pair(x, y, m) {
      refBox(out, x, y, label(m.sides[0]));
      refBox(out, x, y + ROW_H, label(m.sides[1]));
      var X = x + BOX_W + COL_W;
      line(x + BOX_W, y, X, y);
      line(x + BOX_W, y + ROW_H, X, y + ROW_H);
      line(X, y, X, y + ROW_H);
      var mid = y + ROW_H / 2;
      out.push('<text x="' + (X - 4) + '" y="' + (mid + 4) + '" font-size="11" text-anchor="end" class="match-no">' + no(m) + '</text>');
      return { x: X, y: mid };
    }

    var top = y0 + 30;
    heading(X0, y0 + 10, '3位決定戦');
    var t = pair(X0, top, byStage.third[0]);
    info(byStage.third[0], t.x + 4, t.y);
    var h = 2 * ROW_H + 30;
    if (byStage.place58) {
      // 7位決定戦は3位決定戦の下、5〜8位決定戦と5位決定戦は右に描く
      var y7 = top + 2 * ROW_H + 40;
      heading(X0, y7 - 20, '7位決定戦');
      var s7 = pair(X0, y7, byStage.place7[0]);
      info(byStage.place7[0], s7.x + 4, s7.y);

      var x58 = X0 + BOX_W + COL_W + INFO_W + 40;
      heading(x58, y0 + 10, '5〜8位決定戦と5位決定戦');
      var a = pair(x58, top, byStage.place58[0]);
      var b = pair(x58, top + 2 * ROW_H, byStage.place58[1]);
      info(byStage.place58[0], a.x + 4, a.y);
      info(byStage.place58[1], b.x + 4, b.y);
      var X2 = a.x + COL_W;
      line(a.x, a.y, X2, a.y);
      line(b.x, b.y, X2, b.y);
      line(X2, a.y, X2, b.y);
      var mid5 = (a.y + b.y) / 2;
      out.push('<text x="' + (X2 - 4) + '" y="' + (mid5 + 4) + '" font-size="11" text-anchor="end" class="match-no">' + no(byStage.place5[0]) + '</text>');
      info(byStage.place5[0], X2 + 4, mid5);
      h = Math.max(4 * ROW_H, y7 + ROW_H * 2 - top) + 30;
    }
    out.push('<g class="lines">' + lines.join('') + '</g>');
    return h + 10;
  }

  // div: { title, entries, bracket }（title は大会名と部門名）
  // opts: { nos, rows, blank, selectedSlot, clashSlots, numbers }
  //   nos: { 試合id: 試合番号 }、rows: 試合進行表の { 試合id: { time, court, umpire } }。
  //   nos がなければ部門の中の仮の番号を使う。blank が true なら記入欄を空欄にする。
  //   numbers: { チームid: チームの番号 }。あれば各チームの枠の外（左の山は左、右の山は右）に番号を書き、
  //   その分だけ左右に余白を足す。なければ（番号のないチームも）番号は書かない。
  function renderBracket(div, opts) {
    opts = opts || {};
    var bracket = div.bracket;
    var rows = opts.blank ? {} : (opts.rows || {});
    var byId = L.indexEntries(div.entries);
    var built = L.divisionMatches(bracket);
    var nos = opts.nos || {};
    built.matches.forEach(function (m) { if (nos[m.id]) m.no = nos[m.id]; });
    var noOf = {};
    built.matches.forEach(function (m) { noOf[m.id] = m.no; });
    var R = built.rounds;
    var numbers = opts.numbers || null;
    var x0 = X0 + (numbers ? NUM_W : 0);
    var size = bracket.size;
    var half = size / 2;
    var halfW = x0 + BOX_W + (R - 1) * COL_W;
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
    var title = L.titleFor(div.title, 'トーナメント表');
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
      var left = side === 0 ? x0 : totalW - x0 - BOX_W;
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
      if (numbers && numbers[id] != null) {
        out.push('<text x="' + (side === 0 ? left - 6 : left + BOX_W + 6) + '" y="' + (y + 4.5) + '" font-size="12" text-anchor="' +
          (side === 0 ? 'end' : 'start') + '" class="draw-no">' + esc(numbers[id]) + '</text>');
      }
      anchors['L' + i] = { x: x0 + BOX_W, y: y, side: side };
    });

    // 各回戦の線（決勝の手前まで）
    out.push('<g class="lines">');
    var labels = [];
    var infos = [];
    for (var r = 1; r <= R - 1; r++) {
      var X = x0 + BOX_W + r * COL_W;
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
    out.push('<text x="' + cx + '" y="' + (fy - 92) + '" font-size="18" font-weight="bold" text-anchor="middle" class="final">決勝</text>');
    out.push('<text x="' + cx + '" y="' + (fy - 74) + '" font-size="11" text-anchor="middle" class="match-no">第' + final.no + '試合</text>');
    infos.push({ x: cx - INFO_W / 2, y: fy - 42, row: rows[final.id] });

    // 3位決定戦・5〜8位決定戦
    height += renderPlacement(out, height, built.matches,
      function (side) { return L.sideLabel(side, byId, noOf); },
      function (m, x, y) { infos.push({ x: x, y: y, row: rows[m.id] }); },
      function (m) { return m.no; });

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

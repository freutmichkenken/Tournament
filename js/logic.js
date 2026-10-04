// トーナメントの組み合わせ・試合一覧・日程と審判の割り当て（画面に依存しない処理）
// ブラウザでは window.TournamentLogic、Node では require で読み込む。
(function (root) {
  'use strict';

  var MAX_ENTRIES = 64;

  // ---------- 入力の読み取り ----------

  // 1行に「ペア名, 所属, シード」。区切りはタブ・半角カンマ・全角カンマ。
  function parseEntries(text) {
    var entries = [];
    var errors = [];
    var warnings = [];
    String(text || '').split(/\r?\n/).forEach(function (line, i) {
      if (!line.trim()) return;
      var cols = line.split(/\t|,|，/).map(function (s) { return s.trim(); });
      var name = cols[0] || '';
      var club = cols[1] || '';
      var seedStr = (cols[2] || '').normalize('NFKC');
      if (!name) {
        errors.push((i + 1) + '行目：ペア名がありません。');
        return;
      }
      var seed = null;
      if (seedStr) {
        if (!/^\d+$/.test(seedStr) || Number(seedStr) < 1) {
          errors.push((i + 1) + '行目：シードは1以上の数字で入力してください。「' + seedStr + '」は使えません。');
        } else {
          seed = Number(seedStr);
        }
      }
      entries.push({ id: 'e' + (entries.length + 1), name: name, club: club, seed: seed });
    });

    var n = entries.length;
    if (n < 2) errors.push('参加ペアは2組以上必要です。');
    if (n > MAX_ENTRIES) errors.push('参加ペアは' + MAX_ENTRIES + '組までです（現在' + n + '組）。');

    var seen = Object.create(null);
    entries.forEach(function (e) {
      if (e.seed === null) return;
      if (e.seed > n) errors.push('「' + e.name + '」のシード' + e.seed + 'が参加ペア数（' + n + '）を超えています。');
      if (seen[e.seed]) errors.push('シード' + e.seed + 'が「' + seen[e.seed] + '」と「' + e.name + '」で重複しています。');
      seen[e.seed] = e.name;
    });

    var names = Object.create(null);
    entries.forEach(function (e) {
      if (names[e.name]) warnings.push('「' + e.name + '」が2回以上入力されています。');
      names[e.name] = true;
    });

    return { entries: entries, errors: errors, warnings: warnings };
  }

  // ---------- 組み合わせ ----------

  function bracketSize(n) {
    var size = 2;
    while (size < n) size *= 2;
    return size;
  }

  // 標準的なシード配置。返り値の i 番目は、i 番目の枠に入るシード順位。
  // 第1シードを一番上、第2シードを一番下に置く。
  // 例：8枠 → [1, 8, 4, 5, 6, 3, 7, 2]
  function seedOrder(size) {
    var order = [1];
    while (order.length < size) {
      var sum = order.length * 2 + 1;
      var next = [];
      order.forEach(function (x) { next.push(x, sum - x); });
      order = next;
    }
    // 下半分を上下反転する（1回戦の組は2枠単位なので崩れない）
    return order.slice(0, size / 2).concat(order.slice(size / 2).reverse());
  }

  // 枠 i と枠 j のペアが勝ち上がった場合に対戦する回戦（1 = 1回戦）
  function meetRound(i, j) {
    var x = i ^ j;
    var r = 0;
    while (x > 0) { r++; x >>= 1; }
    return r;
  }

  function shuffle(arr, rng) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  // 同じ所属どうしが早い回戦で当たるほど大きくなるコスト。
  // 1回戦で当たる組は、2回戦以降で当たる組の何組分よりも重く数える。
  function clubCost(slots, clubOf, rounds) {
    var cost = 0;
    for (var i = 0; i < slots.length; i++) {
      if (slots[i] === null) continue;
      var ci = clubOf[slots[i]];
      if (!ci) continue;
      for (var j = i + 1; j < slots.length; j++) {
        if (slots[j] !== null && clubOf[slots[j]] === ci) {
          cost += Math.pow(1000, rounds - meetRound(i, j));
        }
      }
    }
    return cost;
  }

  function costAt(slots, pos, clubOf, rounds) {
    var id = slots[pos];
    var c = id === null ? '' : clubOf[id];
    if (!c) return 0;
    var cost = 0;
    for (var j = 0; j < slots.length; j++) {
      if (j !== pos && slots[j] !== null && clubOf[slots[j]] === c) {
        cost += Math.pow(1000, rounds - meetRound(pos, j));
      }
    }
    return cost;
  }

  // 組み合わせを作る。シードは標準位置に固定し、BYE は上位シードの相手枠に置く。
  // シードなしのペアは、同じ所属が早い回戦で当たらないよう入れ替えを繰り返して配置する。
  function generateBracket(entries, rng) {
    rng = rng || Math.random;
    var n = entries.length;
    var size = bracketSize(n);
    var rounds = Math.log2(size);
    var order = seedOrder(size);
    var clubOf = Object.create(null);
    entries.forEach(function (e) { clubOf[e.id] = e.club; });

    var base = order.map(function () { return null; });
    var free = [];
    order.forEach(function (rank, i) {
      if (rank > n) return; // BYE 枠
      var seeded = entries.filter(function (e) { return e.seed === rank; })[0];
      if (seeded) base[i] = seeded.id;
      else free.push(i);
    });
    var unseeded = entries.filter(function (e) { return e.seed === null; }).map(function (e) { return e.id; });

    var best = null;
    var bestCost = Infinity;
    // ponytail: 入れ替えの総当たりなので、参加ペアが数百組になると遅い。その場合は焼きなまし法などに変える。
    var restarts = n <= 32 ? 30 : 10;
    for (var r = 0; r < restarts; r++) {
      var slots = base.slice();
      var ids = shuffle(unseeded.slice(), rng);
      free.forEach(function (pos, k) { slots[pos] = ids[k]; });

      var improved = true;
      while (improved) {
        improved = false;
        for (var a = 0; a < free.length; a++) {
          for (var b = a + 1; b < free.length; b++) {
            var pa = free[a], pb = free[b];
            if (clubOf[slots[pa]] === clubOf[slots[pb]]) continue;
            var before = costAt(slots, pa, clubOf, rounds) + costAt(slots, pb, clubOf, rounds);
            swap(slots, pa, pb);
            var after = costAt(slots, pa, clubOf, rounds) + costAt(slots, pb, clubOf, rounds);
            if (after < before) improved = true;
            else swap(slots, pa, pb);
          }
        }
      }
      var cost = clubCost(slots, clubOf, rounds);
      if (cost < bestCost) { bestCost = cost; best = slots; }
    }
    return { size: size, slots: best };
  }

  function swap(arr, i, j) { var t = arr[i]; arr[i] = arr[j]; arr[j] = t; }

  // 1回戦で同じ所属どうしが当たっている組を返す
  function firstRoundClubClashes(bracket, entries) {
    var byId = indexEntries(entries);
    var clashes = [];
    for (var i = 0; i < bracket.slots.length; i += 2) {
      var a = byId[bracket.slots[i]], b = byId[bracket.slots[i + 1]];
      if (a && b && a.club && a.club === b.club) clashes.push([a, b]);
    }
    return clashes;
  }

  // 実在するペアどうしの入れ替えだけを許す（BYE の位置は変えない）
  function swapSlots(bracket, i, j) {
    if (bracket.slots[i] === null || bracket.slots[j] === null || i === j) return false;
    swap(bracket.slots, i, j);
    return true;
  }

  // ---------- 試合一覧 ----------

  // 試合番号は回戦順・山の上から順。order（試合idの配列）を渡すとその順に番号を振る。
  // BYE による不戦勝は試合に数えない。
  // 返り値の nodes[r][k] は r 回戦（1始まり）の k 番目の山の結節点。
  function buildMatches(bracket, order) {
    var size = bracket.size;
    var rounds = Math.log2(size);
    var nodes = [null];
    var matches = [];
    var no = 0;
    for (var r = 1; r <= rounds; r++) {
      nodes[r] = [];
      var count = size / Math.pow(2, r);
      for (var k = 0; k < count; k++) {
        var sides, entriesBelow;
        if (r === 1) {
          var a = bracket.slots[2 * k], b = bracket.slots[2 * k + 1];
          if (a === null || b === null) {
            nodes[r][k] = { kind: 'walkover', entryId: a === null ? b : a, entriesBelow: [a === null ? b : a] };
            continue;
          }
          sides = [{ type: 'entry', entryId: a }, { type: 'entry', entryId: b }];
          entriesBelow = [a, b];
        } else {
          var ca = nodes[r - 1][2 * k], cb = nodes[r - 1][2 * k + 1];
          sides = [ca, cb].map(function (c) {
            return c.kind === 'walkover' ? { type: 'entry', entryId: c.entryId } : { type: 'winner', matchId: c.id };
          });
          entriesBelow = ca.entriesBelow.concat(cb.entriesBelow);
        }
        var m = { kind: 'match', id: 'r' + r + 'm' + k, no: ++no, round: r, index: k, sides: sides, entriesBelow: entriesBelow };
        nodes[r][k] = m;
        matches.push(m);
      }
    }
    if (order && order.length === matches.length) {
      var pos = {};
      order.forEach(function (id, i) { pos[id] = i + 1; });
      if (matches.every(function (m) { return pos[m.id]; })) {
        matches.forEach(function (m) { m.no = pos[m.id]; });
        matches.sort(function (a, b) { return a.no - b.no; });
      }
    }
    return { rounds: rounds, nodes: nodes, matches: matches };
  }

  function roundName(round, rounds) {
    if (round === rounds) return '決勝';
    if (round === rounds - 1) return '準決勝';
    if (round === rounds - 2) return '準々決勝';
    return round + '回戦';
  }

  // ---------- 日程と審判 ----------

  function parseTime(s) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(s || ''));
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
    return Number(m[1]) * 60 + Number(m[2]);
  }

  function formatTime(min) {
    var h = Math.floor(min / 60) % 24, m = min % 60;
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  }

  // 時間枠ごとにコートへ試合を割り当て、審判を決める。
  // opts: { courts: ['1', '2'], start: '09:00', duration: 30, restSlots: 1 }
  //   restSlots: 同じペアの試合の間に空ける時間枠の数（0なら連戦あり）
  // 試合番号は時刻・コート順に振り直す（印刷した表で番号順に試合が進むように）。
  // 返り値: { order: [試合id], rows: { 試合id: { time, court, umpire } }, warnings: [] }
  function scheduleMatches(bracket, entries, opts) {
    var built = buildMatches(bracket);
    var matches = built.matches;
    var courts = opts.courts;
    var startMin = parseTime(opts.start);
    var duration = Number(opts.duration);
    var rest = Number(opts.restSlots) || 0;
    if (!courts.length) throw new Error('コート名を1つ以上入力してください。');
    if (startMin === null) throw new Error('開始時刻は「09:00」の形で入力してください。');
    if (!(duration > 0)) throw new Error('1試合の目安時間は1分以上で入力してください。');

    var byId = indexEntries(entries);
    var byMatchId = {};
    matches.forEach(function (m) { byMatchId[m.id] = m; });

    // 時間枠とコートを決める（試合番号の小さい順に、始められる試合から詰める）
    var slotOf = {};
    var courtOf = {};
    var pending = matches.slice();
    var t = 0;
    while (pending.length) {
      var ready = pending.filter(function (m) {
        return m.sides.every(function (s) {
          return s.type === 'entry' || (slotOf[s.matchId] !== undefined && slotOf[s.matchId] + 1 + rest <= t);
        });
      }).slice(0, courts.length);
      ready.forEach(function (m, c) { slotOf[m.id] = t; courtOf[m.id] = c; });
      pending = pending.filter(function (m) { return slotOf[m.id] === undefined; });
      t++;
      if (t > 10000) throw new Error('日程を組めませんでした。');
    }

    // 各ペアが最初に試合をする時間枠（審判を頼めるのはそれより前）
    var firstPlay = {};
    matches.forEach(function (m) {
      m.sides.forEach(function (s) {
        if (s.type === 'entry') firstPlay[s.entryId] = slotOf[m.id];
      });
    });

    function clubsOf(ids) {
      var set = Object.create(null);
      ids.forEach(function (id) { if (byId[id] && byId[id].club) set[byId[id].club] = true; });
      return set;
    }
    function overlap(a, b) {
      var n = 0;
      Object.keys(a).forEach(function (k) { if (b[k]) n++; });
      return n;
    }

    var ordered = matches.slice().sort(function (a, b) {
      return slotOf[a.id] - slotOf[b.id] || courtOf[a.id] - courtOf[b.id];
    });
    ordered.forEach(function (m, i) { m.no = i + 1; });
    var loserUsed = {};
    var umpCount = {};
    var umpAt = {};
    var rows = {};
    var warnings = [];

    ordered.forEach(function (m) {
      var slot = slotOf[m.id];
      var matchClubs = clubsOf(m.entriesBelow);
      var umpire = '';

      // 1. すでに終わった試合の負けたペア（同じ所属が少なく、直前に終わったものを優先）
      var losers = matches.filter(function (x) { return slotOf[x.id] < slot && !loserUsed[x.id]; })
        .map(function (x) { return { m: x, ov: overlap(clubsOf(x.entriesBelow), matchClubs) }; })
        .sort(function (a, b) { return a.ov - b.ov || slotOf[b.m.id] - slotOf[a.m.id] || a.m.no - b.m.no; });
      if (losers.length) {
        loserUsed[losers[0].m.id] = true;
        umpire = '第' + losers[0].m.no + '試合の負け';
      } else {
        // 2. その時点でまだ試合をしていないペア（審判の回数が少なく、同じ所属でなく、試合が遅いものを優先）
        var key = 's' + slot;
        umpAt[key] = umpAt[key] || {};
        var free = entries.filter(function (e) { return firstPlay[e.id] > slot && !umpAt[key][e.id]; })
          .map(function (e) {
            var c = Object.create(null); if (e.club) c[e.club] = true;
            return { e: e, ov: overlap(c, matchClubs) };
          })
          .sort(function (a, b) {
            return (umpCount[a.e.id] || 0) - (umpCount[b.e.id] || 0) || a.ov - b.ov || firstPlay[b.e.id] - firstPlay[a.e.id];
          });
        if (free.length) {
          var e = free[0].e;
          umpCount[e.id] = (umpCount[e.id] || 0) + 1;
          umpAt[key][e.id] = true;
          umpire = e.name;
        } else {
          warnings.push('第' + m.no + '試合は審判を割り当てられませんでした。試合進行表の審判欄に直接入力できます。');
        }
      }

      rows[m.id] = {
        time: formatTime(startMin + slot * duration),
        court: courts[courtOf[m.id]],
        umpire: umpire
      };
    });

    return { order: ordered.map(function (m) { return m.id; }), rows: rows, warnings: warnings };
  }

  // ---------- 表示用 ----------

  function indexEntries(entries) {
    var byId = Object.create(null);
    entries.forEach(function (e) { byId[e.id] = e; });
    return byId;
  }

  // 大会名に表の名前を付ける。大会名にすでに表の名前が入っていれば付けない。
  function titleFor(title, kind) {
    var t = String(title || '').trim();
    if (!t) return kind;
    return t.indexOf(kind) >= 0 ? t : t + ' ' + kind;
  }

  function sideLabel(side, byId, matchById) {
    if (side.type === 'entry') return byId[side.entryId] ? byId[side.entryId].name : '';
    return '第' + matchById[side.matchId].no + '試合の勝者';
  }

  // ---------- 保存データの検証 ----------

  // 読み込んだ JSON が使える形かを確かめる。問題があればエラー文を返す。
  function validateState(s) {
    if (!s || typeof s !== 'object') return 'ファイルの形式が正しくありません。';
    if (!Array.isArray(s.entries)) return '参加ペアのデータがありません。';
    var ids = Object.create(null);
    for (var i = 0; i < s.entries.length; i++) {
      var e = s.entries[i];
      if (!e || typeof e.id !== 'string' || typeof e.name !== 'string' || typeof e.club !== 'string') {
        return '参加ペアのデータが正しくありません。';
      }
      if (ids[e.id]) return '参加ペアのデータが重複しています。';
      ids[e.id] = true;
    }
    if (s.bracket) {
      if (s.entries.length < 2 || s.entries.length > MAX_ENTRIES) return '組み合わせのデータが正しくありません。';
      var b = s.bracket;
      if (!Array.isArray(b.slots) || b.slots.length !== b.size || b.size !== bracketSize(s.entries.length)) {
        return '組み合わせのデータが正しくありません。';
      }
      var used = Object.create(null);
      for (var j = 0; j < b.slots.length; j++) {
        var id = b.slots[j];
        if (id === null) continue;
        if (!ids[id] || used[id]) return '組み合わせのデータが正しくありません。';
        used[id] = true;
      }
      if (Object.keys(used).length !== s.entries.length) return '組み合わせのデータが正しくありません。';
      for (var k = 0; k < b.slots.length; k += 2) {
        if (b.slots[k] === null && b.slots[k + 1] === null) return '組み合わせのデータが正しくありません。';
      }
    }
    return null;
  }

  var api = {
    MAX_ENTRIES: MAX_ENTRIES,
    parseEntries: parseEntries,
    bracketSize: bracketSize,
    seedOrder: seedOrder,
    meetRound: meetRound,
    clubCost: clubCost,
    generateBracket: generateBracket,
    firstRoundClubClashes: firstRoundClubClashes,
    swapSlots: swapSlots,
    buildMatches: buildMatches,
    roundName: roundName,
    parseTime: parseTime,
    formatTime: formatTime,
    scheduleMatches: scheduleMatches,
    indexEntries: indexEntries,
    sideLabel: sideLabel,
    titleFor: titleFor,
    validateState: validateState
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TournamentLogic = api;
})(this);

// トーナメントの組み合わせ・試合一覧・日程と審判の割り当て（画面に依存しない処理）
// ブラウザでは window.TournamentLogic、Node では require で読み込む。
(function (root) {
  'use strict';

  var MAX_ENTRIES = 64;

  // ---------- 入力の読み取り ----------

  // 入力欄の行 [{name, club, seed}] からチームを作る。seed が true のチームがシード。
  // シード順位は入力欄の上から 1, 2, 3…。シードにできる数（枠数の半分）を超えた分は、下の行から順にシードなしにする。
  function buildEntries(rows) {
    var entries = [];
    var errors = [];
    var warnings = [];
    (rows || []).forEach(function (row, i) {
      var name = String(row.name || '').trim();
      var club = String(row.club || '').trim();
      if (!name && !club && !row.seed) return; // 空の行は無視
      if (!name) {
        errors.push((i + 1) + '行目：チーム名がありません。');
        return;
      }
      entries.push({ id: 'e' + (entries.length + 1), name: name, club: club, seed: row.seed ? 0 : null });
    });

    var n = entries.length;
    if (n < 2) errors.push('参加チームは2チーム以上必要です。');
    if (n > MAX_ENTRIES) errors.push('参加チームは' + MAX_ENTRIES + 'チームまでです（現在' + n + 'チーム）。');

    var maxSeeds = maxSeedCount(n);
    var rank = 0;
    var dropped = [];
    entries.forEach(function (e) {
      if (e.seed === null) return;
      if (rank < maxSeeds) e.seed = ++rank;
      else { e.seed = null; dropped.push(e.name); }
    });
    if (dropped.length) {
      warnings.push('シードにできるのは' + maxSeeds + 'チームまでです。入力欄の上から優先し、「' + dropped.join('」「') + '」はシードなしにしました。');
    }

    var names = Object.create(null);
    entries.forEach(function (e) {
      if (names[e.name]) warnings.push('「' + e.name + '」が2回以上入力されています。');
      names[e.name] = true;
    });

    return { entries: entries, errors: errors, warnings: warnings };
  }

  // 「チーム名, 所属, シード」を1行ずつ書いたテキストを入力行に直す（旧形式の保存データ・テスト用）。
  // 区切りはタブ・半角カンマ・全角カンマ。シードは1だけをシードとみなす（複数の行に1があれば複数シード）。
  function rowsFromText(text) {
    var rows = [];
    String(text || '').split(/\r?\n/).forEach(function (line) {
      if (!line.trim()) return;
      var cols = line.split(/\t|,|，/).map(function (s) { return s.trim(); });
      rows.push({ name: cols[0] || '', club: cols[1] || '', seed: (cols[2] || '').normalize('NFKC') === '1' });
    });
    return rows;
  }

  function parseEntries(text) {
    return buildEntries(rowsFromText(text));
  }

  // ---------- 組み合わせ ----------

  function bracketSize(n) {
    var size = 2;
    while (size < n) size *= 2;
    return size;
  }

  // シードにできるチーム数。シードは1回戦の別々の組に入れるため、1回戦の組の数（枠数の半分）まで。
  function maxSeedCount(n) {
    return bracketSize(n) / 2;
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

  // 枠 i と枠 j のチームが勝ち上がった場合に対戦する回戦（1 = 1回戦）
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

  // 組み合わせを作る。シードは標準位置に固定し（同じ所属どうしを避ける入れ替えの対象外）、BYE は上位シードの相手枠に置く。
  // シードなしのチームは、同じ所属が早い回戦で当たらないよう入れ替えを繰り返して配置する。
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
    // ponytail: 入れ替えの総当たりなので、参加チームが数百組になると遅い。その場合は焼きなまし法などに変える。
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

  // 実在するチームどうしの入れ替えだけを許す（BYE の位置は変えない）
  function swapSlots(bracket, i, j) {
    if (bracket.slots[i] === null || bracket.slots[j] === null || i === j) return false;
    swap(bracket.slots, i, j);
    return true;
  }


  // ---------- 試合一覧 ----------

  // 本戦の試合。試合番号（no）は回戦順・山の上から順の仮の番号（試合進行表を作るまで使う）。
  // BYE による不戦勝は試合に数えない。
  // 返り値の nodes[r][k] は r 回戦（1始まり）の k 番目の山の結節点。
  function buildMatches(bracket) {
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
        var m = { kind: 'match', id: 'r' + r + 'm' + k, no: ++no, round: r, stage: 'main', index: k, sides: sides, entriesBelow: entriesBelow, after: [] };
        nodes[r][k] = m;
        matches.push(m);
      }
    }
    return { rounds: rounds, nodes: nodes, matches: matches };
  }

  // 本戦に、3位決定戦と5〜8位決定戦を加えた部門の全試合（前の試合が先に並ぶ）。
  // 3位決定戦は準決勝が2試合とも行われるとき、5〜8位決定戦は準々決勝が4試合とも行われるときだけ作る。
  // 5〜8位決定戦（2試合）は決勝と3位決定戦のあと（after）に行い、その勝者で5位決定戦、敗者で7位決定戦をする。
  // sides の type は entry（チーム）・winner（勝者）・loser（敗者）。
  function divisionMatches(bracket) {
    var built = buildMatches(bracket);
    var R = built.rounds;
    var matches = built.matches;
    var no = matches.length;
    function isMatch(n) { return n && n.kind === 'match'; }
    function winner(m) { return { type: 'winner', matchId: m.id }; }
    function loser(m) { return { type: 'loser', matchId: m.id }; }
    function add(id, stage, round, sides, below, after) {
      var m = { kind: 'match', id: id, no: ++no, round: round, stage: stage, sides: sides, entriesBelow: below, after: after || [] };
      matches.push(m);
      return m;
    }

    var third = null;
    if (R >= 2 && isMatch(built.nodes[R - 1][0]) && isMatch(built.nodes[R - 1][1])) {
      var s0 = built.nodes[R - 1][0], s1 = built.nodes[R - 1][1];
      third = add('third', 'third', R, [loser(s0), loser(s1)], s0.entriesBelow.concat(s1.entriesBelow));
    }
    // 準々決勝が4試合とも行われるなら、準決勝も2試合とも行われるので third は必ずある
    if (R >= 3 && built.nodes[R - 2].every(isMatch)) {
      var q = built.nodes[R - 2];
      var after = [built.nodes[R][0].id, third.id];
      var below = q[0].entriesBelow.concat(q[1].entriesBelow, q[2].entriesBelow, q[3].entriesBelow);
      var a = add('p58m0', 'place58', R + 1, [loser(q[0]), loser(q[1])], q[0].entriesBelow.concat(q[1].entriesBelow), after);
      var b = add('p58m1', 'place58', R + 1, [loser(q[2]), loser(q[3])], q[2].entriesBelow.concat(q[3].entriesBelow), after);
      add('p5', 'place5', R + 2, [winner(a), winner(b)], below);
      add('p7', 'place7', R + 2, [loser(a), loser(b)], below);
    }
    return { rounds: R, nodes: built.nodes, matches: matches };
  }

  function roundName(round, rounds) {
    if (round === rounds) return '決勝';
    if (round === rounds - 1) return '準決勝';
    if (round === rounds - 2) return '準々決勝';
    return round + '回戦';
  }

  var STAGE_NAMES = { third: '3位決定戦', place58: '5〜8位決定戦', place5: '5位決定戦', place7: '7位決定戦' };

  function matchName(m, rounds) {
    return m.stage === 'main' ? roundName(m.round, rounds) : STAGE_NAMES[m.stage];
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

  // 「負けた2ペアから1人ずつ」にする回戦。値は決勝から何回戦さかのぼるか。
  var PAIR_FROM = { qf: 2, sf: 1 };

  function matchKey(divisionId, matchId) { return divisionId + ':' + matchId; }

  // 全部門の試合を一覧にする。key は「部門id:試合id」。組み合わせのない部門は飛ばす。
  function eventMatches(divisions) {
    var items = [];
    divisions.forEach(function (d, di) {
      if (!d.bracket) return;
      var dm = divisionMatches(d.bracket);
      var byId = indexEntries(d.entries);
      dm.matches.forEach(function (m) {
        items.push({ key: matchKey(d.id, m.id), div: d, divIndex: di, m: m, rounds: dm.rounds, byId: byId });
      });
    });
    return items;
  }

  // 試合 m の前に終わっていなければならない試合の id
  function prerequisites(m) {
    var ids = m.after.slice();
    m.sides.forEach(function (s) { if (s.type !== 'entry') ids.push(s.matchId); });
    return ids;
  }

  // 全部門の試合を時間枠（対戦順）ごとにコートへ割り当て、審判を決める。
  // 空いたコートには、どの部門でも始められる試合を入れる。進み具合の遅れている部門から先に入れ、
  // 同じ部門の試合は、なるべくその部門が直前に使ったコートに入れる。
  // divisions: [{ id, entries, bracket }]
  // opts: { courts: ['1', …], start: '09:00', duration: 30, restSlots: 1, pairFrom: 'qf' | 'sf' }
  //   restSlots: 同じチームの試合の間に空ける時間枠の数（0なら連戦あり）
  // 試合番号は全部門の通し番号で、対戦順・コート順に振る。
  // 返り値: { courts, slotTimes: ['09:00', …], matches: { key: { slot, court, no, umpire } }, warnings }
  //   court はコートの番号（courts の何番目か、0始まり）
  function scheduleEvent(divisions, opts) {
    var courts = opts.courts;
    var startMin = parseTime(opts.start);
    var duration = Number(opts.duration);
    var rest = Number(opts.restSlots) || 0;
    var pairBack = PAIR_FROM[opts.pairFrom] || PAIR_FROM.qf;
    if (!courts.length) throw new Error('コート名を1つ以上入力してください。');
    if (startMin === null) throw new Error('開始時刻は「09:00」の形で入力してください。');
    if (!(duration > 0)) throw new Error('1試合の目安時間は1分以上で入力してください。');

    var items = eventMatches(divisions);
    if (!items.length) throw new Error('試合がありません。各部門で「組み合わせを作成」を押すと、その部門の試合が追加されます。');
    var byKey = {};
    items.forEach(function (it) { byKey[it.key] = it; });
    function refKey(it, matchId) { return matchKey(it.div.id, matchId); }

    // 後に続く試合の連なりの長さ（長い試合ほど先に入れないと全体が遅れる）
    var height = {};
    items.slice().reverse().forEach(function (it) {
      if (height[it.key] === undefined) height[it.key] = 1;
      prerequisites(it.m).forEach(function (id) {
        var k = refKey(it, id);
        height[k] = Math.max(height[k] || 1, height[it.key] + 1);
      });
    });
    var total = {}, done = {};
    items.forEach(function (it) { total[it.div.id] = (total[it.div.id] || 0) + 1; done[it.div.id] = 0; });

    // ---- 時間枠とコート ----
    var slotOf = {}, courtOf = {};
    var lastDiv = courts.map(function () { return null; });
    var pending = items.slice();
    var blocked = {};
    var t = 0;
    // 時間枠 t に試合 it を入れるとき、同じ部門で審判を出せそうなペアの数（おおよそ）。
    // chosen は t にすでに入れた試合。終わった試合の敗者（t に試合をしないもの）と、まだ試合をしていないチームを数える。
    // 5〜8位決定戦などは、決勝・3位決定戦に出たペアを数える。
    function umpireSources(it, chosen) {
      var now = chosen.concat([it]);
      var playingNow = {};
      var played = {};
      now.forEach(function (c) {
        c.m.sides.forEach(function (s) {
          if (s.type === 'loser') playingNow[refKey(c, s.matchId)] = true;
          if (s.type === 'entry') played[s.entryId] = true;
        });
      });
      var n = 0;
      items.forEach(function (x) {
        if (x.div !== it.div || slotOf[x.key] === undefined) return;
        x.m.sides.forEach(function (s) { if (s.type === 'entry') played[s.entryId] = true; });
        var finished = slotOf[x.key] < t;
        if (it.m.stage.indexOf('place') === 0) {
          if (finished && (x.m.stage === 'third' || (x.m.stage === 'main' && x.m.round === x.rounds))) n += 2;
        } else if (finished && x.m.stage === 'main' && !playingNow[x.key]) {
          n++;
        }
      });
      if (it.m.stage.indexOf('place') !== 0) {
        it.div.entries.forEach(function (e) { if (!played[e.id]) n++; });
      }
      return n;
    }
    while (pending.length) {
      var ready = pending.filter(function (it) {
        var playersReady = it.m.sides.every(function (s) {
          if (s.type === 'entry') return true;
          var p = slotOf[refKey(it, s.matchId)];
          return p !== undefined && p + 1 + rest <= t;
        });
        var afterDone = it.m.after.every(function (id) {
          var p = slotOf[refKey(it, id)];
          return p !== undefined && p < t;
        });
        return playersReady && afterDone;
      });
      // まだ試合をしていない部門 → 後に続く試合の連なりが長い試合 → 進み具合の遅れている部門の順
      ready.sort(function (a, b) {
        return (done[a.div.id] ? 1 : 0) - (done[b.div.id] ? 1 : 0) || height[b.key] - height[a.key] ||
          done[a.div.id] / total[a.div.id] - done[b.div.id] / total[b.div.id] || a.divIndex - b.divIndex || a.m.no - b.m.no;
      });
      // 同じ時間枠に同じ部門の試合が入っていて、審判を出せるチームが足りない試合は、次の時間枠に回す
      // （その試合が終われば敗者が審判を出せる）。同じ部門の試合が入っていなければ、待っても審判は増えないので回さない。
      // 通算2回回した試合は、審判がいなくても入れる。
      var chosen = [];
      ready.forEach(function (it) {
        if (chosen.length >= courts.length) return;
        var sameDiv = chosen.filter(function (c) { return c.div === it.div; }).length;
        if ((blocked[it.key] || 0) < 2 && sameDiv > 0 && umpireSources(it, chosen) <= sameDiv) {
          blocked[it.key] = (blocked[it.key] || 0) + 1;
          return;
        }
        chosen.push(it);
      });
      var used = {};
      var placed = {};
      // 同じ部門が最後に使ったコートを優先し、残りは空いているコートに入れる
      chosen.forEach(function (it) {
        for (var c = 0; c < courts.length; c++) {
          if (!used[c] && lastDiv[c] === it.div.id) { used[c] = true; placed[it.key] = c; return; }
        }
      });
      chosen.forEach(function (it) {
        if (placed[it.key] !== undefined) return;
        var c = -1;
        for (var i = 0; i < courts.length && c < 0; i++) if (!used[i] && lastDiv[i] === null) c = i;
        for (var j = 0; j < courts.length && c < 0; j++) if (!used[j]) c = j;
        used[c] = true;
        placed[it.key] = c;
      });
      chosen.forEach(function (it) {
        slotOf[it.key] = t;
        courtOf[it.key] = placed[it.key];
        lastDiv[placed[it.key]] = it.div.id;
        done[it.div.id]++;
      });
      pending = pending.filter(function (it) { return slotOf[it.key] === undefined; });
      t++;
      if (t > 10000) throw new Error('日程を組めませんでした。');
    }

    var ordered = items.slice().sort(function (a, b) {
      return slotOf[a.key] - slotOf[b.key] || courtOf[a.key] - courtOf[b.key];
    });
    var noOf = {};
    ordered.forEach(function (it, i) { noOf[it.key] = i + 1; });

    // ---- 審判 ----
    // 審判を出す相手（source）は次のどれか。
    //   'L:key' = その試合の敗者、'W:key' = その試合の勝者、'E:部門id:チームid' = まだ試合をしていないチーム
    function sideSource(it, s) {
      if (s.type === 'entry') return 'E:' + matchKey(it.div.id, s.entryId);
      return (s.type === 'winner' ? 'W:' : 'L:') + refKey(it, s.matchId);
    }
    var appears = {}; // source → その source が出る試合の key
    items.forEach(function (it) {
      it.m.sides.forEach(function (s) {
        var src = sideSource(it, s);
        (appears[src] = appears[src] || []).push(it.key);
      });
    });
    // その source のチームが試合をする（かもしれない）時間枠
    var busyMemo = {};
    function busy(src) {
      if (busyMemo[src]) return busyMemo[src];
      var set = {};
      (appears[src] || []).forEach(function (k) {
        set[slotOf[k]] = true;
        [busy('W:' + k), busy('L:' + k)].forEach(function (s) { Object.keys(s).forEach(function (x) { set[x] = true; }); });
      });
      busyMemo[src] = set;
      return set;
    }
    function firstPlay(src) {
      return Math.min.apply(null, Object.keys(busy(src)).map(Number));
    }
    function origin(src) { return src.charAt(0) === 'E' ? null : byKey[src.slice(2)]; }
    function usable(src, slot, umpAt) {
      if (umpAt[src] || busy(src)[slot]) return false;
      var o = origin(src);
      return o ? slotOf[o.key] < slot : firstPlay(src) > slot;
    }
    function clubsOf(byId, ids) {
      var set = Object.create(null);
      ids.forEach(function (id) { if (byId[id] && byId[id].club) set[byId[id].club] = true; });
      return set;
    }
    function overlap(a, b) {
      var n = 0;
      Object.keys(a).forEach(function (k) { if (b[k]) n++; });
      return n;
    }
    function label(src) {
      var o = origin(src);
      if (o) return '第' + noOf[o.key] + '試合の' + (src.charAt(0) === 'W' ? '勝者' : '敗者');
      return entryNames[src];
    }

    // 審判の表示。2組から1人ずつのときは短くまとめる。
    //   同じ試合の勝者と敗者 →「第25試合の両チームから1人ずつ」
    //   2つの試合の敗者（または勝者）→「第11・13試合の敗者から1人ずつ」
    function umpireLabel(picked) {
      if (!picked.length) return '';
      if (picked.length === 1) return label(picked[0]);
      var o = picked.map(origin);
      if (o[0] && o[1]) {
        var n = [noOf[o[0].key], noOf[o[1].key]];
        var kind = [picked[0].charAt(0), picked[1].charAt(0)];
        if (n[0] === n[1]) return '第' + n[0] + '試合の両チームから1人ずつ';
        if (kind[0] === kind[1]) {
          n.sort(function (a, b) { return a - b; });
          return '第' + n[0] + '・' + n[1] + '試合の' + (kind[0] === 'W' ? '勝者' : '敗者') + 'から1人ずつ';
        }
      }
      return picked.map(label).join('、') + 'から1人ずつ';
    }

    // 部門ごとの source の一覧
    var pools = {};
    var entryNames = {};
    items.forEach(function (it) {
      var p = pools[it.div.id];
      if (!p) {
        p = pools[it.div.id] = { mainLosers: [], qfLosers: [], best4: [], entries: [] };
        it.div.entries.forEach(function (e) {
          var src = 'E:' + matchKey(it.div.id, e.id);
          p.entries.push(src);
          entryNames[src] = e.name;
        });
      }
      var m = it.m;
      if (m.stage === 'main') {
        p.mainLosers.push('L:' + it.key);
        if (m.round === it.rounds - 2) p.qfLosers.push('L:' + it.key);
        if (m.round === it.rounds) p.best4.push('W:' + it.key, 'L:' + it.key);
      } else if (m.stage === 'third') {
        p.best4.push('W:' + it.key, 'L:' + it.key);
      }
    });

    var uses = {};
    var rows = {};
    var warnings = [];
    function unused(list) { return list.filter(function (s) { return !uses[s]; }); }
    // 審判を探す候補の一覧（前の一覧から順に探す）と、出してもらうペアの数
    function plan(it) {
      var m = it.m;
      var p = pools[it.div.id];
      if (m.stage === 'main' && m.round < it.rounds) {
        return { tiers: [unused(p.mainLosers), p.entries, p.mainLosers], need: m.round >= it.rounds - pairBack ? 2 : 1 };
      }
      if (m.stage === 'main' || m.stage === 'third') return { tiers: [p.qfLosers, p.mainLosers, p.entries], need: 2 };
      return { tiers: [p.best4], need: 2 };
    }
    function score(it, src) {
      var o = origin(src);
      var slot = slotOf[it.key];
      var sameCourt = o && slotOf[o.key] === slot - 1 && courtOf[o.key] === courtOf[it.key] ? 1 : 0;
      var clubs = o ? clubsOf(it.byId, o.m.entriesBelow) : clubsOf(it.byId, [src.slice(src.lastIndexOf(':') + 1)]);
      return { uses: uses[src] || 0, sameCourt: sameCourt, ov: overlap(clubs, clubsOf(it.byId, it.m.entriesBelow)), recent: o ? slotOf[o.key] : firstPlay(src) };
    }
    // 候補の一覧から、条件に合う相手を1組選ぶ（審判の回数が少ない → 同じコートの直前の試合 → 所属が重ならない → 最近の順）
    function pickOne(it, umpAt, picked) {
      var tiers = plan(it).tiers;
      for (var i = 0; i < tiers.length; i++) {
        var cands = tiers[i].filter(function (s) { return picked.indexOf(s) < 0 && usable(s, slotOf[it.key], umpAt); })
          .map(function (s) { return { s: s, sc: score(it, s) }; })
          .sort(function (a, b) {
            return a.sc.uses - b.sc.uses || b.sc.sameCourt - a.sc.sameCourt || a.sc.ov - b.sc.ov ||
              b.sc.recent - a.sc.recent || (a.s < b.s ? -1 : a.s > b.s ? 1 : 0);
          });
        if (cands.length) return cands[0].s;
      }
      return null;
    }

    // 同じ時間枠の試合には、まず1組ずつ割り当ててから、2組目が要る試合に足す
    for (var slot = 0; slot < t; slot++) {
      var inSlot = ordered.filter(function (it) { return slotOf[it.key] === slot; });
      var umpAt = {};
      var pickedOf = {};
      [1, 2].forEach(function (pass) {
        inSlot.forEach(function (it) {
          var picked = pickedOf[it.key] = pickedOf[it.key] || [];
          if (plan(it).need < pass || picked.length !== pass - 1) return;
          var src = pickOne(it, umpAt, picked);
          if (!src) return;
          picked.push(src);
          uses[src] = (uses[src] || 0) + 1;
          umpAt[src] = true;
        });
      });
      inSlot.forEach(function (it) {
        var picked = pickedOf[it.key];
        if (!picked.length) {
          warnings.push('第' + noOf[it.key] + '試合は審判を割り当てられませんでした。試合進行表の審判欄に直接入力できます。');
        }
        rows[it.key] = {
          slot: slot,
          court: courtOf[it.key],
          no: noOf[it.key],
          umpire: umpireLabel(picked)
        };
      });
    }

    var slotTimes = [];
    for (var s = 0; s < t; s++) slotTimes.push(formatTime(startMin + s * duration));
    return { courts: courts.slice(), slotTimes: slotTimes, matches: rows, warnings: warnings };
  }

  // 試合進行表の並びを確かめる。前の試合（勝者・敗者が出る試合、5〜8位決定戦の前の決勝など）より
  // 後の対戦順になっていない試合と、試合進行表に入っていない試合を知らせる。
  function checkSchedule(divisions, schedule) {
    var warnings = [];
    var missing = [];
    eventMatches(divisions).forEach(function (it) {
      var r = schedule.matches[it.key];
      if (!r) {
        if (missing.indexOf(it.div) < 0) missing.push(it.div);
        return;
      }
      prerequisites(it.m).forEach(function (id) {
        var p = schedule.matches[matchKey(it.div.id, id)];
        if (p && p.slot >= r.slot) {
          warnings.push('第' + r.no + '試合が、先に終わる必要のある第' + p.no + '試合と同じか、それより前の対戦順になっています。');
        }
      });
    });
    missing.forEach(function (d) {
      warnings.push('「' + (d.name || '名前なし') + '」の試合が試合進行表に含まれていません。「日程を自動作成」を押すと追加されます。');
    });
    return warnings;
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

  // nos: { 試合id: 試合番号 }
  function sideLabel(side, byId, nos) {
    if (side.type === 'entry') return byId[side.entryId] ? byId[side.entryId].name : '';
    return '第' + nos[side.matchId] + '試合の' + (side.type === 'winner' ? '勝者' : '敗者');
  }

  // ---------- 保存データの検証 ----------

  var MAX_DIVISIONS = 30;

  // 1部門ぶん（entries, bracket）のデータを確かめる。問題があればエラー文を返す。
  function validateDivision(s) {
    if (!Array.isArray(s.entries)) return '参加チームのデータがありません。';
    var ids = Object.create(null);
    for (var i = 0; i < s.entries.length; i++) {
      var e = s.entries[i];
      if (!e || typeof e.id !== 'string' || typeof e.name !== 'string' || typeof e.club !== 'string') {
        return '参加チームのデータが正しくありません。';
      }
      if (ids[e.id]) return '参加チームのデータが重複しています。';
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

  // 読み込んだ JSON が使える形かを確かめる。問題があればエラー文を返す。
  // 部門のある形（divisions）と、部門のない以前の形（entries, bracket）のどちらも受け付ける。
  function validateState(s) {
    if (!s || typeof s !== 'object') return 'ファイルの形式が正しくありません。';
    if (!Array.isArray(s.divisions)) return validateDivision(s);
    if (!s.divisions.length || s.divisions.length > MAX_DIVISIONS) return '部門のデータが正しくありません。';
    var ids = Object.create(null);
    for (var i = 0; i < s.divisions.length; i++) {
      var d = s.divisions[i];
      if (!d || typeof d.id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(d.id) || ids[d.id] || typeof d.name !== 'string') {
        return '部門のデータが正しくありません。';
      }
      ids[d.id] = true;
      var err = validateDivision(d);
      if (err) return '「' + d.name + '」：' + err;
    }
    return null;
  }

  // 保存した試合進行表が今の組み合わせで使えるかを確かめる。
  // 組み合わせを作り直して試合がなくなった場合なども使えないとみなす（試合が足りないだけなら使える）。
  function validSchedule(sc, divisions) {
    if (!sc || typeof sc !== 'object') return false;
    if (!Array.isArray(sc.courts) || !sc.courts.length || !sc.courts.every(function (c) { return typeof c === 'string'; })) return false;
    if (!Array.isArray(sc.slotTimes) || !sc.slotTimes.every(function (x) { return typeof x === 'string'; })) return false;
    if (!sc.matches || typeof sc.matches !== 'object' || Array.isArray(sc.matches)) return false;
    var keys = Object.create(null);
    eventMatches(divisions).forEach(function (it) { keys[it.key] = true; });
    var cells = Object.create(null);
    var nos = Object.create(null);
    return Object.keys(sc.matches).every(function (k) {
      var r = sc.matches[k];
      if (!keys[k] || !r || typeof r.umpire !== 'string') return false;
      if (!(Number.isInteger(r.slot) && r.slot >= 0 && r.slot < sc.slotTimes.length)) return false;
      if (!(Number.isInteger(r.court) && r.court >= 0 && r.court < sc.courts.length)) return false;
      if (!(Number.isInteger(r.no) && r.no > 0) || nos[r.no]) return false;
      var cell = r.slot + ':' + r.court;
      if (cells[cell]) return false;
      cells[cell] = true;
      nos[r.no] = true;
      return true;
    });
  }

  var api = {
    MAX_ENTRIES: MAX_ENTRIES,
    MAX_DIVISIONS: MAX_DIVISIONS,
    parseEntries: parseEntries,
    buildEntries: buildEntries,
    rowsFromText: rowsFromText,
    bracketSize: bracketSize,
    maxSeedCount: maxSeedCount,
    seedOrder: seedOrder,
    meetRound: meetRound,
    clubCost: clubCost,
    generateBracket: generateBracket,
    firstRoundClubClashes: firstRoundClubClashes,
    swapSlots: swapSlots,
    buildMatches: buildMatches,
    divisionMatches: divisionMatches,
    eventMatches: eventMatches,
    prerequisites: prerequisites,
    matchKey: matchKey,
    roundName: roundName,
    matchName: matchName,
    parseTime: parseTime,
    formatTime: formatTime,
    scheduleEvent: scheduleEvent,
    checkSchedule: checkSchedule,
    indexEntries: indexEntries,
    sideLabel: sideLabel,
    titleFor: titleFor,
    validateState: validateState,
    validSchedule: validSchedule
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TournamentLogic = api;
})(this);

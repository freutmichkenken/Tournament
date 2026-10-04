'use strict';
const test = require('node:test');
const assert = require('node:assert');
const L = require('../js/logic.js');

// 再現できる乱数
function seededRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function makeEntries(clubSizes) {
  const lines = [];
  Object.keys(clubSizes).forEach((club) => {
    for (let i = 1; i <= clubSizes[club]; i++) lines.push(`${club}${i}, ${club}`);
  });
  return L.parseEntries(lines.join('\n')).entries;
}

test('seedOrder は標準のシード配置になる', () => {
  assert.deepStrictEqual(L.seedOrder(8), [1, 8, 4, 5, 6, 3, 7, 2]);
  // 16枠：第1は1番、第2は16番、第3・第4は5番と12番（1始まり）
  const o16 = L.seedOrder(16);
  assert.deepStrictEqual([1, 2, 3, 4].map((r) => o16.indexOf(r) + 1), [1, 16, 12, 5]);
  // 1回戦の組の順位の和は常に枠数+1
  for (let i = 0; i < 16; i += 2) assert.strictEqual(o16[i] + o16[i + 1], 17);
  assert.deepStrictEqual(L.seedOrder(2), [1, 2]);
});

test('parseEntries はタブ・カンマ区切りと第1シードを読み取る', () => {
  const r = L.parseEntries('山田・佐藤\tA高\t１\n\n鈴木・田中，B高\n高橋・伊藤,C高');
  assert.deepStrictEqual(r.errors, []);
  assert.strictEqual(r.entries.length, 3);
  assert.deepStrictEqual(r.entries[0], { id: 'e1', name: '山田・佐藤', club: 'A高', seed: 1 });
  assert.strictEqual(r.entries[1].club, 'B高');
  assert.strictEqual(r.entries[2].seed, null);
});

test('Object の組み込み名と同じペア名・所属でも誤判定しない', () => {
  const r = L.parseEntries('toString, constructor\n__proto__, hasOwnProperty');
  assert.deepStrictEqual(r.warnings, []);
  assert.deepStrictEqual(r.errors, []);
  const b = L.generateBracket(r.entries, seededRng(1));
  assert.strictEqual(L.validateState({ entries: r.entries, bracket: b }), null);
});

test('buildEntries はシードのチェックを読み取り、上の行から順位を付ける', () => {
  const ok = L.buildEntries([{ name: 'a', club: 'x', seed: true }, { name: 'b', club: 'y', seed: false }, { name: '', club: '', seed: false }]);
  assert.deepStrictEqual(ok.errors, []);
  assert.deepStrictEqual(ok.entries.map((e) => e.seed), [1, null]);
  const multi = L.buildEntries([{ name: 'a', seed: false }, { name: 'b', seed: true }, { name: 'c', seed: true }, { name: 'd' }]);
  assert.deepStrictEqual(multi.errors, []);
  assert.deepStrictEqual(multi.entries.map((e) => e.seed), [null, 1, 2, null]);
  assert.ok(L.buildEntries([{ name: '', club: 'x' }, { name: 'b' }, { name: 'c' }]).errors.length > 0);
  assert.ok(L.buildEntries([{ name: 'a' }]).errors.length > 0);
});

test('シードが多すぎるときは入力欄の上から優先し、超えた分はシードなしにする', () => {
  // 4チーム＝4枠なのでシードは2チームまで
  const r = L.buildEntries(['a', 'b', 'c', 'd'].map((name) => ({ name, club: name, seed: true })));
  assert.deepStrictEqual(r.errors, []);
  assert.deepStrictEqual(r.entries.map((e) => e.seed), [1, 2, null, null]);
  assert.strictEqual(r.warnings.length, 1);
  assert.ok(r.warnings[0].includes('「c」「d」'));
});

test('同じ所属のシードどうしでも、シードの位置は動かさない', () => {
  const rows = [];
  for (let i = 0; i < 8; i++) rows.push({ name: 't' + i, club: i < 4 ? 'A' : 'B', seed: i < 4 });
  const r = L.buildEntries(rows);
  for (let s = 1; s <= 10; s++) {
    const b = L.generateBracket(r.entries, seededRng(s));
    L.seedOrder(8).forEach((rank, i) => {
      const e = r.entries.find((x) => x.seed === rank);
      if (e) assert.strictEqual(b.slots[i], e.id);
    });
  }
});

test('20組なら32枠・BYE12で、BYEどうしは当たらない', () => {
  const entries = makeEntries({ A: 6, B: 5, C: 4, D: 3, E: 2 });
  const b = L.generateBracket(entries, seededRng(1));
  assert.strictEqual(b.size, 32);
  assert.strictEqual(b.slots.filter((x) => x === null).length, 12);
  for (let i = 0; i < 32; i += 2) assert.ok(b.slots[i] !== null || b.slots[i + 1] !== null);
  assert.strictEqual(new Set(b.slots.filter((x) => x)).size, 20);
});

test('同じ所属が1回戦で当たらない（多数の乱数で確認）', () => {
  const entries = makeEntries({ A: 6, B: 5, C: 4, D: 3, E: 2 });
  for (let seed = 1; seed <= 30; seed++) {
    const b = L.generateBracket(entries, seededRng(seed));
    assert.deepStrictEqual(L.firstRoundClubClashes(b, entries), [], `seed=${seed}`);
  }
});

test('人数の多い所属は山の左右と4分の1に散らばる', () => {
  const entries = makeEntries({ A: 4, B: 16 });
  const b = L.generateBracket(entries, seededRng(3));
  const quarters = new Set();
  b.slots.forEach((id, i) => {
    if (id && entries.find((e) => e.id === id).club === 'A') quarters.add(Math.floor(i / 8));
  });
  assert.strictEqual(quarters.size, 4);
});

test('避けられない場合は1回戦の同所属対戦が検出される', () => {
  const entries = makeEntries({ A: 4 });
  const b = L.generateBracket(entries, seededRng(1));
  assert.strictEqual(L.firstRoundClubClashes(b, entries).length, 2);
});

test('シードは標準位置に置かれ、上位シードがBYEになる', () => {
  const r = L.parseEntries(['s1,A,1', 's2,B,1', 'x,C', 'y,D', 'z,E'].join('\n'));
  const b = L.generateBracket(r.entries, seededRng(1));
  assert.strictEqual(b.slots[0], 'e1');
  assert.strictEqual(b.slots[1], null);
  assert.strictEqual(b.slots[7], 'e2');
  assert.strictEqual(b.slots[6], null);
});

test('試合数は参加ペア数-1', () => {
  [2, 3, 5, 16, 17, 20, 64].forEach((n) => {
    const entries = makeEntries({ A: n });
    const b = L.generateBracket(entries, seededRng(n));
    assert.strictEqual(L.buildMatches(b).matches.length, n - 1, `n=${n}`);
  });
});

test('swapSlots はBYEとは入れ替えない', () => {
  const b = { size: 4, slots: ['e1', null, 'e2', 'e3'] };
  assert.strictEqual(L.swapSlots(b, 0, 1), false);
  assert.strictEqual(L.swapSlots(b, 0, 3), true);
  assert.deepStrictEqual(b.slots, ['e3', null, 'e2', 'e1']);
});

function makeDivisions(sizes, seed) {
  const rng = seededRng(seed);
  return sizes.map((n, i) => {
    const rows = [];
    for (let k = 0; k < n; k++) rows.push({ name: `d${i}-${k}`, club: 'C' + (k % 4), seed: k < 2 });
    const entries = L.buildEntries(rows).entries;
    return { id: 'd' + (i + 1), name: '部門' + (i + 1), entries, bracket: n >= 2 ? L.generateBracket(entries, rng) : null };
  });
}

const EIGHT = ['1', '2', '3', '4', '5', '6', '7', '8'];

// 審判の表示を、1組ずつ（「第○試合の敗者」またはチーム名）に分ける
function umpireParts(u) {
  let m = /^第(\d+)・(\d+)試合の(敗者|勝者)から1人ずつ$/.exec(u);
  if (m) return [`第${m[1]}試合の${m[3]}`, `第${m[2]}試合の${m[3]}`];
  m = /^第(\d+)試合の両チームから1人ずつ$/.exec(u);
  if (m) return [`第${m[1]}試合の勝者`, `第${m[1]}試合の敗者`];
  return u.endsWith('から1人ずつ') ? u.slice(0, -'から1人ずつ'.length).split('、') : [u];
}

test('審判の表示を短くまとめる', () => {
  assert.deepStrictEqual(umpireParts('第11・13試合の敗者から1人ずつ'), ['第11試合の敗者', '第13試合の敗者']);
  assert.deepStrictEqual(umpireParts('第25試合の両チームから1人ずつ'), ['第25試合の勝者', '第25試合の敗者']);
  const res = L.scheduleEvent(makeDivisions([8], 1), { courts: EIGHT, start: '09:00', duration: 30, restSlots: 1, pairFrom: 'qf' });
  const us = Object.values(res.matches).map((r) => r.umpire);
  assert.ok(us.some((u) => /^第\d+・\d+試合の敗者から1人ずつ$/.test(u)));
  assert.ok(us.some((u) => /^第\d+試合の両チームから1人ずつ$/.test(u)));
  assert.ok(us.every((u) => !/^第\d+試合の(敗者|勝者)、第\d+試合の(敗者|勝者)から/.test(u)));
});

// 試合進行表の条件を確かめる
function checkEvent(divisions, opts) {
  const res = L.scheduleEvent(divisions, opts);
  const items = L.eventMatches(divisions);
  const byKey = {};
  items.forEach((it) => { byKey[it.key] = it; });
  const byNo = {};
  Object.keys(res.matches).forEach((k) => { byNo[res.matches[k].no] = k; });
  assert.strictEqual(Object.keys(res.matches).length, items.length, '全試合が入っている');
  const cells = new Set();
  // チームの出場（試合の勝者・敗者を含む）を時間枠ごとに集める
  const slotOf = (k) => res.matches[k].slot;
  items.forEach((it) => {
    const r = res.matches[it.key];
    assert.ok(r.court >= 0 && r.court < opts.courts.length);
    assert.ok(!cells.has(r.slot + ':' + r.court), '同じコート・時間に2試合');
    cells.add(r.slot + ':' + r.court);
    assert.strictEqual(res.slotTimes[r.slot], L.formatTime(L.parseTime(opts.start) + r.slot * opts.duration));
    // 前の試合から rest 枠以上空いている
    it.m.sides.forEach((s) => {
      if (s.type !== 'entry') assert.ok(slotOf(L.matchKey(it.div.id, s.matchId)) + 1 + opts.restSlots <= r.slot);
    });
    it.m.after.forEach((id) => assert.ok(slotOf(L.matchKey(it.div.id, id)) < r.slot, '5〜8位決定戦は決勝・3位決定戦のあと'));
  });
  // 試合番号は対戦順・コート順の通し番号
  const keys = Object.keys(res.matches).sort((a, b) => res.matches[a].no - res.matches[b].no);
  keys.forEach((k, i) => {
    assert.strictEqual(res.matches[k].no, i + 1);
    if (i) {
      const p = res.matches[keys[i - 1]], c = res.matches[k];
      assert.ok(p.slot < c.slot || (p.slot === c.slot && p.court < c.court));
    }
  });

  // 審判
  const playsAt = (div, entryId, slot) => items.some((x) => x.div === div && slotOf(x.key) === slot &&
    x.m.sides.some((s) => s.type === 'entry' && s.entryId === entryId));
  items.forEach((it) => {
    const r = res.matches[it.key];
    if (!r.umpire) return;
    const parts = umpireParts(r.umpire);
    assert.ok(parts.length <= 2);
    if (parts.length === 2) {
      // 1人ずつにするのは準々決勝（pairFrom=qf）か準決勝（sf）以降
      const back = opts.pairFrom === 'sf' ? 1 : 2;
      assert.ok(it.m.stage !== 'main' || it.m.round >= it.rounds - back, `第${r.no}試合は1人ずつにしない回戦`);
    }
    parts.forEach((u) => {
      const lm = /^第(\d+)試合の(敗者|勝者)$/.exec(u);
      if (lm) {
        const src = byKey[byNo[lm[1]]];
        assert.strictEqual(src.div, it.div, '審判は同じ部門から');
        assert.ok(slotOf(src.key) < r.slot, '審判を出す試合は先に終わっている');
        // その試合の敗者・勝者が、この時間枠に試合をしていない
        items.filter((x) => x.div === it.div && slotOf(x.key) === r.slot).forEach((x) => {
          const type = lm[2] === '敗者' ? 'loser' : 'winner';
          x.m.sides.forEach((s) => assert.ok(s.type !== type || s.matchId !== src.m.id, `第${r.no}試合の審判が同じ時間に試合をする`));
        });
        if (it.m.stage.startsWith('place')) {
          assert.ok(src.m.stage === 'third' || src.m.round === src.rounds, '5〜8位決定戦の審判はベスト4から');
        }
      } else {
        const e = it.div.entries.find((x) => x.name === u);
        assert.ok(e, `審判「${u}」は同じ部門のチーム`);
        assert.ok(!playsAt(it.div, e.id, r.slot), `${u}は第${r.no}試合の時間に自分の試合がある`);
        // まだ試合をしていない
        assert.ok(!items.some((x) => x.div === it.div && slotOf(x.key) < r.slot &&
          x.m.sides.some((s) => s.type === 'entry' && s.entryId === e.id)), `${u}はもう試合をしている`);
      }
    });
  });
  return res;
}

test('部門の試合：3位決定戦と5〜8位決定戦が加わる', () => {
  const [d8] = makeDivisions([8], 1);
  const m8 = L.divisionMatches(d8.bracket).matches;
  assert.strictEqual(m8.length, 7 + 1 + 4);
  assert.deepStrictEqual(m8.slice(7).map((m) => m.stage), ['third', 'place58', 'place58', 'place5', 'place7']);
  const third = m8.find((m) => m.stage === 'third');
  assert.deepStrictEqual(third.sides.map((s) => s.type + s.matchId), ['loserr2m0', 'loserr2m1']);
  m8.filter((m) => m.stage === 'place58').forEach((m) => assert.deepStrictEqual(m.after, ['r3m0', 'third']));
  // 7チーム：準々決勝の1つが不戦勝なので5〜8位決定戦なし、3位決定戦はある
  const [d7] = makeDivisions([7], 1);
  assert.deepStrictEqual(L.divisionMatches(d7.bracket).matches.filter((m) => m.stage !== 'main').map((m) => m.stage), ['third']);
  // 3チーム：準決勝の1つが不戦勝なので3位決定戦もなし
  const [d3] = makeDivisions([3], 1);
  assert.strictEqual(L.divisionMatches(d3.bracket).matches.length, 2);
  // 2チーム：決勝だけ
  const [d2] = makeDivisions([2], 1);
  assert.strictEqual(L.divisionMatches(d2.bracket).matches.length, 1);
});

test('試合進行表：6部門・8面で条件を満たし、審判が全試合に付く', () => {
  for (let seed = 1; seed <= 5; seed++) {
    const divisions = makeDivisions([8, 12, 16, 20, 10, 6], seed);
    const res = checkEvent(divisions, { courts: EIGHT, start: '09:00', duration: 30, restSlots: 1, pairFrom: 'qf' });
    assert.deepStrictEqual(res.warnings, [], `seed=${seed}`);
  }
});

test('試合進行表：どの部門も最初の数枠のうちに始まる', () => {
  const divisions = makeDivisions([20, 16, 12, 10, 8, 6], 3);
  const res = checkEvent(divisions, { courts: EIGHT, start: '09:00', duration: 30, restSlots: 1, pairFrom: 'qf' });
  divisions.forEach((d) => {
    const first = Math.min(...Object.keys(res.matches).filter((k) => k.startsWith(d.id + ':')).map((k) => res.matches[k].slot));
    assert.ok(first <= 2, `${d.name}の最初の試合が${first}枠目`);
  });
});

test('試合進行表：準決勝からにすると準々決勝は1組で審判をする', () => {
  const divisions = makeDivisions([16, 12], 2);
  const res = checkEvent(divisions, { courts: EIGHT, start: '09:00', duration: 30, restSlots: 1, pairFrom: 'sf' });
  const items = L.eventMatches(divisions);
  items.filter((it) => it.m.stage === 'main' && it.m.round === it.rounds - 2).forEach((it) => {
    assert.ok(!res.matches[it.key].umpire.endsWith('1人ずつ'));
  });
  items.filter((it) => it.m.stage === 'main' && it.m.round === it.rounds - 1).forEach((it) => {
    assert.ok(res.matches[it.key].umpire.endsWith('から1人ずつ'));
  });
});

test('試合進行表：連戦あり・コートが少ない・小さい部門でも条件を満たす', () => {
  checkEvent(makeDivisions([5, 5, 5, 5, 5], 9), { courts: ['A', 'B'], start: '13:15', duration: 45, restSlots: 0, pairFrom: 'qf' });
  checkEvent(makeDivisions([4, 3, 2, 32], 4), { courts: EIGHT, start: '09:00', duration: 25, restSlots: 1, pairFrom: 'qf' });
  // 組み合わせのない部門は飛ばす
  const ds = makeDivisions([6, 1], 1);
  const res = checkEvent(ds, { courts: EIGHT, start: '09:00', duration: 30, restSlots: 1, pairFrom: 'qf' });
  assert.ok(Object.keys(res.matches).every((k) => k.startsWith('d1:')));
});

test('試合進行表：審判を出せない小さい部門でも、最初の時間枠を空けない', () => {
  const res = L.scheduleEvent(makeDivisions([2, 2], 1), { courts: EIGHT, start: '09:00', duration: 30, restSlots: 1, pairFrom: 'qf' });
  assert.deepStrictEqual(Object.values(res.matches).map((r) => r.slot), [0, 0]);
  assert.strictEqual(res.warnings.length, 2);
});

test('試合進行表：入力が不正なら例外', () => {
  const ds = makeDivisions([4], 1);
  assert.throws(() => L.scheduleEvent(ds, { courts: [], start: '09:00', duration: 30 }));
  assert.throws(() => L.scheduleEvent(ds, { courts: ['1'], start: '9時', duration: 30 }));
  assert.throws(() => L.scheduleEvent(ds, { courts: ['1'], start: '09:00', duration: 0 }));
  assert.throws(() => L.scheduleEvent(makeDivisions([1], 1), { courts: ['1'], start: '09:00', duration: 30 }));
});

test('checkSchedule は前の試合より前に並んだ試合と、入っていない部門を知らせる', () => {
  const ds = makeDivisions([4, 4], 1);
  const opts = { courts: EIGHT, start: '09:00', duration: 30, restSlots: 1, pairFrom: 'qf' };
  const res = L.scheduleEvent(ds, opts);
  assert.deepStrictEqual(L.checkSchedule(ds, res), []);
  // 決勝を準決勝と同じ時間枠に動かす
  const fin = res.matches['d1:r2m0'];
  const sf = res.matches['d1:r1m0'];
  fin.slot = sf.slot;
  const ws = L.checkSchedule(ds, res);
  assert.ok(ws.length >= 1 && ws.every((w) => w.startsWith('第' + fin.no + '試合')));
  // 部門を足すと、その部門が入っていないと知らせる
  const more = ds.concat(makeDivisions([3], 2).map((d) => Object.assign(d, { id: 'd9', name: '追加' })));
  assert.ok(L.checkSchedule(more, res).some((w) => w.includes('「追加」')));
});

test('validSchedule は今の組み合わせに合わない試合進行表を弾く', () => {
  const ds = makeDivisions([6, 8], 1);
  const res = L.scheduleEvent(ds, { courts: EIGHT, start: '09:00', duration: 30, restSlots: 1, pairFrom: 'qf' });
  const sc = { courts: res.courts, slotTimes: res.slotTimes, matches: res.matches };
  assert.ok(L.validSchedule(sc, ds));
  assert.ok(!L.validSchedule(sc, ds.slice(0, 1)), 'なくなった部門の試合がある');
  const dup = JSON.parse(JSON.stringify(sc));
  const ks = Object.keys(dup.matches);
  dup.matches[ks[1]].slot = dup.matches[ks[0]].slot;
  dup.matches[ks[1]].court = dup.matches[ks[0]].court;
  assert.ok(!L.validSchedule(dup, ds), '同じマスに2試合');
  const bad = JSON.parse(JSON.stringify(sc));
  bad.matches[ks[0]].court = 99;
  assert.ok(!L.validSchedule(bad, ds));
  assert.ok(!L.validSchedule(null, ds));
  assert.ok(!L.validSchedule(Object.assign({}, sc, { matches: [] }), ds), 'matches が配列');
});

test('titleFor は表の名前を重ねて付けない', () => {
  assert.strictEqual(L.titleFor('〇〇杯', 'トーナメント表'), '〇〇杯 トーナメント表');
  assert.strictEqual(L.titleFor('〇〇杯 トーナメント表', 'トーナメント表'), '〇〇杯 トーナメント表');
  assert.strictEqual(L.titleFor('', '試合進行表'), '試合進行表');
});

test('validateState は壊れたデータを弾く', () => {
  const entries = makeEntries({ A: 2, B: 1 });
  const b = L.generateBracket(entries, seededRng(1));
  assert.strictEqual(L.validateState({ entries, bracket: b }), null);
  assert.ok(L.validateState({ entries, bracket: { size: 4, slots: ['e1', 'e1', 'e2', null] } }));
  assert.ok(L.validateState({ entries, bracket: { size: 4, slots: [null, null, 'e1', 'e2'] } }));
  assert.ok(L.validateState({ entries: 'x' }));
  assert.ok(L.validateState({ entries: entries.slice(0, 1), bracket: { size: 2, slots: ['e1', null] } }));
  assert.ok(L.validateState(null));
});

test('validateState は部門のある形を確かめる', () => {
  const ds = makeDivisions([3, 4], 1);
  assert.strictEqual(L.validateState({ divisions: ds }), null);
  assert.ok(L.validateState({ divisions: [] }));
  assert.ok(L.validateState({ divisions: [ds[0], Object.assign({}, ds[1], { id: ds[0].id })] }), '部門idの重複');
  assert.ok(L.validateState({ divisions: [Object.assign({}, ds[0], { id: 'a:b' })] }), '部門idに使えない文字');
  assert.ok(L.validateState({ divisions: [Object.assign({}, ds[0], { name: 1 })] }));
  const broken = Object.assign({}, ds[1], { bracket: { size: 4, slots: ['e1', 'e1', 'e2', null] } });
  assert.ok(L.validateState({ divisions: [ds[0], broken] }).includes('部門2'));
});

test('sideLabel は勝者・敗者を試合番号で表す', () => {
  const byId = { e1: { name: '山田・佐藤' } };
  assert.strictEqual(L.sideLabel({ type: 'entry', entryId: 'e1' }, byId, {}), '山田・佐藤');
  assert.strictEqual(L.sideLabel({ type: 'winner', matchId: 'r1m0' }, byId, { r1m0: 12 }), '第12試合の勝者');
  assert.strictEqual(L.sideLabel({ type: 'loser', matchId: 'r1m0' }, byId, { r1m0: 12 }), '第12試合の敗者');
});

test('drawNumbers は部門の順番×100＋上からの順番で、BYE を数えない', () => {
  const ds = makeDivisions([5, 3, 1, 4], 2);
  const nums = L.drawNumbers(ds);
  const order = (d) => d.bracket.slots.filter((id) => id !== null).map((id) => nums[d.id][id]);
  assert.deepStrictEqual(order(ds[0]), [101, 102, 103, 104, 105]);
  assert.deepStrictEqual(order(ds[1]), [201, 202, 203]);
  assert.strictEqual(nums.d3, undefined); // 組み合わせのない部門は飛ばすが、順番には数える
  assert.deepStrictEqual(order(ds[3]), [401, 402, 403, 404]);
});

test('compactSchedule は対戦欄を番号の範囲と試合名で書く', () => {
  const ds = makeDivisions([8], 1);
  const plan = L.scheduleEvent(ds, { courts: ['1', '2'], start: '09:00', duration: 30, restSlots: 1, pairFrom: 'qf' });
  const c = L.compactSchedule(ds, plan);
  assert.strictEqual(Object.keys(c).length, Object.keys(plan.matches).length);
  const nums = L.drawNumbers(ds).d1;
  const pos = (id) => nums[id];
  const { matches } = L.divisionMatches(ds[0].bracket);
  matches.forEach((m) => {
    const lines = c['d1:' + m.id].match;
    if (m.stage === 'main' && m.round < 3) {
      const ns = m.entriesBelow.map(pos);
      assert.deepStrictEqual(lines, [Math.min(...ns) + ' − ' + Math.max(...ns)]);
    }
  });
  assert.deepStrictEqual(c['d1:r3m0'].match, ['部門1', '決勝戦']);
  assert.deepStrictEqual(c['d1:third'].match, ['部門1', '3位決定戦']);
  assert.deepStrictEqual(c['d1:p5'].match, ['部門1', '5位決定戦']);
  assert.deepStrictEqual(c['d1:p7'].match, ['部門1', '7位決定戦']);
  assert.deepStrictEqual(c['d1:p58m0'].match, ['101-102 敗者', '103-104 敗者']);
  assert.deepStrictEqual(c['d1:p58m1'].match, ['105-106 敗者', '107-108 敗者']);
});

test('compactSchedule は審判の文字を番号で書き直し、読み取れない文字はそのまま残す', () => {
  const ds = makeDivisions([8], 1);
  const plan = L.scheduleEvent(ds, { courts: ['1', '2'], start: '09:00', duration: 30, restSlots: 1, pairFrom: 'qf' });
  const row = (id) => plan.matches['d1:' + id];
  // r1m0 を r2m0 と同じコートの直前に入れ替え、r1m1 は別のコートに入れ替える（画面でマスを入れ替えるのと同じ）
  const r2 = row('r2m0');
  const move = (r, slot, court) => {
    const other = Object.values(plan.matches).find((x) => x.slot === slot && x.court === court);
    if (other && other !== r) { other.slot = r.slot; other.court = r.court; }
    r.slot = slot;
    r.court = court;
  };
  move(row('r1m0'), r2.slot - 1, r2.court);
  if (row('r1m1').court === r2.court) move(row('r1m1'), row('r1m1').slot, 1 - r2.court);
  const name = (n) => ds[0].entries.find((e) => L.drawNumbers(ds).d1[e.id] === n).name;
  const no = (id) => row(id).no;
  const cases = [
    ['第' + no('r1m0') + '試合の敗者', ['敗者']],
    ['第' + no('r1m1') + '試合の敗者', ['103-104 敗者']],
    [name(105), ['105']],
    [name(107) + '、' + name(106) + 'から1人ずつ', ['106・107', '1人ずつ']],
    ['第' + no('r1m1') + '・' + no('r1m0') + '試合の敗者から1人ずつ', ['101-102・103-104', '敗者 1人ずつ']],
    ['第' + no('r1m1') + '試合の両チームから1人ずつ', ['103-104', '1人ずつ']],
    ['第' + no('r3m0') + '試合の両チームから1人ずつ', ['決勝の2チーム', '1人ずつ']],
    ['第' + no('r3m0') + '試合の勝者', ['優勝者']],
    ['第' + no('third') + '試合の敗者', ['4位']],
    ['第' + no('r3m0') + '試合の敗者、' + name(101) + 'から1人ずつ', ['準優勝・101', '1人ずつ']],
    ['山田先生', ['山田先生']],
    ['第999試合の敗者', ['第999試合の敗者']],
    ['  ', []]
  ];
  cases.forEach(([text, want]) => {
    r2.umpire = text;
    assert.deepStrictEqual(L.compactSchedule(ds, plan)['d1:r2m0'].umpire, want, text);
  });
  // 空きの行をはさむと「1つ前の試合」ではないので、番号で書く
  r2.umpire = '第' + no('r1m0') + '試合の敗者';
  r2.slot += 1000;
  assert.deepStrictEqual(L.compactSchedule(ds, plan)['d1:r2m0'].umpire, ['101-102 敗者']);
});

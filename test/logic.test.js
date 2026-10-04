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

test('parseEntries はタブ・カンマ区切りとシードを読み取る', () => {
  const r = L.parseEntries('山田・佐藤\tA高\t１\n\n鈴木・田中，B高\n高橋・伊藤,C高,2');
  assert.deepStrictEqual(r.errors, []);
  assert.strictEqual(r.entries.length, 3);
  assert.deepStrictEqual(r.entries[0], { id: 'e1', name: '山田・佐藤', club: 'A高', seed: 1 });
  assert.strictEqual(r.entries[1].club, 'B高');
  assert.strictEqual(r.entries[2].seed, 2);
});

test('Object の組み込み名と同じペア名・所属でも誤判定しない', () => {
  const r = L.parseEntries('toString, constructor\n__proto__, hasOwnProperty');
  assert.deepStrictEqual(r.warnings, []);
  assert.deepStrictEqual(r.errors, []);
  const b = L.generateBracket(r.entries, seededRng(1));
  assert.strictEqual(L.validateState({ entries: r.entries, bracket: b }), null);
});

test('parseEntries は不正なシードと重複シードをエラーにする', () => {
  assert.ok(L.parseEntries('a,x,1\nb,y,1').errors.length > 0);
  assert.ok(L.parseEntries('a,x,5\nb,y').errors.length > 0);
  assert.ok(L.parseEntries('a,x,abc\nb,y').errors.length > 0);
  assert.ok(L.parseEntries('a,x').errors.length > 0);
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
  const r = L.parseEntries(['s1,A,1', 's2,B,2', 'x,C', 'y,D', 'z,E'].join('\n'));
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

function checkSchedule(entries, b, opts) {
  const res = L.scheduleMatches(b, entries, opts);
  const { matches } = L.buildMatches(b, res.order);
  const dur = opts.duration;
  const slot = (id) => (L.parseTime(res.rows[id].time) - L.parseTime(opts.start)) / dur;
  const byNo = {};
  matches.forEach((m) => { byNo[m.no] = m; });
  const perSlot = {};
  const loserUses = {};
  matches.forEach((m) => {
    const s = slot(m.id);
    perSlot[s] = (perSlot[s] || 0) + 1;
    // 前の試合から rest 枠以上空いている
    m.sides.forEach((side) => {
      if (side.type === 'winner') assert.ok(slot(side.matchId) + 1 + opts.restSlots <= s);
    });
    const u = res.rows[m.id].umpire;
    assert.ok(u, `第${m.no}試合に審判がいない`);
    const lm = /^第(\d+)試合の負け$/.exec(u);
    if (lm) {
      // 負けたペアの試合はこの試合より前の時間枠
      assert.ok(slot(byNo[lm[1]].id) < s);
      assert.ok(!loserUses[lm[1]], '同じ試合の負けを2回使っている');
      loserUses[lm[1]] = true;
    } else {
      // 試合のない（まだ試合が先の）ペアで、自分の試合ではない
      const e = entries.find((x) => x.name === u);
      assert.ok(e);
      assert.ok(!m.entriesBelow.includes(e.id) || m.round > 1);
      const own = matches.find((x) => x.sides.some((sd) => sd.type === 'entry' && sd.entryId === e.id));
      assert.ok(slot(own.id) > s, `${u}は第${m.no}試合の時間に自分の試合がある`);
    }
  });
  Object.values(perSlot).forEach((c) => assert.ok(c <= opts.courts.length));
  // 試合番号は時刻順
  for (let i = 1; i < matches.length; i++) assert.ok(slot(matches[i - 1].id) <= slot(matches[i].id));
  return res;
}

test('日程：コート数・連戦回避・審判の条件を満たす', () => {
  const entries = makeEntries({ A: 6, B: 5, C: 4, D: 3, E: 2 });
  for (let seed = 1; seed <= 10; seed++) {
    const b = L.generateBracket(entries, seededRng(seed));
    const res = checkSchedule(entries, b, { courts: ['1', '2', '3'], start: '09:00', duration: 30, restSlots: 1 });
    assert.deepStrictEqual(res.warnings, []);
  }
});

test('日程：連戦ありでも条件を満たす', () => {
  const entries = makeEntries({ A: 5, B: 5, C: 5, D: 5, E: 5 });
  const b = L.generateBracket(entries, seededRng(9));
  checkSchedule(entries, b, { courts: ['A', 'B'], start: '13:15', duration: 45, restSlots: 0 });
});

test('日程：入力が不正なら例外', () => {
  const entries = makeEntries({ A: 2, B: 2 });
  const b = L.generateBracket(entries, seededRng(1));
  assert.throws(() => L.scheduleMatches(b, entries, { courts: [], start: '09:00', duration: 30 }));
  assert.throws(() => L.scheduleMatches(b, entries, { courts: ['1'], start: '9時', duration: 30 }));
  assert.throws(() => L.scheduleMatches(b, entries, { courts: ['1'], start: '09:00', duration: 0 }));
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

// 画面の操作
(function () {
  'use strict';

  var L = window.TournamentLogic;
  var R = window.TournamentRender;
  var esc = R.esc;
  var STORAGE_KEY = 'tournament-maker-v1';
  var DEFAULT_DIVISIONS = ['男子低学年', '男子中学年', '男子高学年', '女子低学年', '女子中学年', '女子高学年'];
  var SCHEDULE_TAB = 'schedule';

  var $ = function (id) { return document.getElementById(id); };

  function emptyRow() { return { name: '', club: '', seed: false }; }

  function newDivision(id, name) {
    return { id: id, name: name, entryRows: [emptyRow(), emptyRow(), emptyRow()], entries: [], bracket: null };
  }

  function defaultSettings() {
    return { courts: '1, 2, 3, 4, 5, 6, 7, 8', start: '09:00', duration: 30, avoidBackToBack: true, pairFrom: 'qf', printStyle: 'compact' };
  }

  function defaultState() {
    return {
      version: 2,
      title: '〇〇杯',
      divisions: DEFAULT_DIVISIONS.map(function (name, i) { return newDivision('d' + (i + 1), name); }),
      tab: 'd1',
      schedule: { settings: defaultSettings(), plan: null, stale: false }
    };
  }

  var state = load();
  var selectedSlot = null; // トーナメント表で選んだチームの枠
  var selectedCell = null; // 試合進行表で選んだマス（'時間枠:コート'）
  // 入力欄に薄く出す入力例
  var SAMPLE = [['山田・佐藤', '北高'], ['鈴木・田中', '南高'], ['高橋・伊藤', '東高']];

  // ---------- 保存 ----------

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      var s = normalize(JSON.parse(raw));
      return s || defaultState();
    } catch (e) {
      return defaultState();
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      var n = $('storageNotice');
      n.textContent = 'このブラウザでは自動保存できません。ページを閉じると入力した内容は消えます。閉じる前に「ファイルに保存」で保存してください。';
      n.hidden = false;
    }
  }

  // 保存データから入力行を取り出す。旧形式（entriesText）の保存データも読める。
  function rowsFrom(s) {
    var rows;
    if (Array.isArray(s.entryRows)) {
      rows = s.entryRows.filter(function (r) { return r && typeof r === 'object'; }).map(function (r) {
        return { name: String(r.name || ''), club: String(r.club || ''), seed: r.seed === true };
      });
    } else if (typeof s.entriesText === 'string') {
      rows = L.rowsFromText(s.entriesText);
    } else {
      rows = [];
    }
    return rows.length ? rows : [emptyRow(), emptyRow(), emptyRow()];
  }

  // 1部門ぶんのデータ（検証済み）を、使う項目だけにする
  function normalizeDivision(id, name, s) {
    return {
      id: id,
      name: name,
      entryRows: rowsFrom(s),
      entries: s.entries.map(function (e) {
        return { id: e.id, name: e.name, club: e.club, seed: typeof e.seed === 'number' ? e.seed : null };
      }),
      bracket: s.bracket ? { size: s.bracket.size, slots: s.bracket.slots.slice() } : null
    };
  }

  // 保存データを確かめ、足りない項目を補う。使えないデータなら null。
  // 部門のない以前の保存データは、1つ目の部門（男子低学年）に入れる（試合進行表は作り直しになる）。
  function normalize(s) {
    if (L.validateState(s)) return null;
    var d = defaultState();
    var out = { version: 2, title: typeof s.title === 'string' ? s.title : d.title, divisions: null, tab: null, schedule: d.schedule };
    if (Array.isArray(s.divisions)) {
      out.divisions = s.divisions.map(function (x) { return normalizeDivision(x.id, x.name, x); });
    } else {
      out.divisions = d.divisions;
      out.divisions[0] = normalizeDivision('d1', DEFAULT_DIVISIONS[0], s);
    }
    var ids = out.divisions.map(function (x) { return x.id; });
    out.tab = s.tab === SCHEDULE_TAB || ids.indexOf(s.tab) >= 0 ? s.tab : ids[0];

    var sc = s.schedule;
    if (sc && typeof sc === 'object') {
      var st = sc.settings || {};
      var ds = defaultSettings();
      out.schedule.settings = {
        courts: typeof st.courts === 'string' ? st.courts : ds.courts,
        start: typeof st.start === 'string' ? st.start : ds.start,
        duration: Number(st.duration) > 0 ? Number(st.duration) : ds.duration,
        avoidBackToBack: st.avoidBackToBack !== false,
        pairFrom: st.pairFrom === 'sf' ? 'sf' : 'qf',
        printStyle: st.printStyle === 'compact' || st.printStyle === 'detail' ? st.printStyle : ds.printStyle
      };
      if (Array.isArray(s.divisions) && L.validSchedule(sc.plan, out.divisions)) {
        var plan = { courts: sc.plan.courts.slice(), slotTimes: sc.plan.slotTimes.slice(), matches: {} };
        Object.keys(sc.plan.matches).forEach(function (k) {
          var r = sc.plan.matches[k];
          plan.matches[k] = { slot: r.slot, court: r.court, no: r.no, umpire: r.umpire };
        });
        out.schedule.plan = plan;
        out.schedule.stale = sc.stale === true;
      }
    }
    return out;
  }

  // ---------- 部門 ----------

  function current() {
    for (var i = 0; i < state.divisions.length; i++) if (state.divisions[i].id === state.tab) return state.divisions[i];
    return null;
  }

  function divisionName(d) { return d.name.trim() || '名前なし'; }

  function divisionTitle(d) { return (state.title.trim() ? state.title.trim() + ' ' : '') + divisionName(d); }

  function nextDivisionId() {
    var max = 0;
    state.divisions.forEach(function (d) {
      var m = /^d(\d+)$/.exec(d.id);
      if (m) max = Math.max(max, Number(m[1]));
    });
    return 'd' + (max + 1);
  }

  // 試合進行表のうち、その部門の試合（{ 試合id: 行 }）。全試合が入っていなければ null。
  function planRowsOf(d) {
    var plan = state.schedule.plan;
    if (!plan || !d.bracket) return null;
    var nos = {}, rows = {};
    var all = L.divisionMatches(d.bracket).matches.every(function (m) {
      var r = plan.matches[L.matchKey(d.id, m.id)];
      if (!r) return false;
      nos[m.id] = r.no;
      rows[m.id] = { time: plan.slotTimes[r.slot] || '', court: plan.courts[r.court], umpire: r.umpire };
      return true;
    });
    return all ? { nos: nos, rows: rows } : null;
  }

  function planHasDivision(d) {
    var plan = state.schedule.plan;
    if (!plan) return false;
    var prefix = d.id + ':';
    return Object.keys(plan.matches).some(function (k) { return k.indexOf(prefix) === 0; });
  }

  // ---------- 表示 ----------

  function messages(el, errors, warnings, infos) {
    var html = '';
    (errors || []).forEach(function (m) { html += '<p class="notice error">' + esc(m) + '</p>'; });
    (warnings || []).forEach(function (m) { html += '<p class="notice warn">' + esc(m) + '</p>'; });
    (infos || []).forEach(function (m) { html += '<p class="notice info">' + esc(m) + '</p>'; });
    el.innerHTML = html;
  }

  function renderAll() {
    $('titleInput').value = state.title;
    var st = state.schedule.settings;
    $('courtsInput').value = st.courts;
    $('startInput').value = st.start;
    $('durationInput').value = st.duration;
    $('pairFromInput').value = st.pairFrom;
    $('restInput').checked = st.avoidBackToBack;
    $('printStyleInput').value = st.printStyle;
    renderTabs();
    renderView();
    if (!$('divisionEditor').hidden) renderDivisionRows();
  }

  function renderTabs() {
    var html = '';
    state.divisions.forEach(function (d) {
      var on = state.tab === d.id;
      html += '<button type="button" role="tab" class="tab' + (d.name.trim() ? '' : ' unnamed') + '" data-tab="' + esc(d.id) + '" aria-selected="' + on + '">' + esc(divisionName(d)) + '</button>';
    });
    var on2 = state.tab === SCHEDULE_TAB;
    html += '<button type="button" role="tab" class="tab tab-schedule" data-tab="' + SCHEDULE_TAB + '" aria-selected="' + on2 + '">試合進行表</button>';
    $('tabList').innerHTML = html;
  }

  function renderView() {
    var d = current();
    $('divisionView').hidden = !d;
    $('scheduleView').hidden = !!d;
    $('printDivisionBtn').hidden = !d;
    if (d) {
      $('entriesDivisionName').textContent = divisionName(d);
      $('bracketDivisionName').textContent = divisionName(d);
      renderEntryRows();
      updateEntryCount();
      renderBracket();
    } else {
      renderSchedule();
    }
  }

  function updateEntryCount() {
    var n = L.buildEntries(current().entryRows).entries.length;
    $('entryCount').textContent = n ? n + 'チーム' : '';
  }

  function renderBracket() {
    var d = current();
    var has = !!d.bracket;
    $('bracketPanel').hidden = !has;
    if (!has) {
      $('bracketArea').innerHTML = '';
      return;
    }

    var clashes = L.firstRoundClubClashes(d.bracket, d.entries);
    var clashSlots = {};
    d.bracket.slots.forEach(function (id, i) {
      clashes.forEach(function (pair) {
        if (pair[0].id === id || pair[1].id === id) clashSlots[i] = true;
      });
    });
    var warnings = clashes.map(function (p) {
      return '1回戦で同じ所属（' + p[0].club + '）の「' + p[0].name + '」と「' + p[1].name + '」が対戦します。';
    });
    messages($('bracketMessages'), [], warnings);
    $('bracketArea').innerHTML = bracketSvg(d, { selectedSlot: selectedSlot, clashSlots: clashSlots });
  }

  function bracketSvg(d, opts) {
    var p = planRowsOf(d);
    return R.renderBracket({ title: divisionTitle(d), entries: d.entries, bracket: d.bracket }, {
      nos: p ? p.nos : null,
      rows: p ? p.rows : null,
      blank: opts.blank,
      selectedSlot: opts.selectedSlot,
      clashSlots: opts.clashSlots,
      numbers: L.drawNumbers(state.divisions)[d.id]
    });
  }

  // ---------- 試合進行表の表示 ----------

  // 部門ごとの色（マスの左の線）
  var DIVISION_COLORS = ['#2f6b4f', '#c0392b', '#2c5aa0', '#b9770e', '#7d3c98', '#117a8b', '#6e5a3c', '#a33a74'];

  // 試合進行表の試合を、マス（'時間枠:コート'）ごとにまとめる
  function planCells() {
    var plan = state.schedule.plan;
    var byKey = {};
    L.eventMatches(state.divisions).forEach(function (it) { byKey[it.key] = it; });
    var cells = {};
    Object.keys(plan.matches).forEach(function (k) {
      var r = plan.matches[k];
      if (byKey[k]) cells[r.slot + ':' + r.court] = { key: k, row: r, it: byKey[k] };
    });
    return cells;
  }

  function matchCell(c, forPrint) {
    var it = c.it;
    var nos = {};
    var prefix = it.div.id + ':';
    Object.keys(state.schedule.plan.matches).forEach(function (k) {
      if (k.indexOf(prefix) === 0) nos[k.slice(prefix.length)] = state.schedule.plan.matches[k].no;
    });
    function side(s) {
      if (s.type === 'entry') {
        var e = it.byId[s.entryId];
        return '<div class="side">' + esc(e.name) + (e.club ? '<span class="club">' + esc(e.club) + '</span>' : '') + '</div>';
      }
      return '<div class="side ref">' + esc(L.sideLabel(s, it.byId, nos)) + '</div>';
    }
    var color = DIVISION_COLORS[it.divIndex % DIVISION_COLORS.length];
    var ump = forPrint
      ? '<span class="ump-val">' + esc(c.row.umpire) + '</span>'
      : '<textarea rows="2" data-key="' + esc(c.key) + '" aria-label="第' + c.row.no + '試合の審判">' + esc(c.row.umpire) + '</textarea>';
    return '<div class="match" style="border-left-color:' + color + '">' +
      '<div class="cell-head"><span class="div-name">' + esc(divisionName(it.div)) + '</span>' +
      '<span class="round">' + esc(L.matchName(it.m, it.rounds)) + '</span>' +
      '<span class="no">第' + c.row.no + '試合</span></div>' +
      side(it.m.sides[0]) + '<div class="vs">対</div>' + side(it.m.sides[1]) +
      '<div class="ump"><span class="ump-label">審判</span>' + ump + '</div></div>';
  }

  // courtIdx: 表に入れるコートの番号の一覧。forPrint なら入力欄の代わりに文字で表示し、空きの行を付けない。
  function gridHtml(courtIdx, forPrint) {
    var plan = state.schedule.plan;
    var cells = planCells();
    var html = '<table class="grid"><thead><tr><th class="g-order">対戦順</th><th class="g-time">時刻</th>';
    courtIdx.forEach(function (c) { html += '<th>コート' + esc(plan.courts[c]) + '</th>'; });
    html += '</tr></thead><tbody>';
    var rows = plan.slotTimes.length + (forPrint ? 0 : 1);
    for (var t = 0; t < rows; t++) {
      var extra = t >= plan.slotTimes.length;
      html += '<tr><td class="g-order">' + (t + 1) + '</td><td class="g-time">';
      if (forPrint) html += esc(plan.slotTimes[t]);
      else if (!extra) html += '<input data-slot-time="' + t + '" value="' + esc(plan.slotTimes[t]) + '" aria-label="対戦順' + (t + 1) + 'の時刻">';
      html += '</td>';
      courtIdx.forEach(function (c) {
        var id = t + ':' + c;
        var cell = cells[id];
        var cls = 'g-cell' + (cell ? '' : ' empty') + (selectedCell === id ? ' selected' : '');
        html += '<td class="' + cls + '"' + (forPrint ? '' : ' data-cell="' + id + '"') + '>' + (cell ? matchCell(cell, forPrint) : '') + '</td>';
      });
      html += '</tr>';
    }
    html += '</tbody></table>';
    return html;
  }

  function renderSchedule() {
    var plan = state.schedule.plan;
    $('gridHelp').hidden = !plan;
    if (!plan) {
      $('scheduleArea').innerHTML = '';
      return;
    }
    $('scheduleArea').innerHTML = gridHtml(plan.courts.map(function (_, i) { return i; }), false);
  }

  // 試合進行表の注意（組み合わせの変更・並びの問題）を表示する。errors / warnings は自動作成のときのもの。
  function showScheduleNotices(errors, warnings) {
    var list = (warnings || []).slice();
    if (!state.schedule.plan) {
      messages($('scheduleMessages'), errors || [], list, ['「日程を自動作成」を押すと、全部門の試合に対戦順・時刻・コート・審判が割り当てられます。']);
      return;
    }
    if (state.schedule.stale) {
      list.push('組み合わせを変えたため、試合進行表の審判が合っていない場合があります。「日程を自動作成」を押すと試合進行表を作り直します。');
    }
    list = list.concat(L.checkSchedule(state.divisions, state.schedule.plan));
    messages($('scheduleMessages'), errors || [], list);
  }

  // ---------- タブ ----------

  $('tabList').addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-tab]');
    if (!b) return;
    state.tab = b.getAttribute('data-tab');
    selectedSlot = null;
    selectedCell = null;
    messages($('entryMessages'), []);
    messages($('bracketMessages'), []);
    messages($('printMessages'), []);
    save();
    renderTabs();
    renderView();
    if (state.tab === SCHEDULE_TAB) showScheduleNotices();
  });

  // ---------- 部門の編集 ----------

  function renderDivisionRows() {
    var only = state.divisions.length === 1;
    var html = '';
    state.divisions.forEach(function (d, i) {
      html += '<div class="division-row" data-division="' + esc(d.id) + '">' +
        '<input type="text" value="' + esc(d.name) + '" placeholder="男子低学年" aria-label="' + (i + 1) + '番目の部門の名前">' +
        '<button type="button" data-remove-division="' + esc(d.id) + '"' + (only ? ' disabled' : '') + ' aria-label="' + esc(divisionName(d)) + 'を削除">削除</button>' +
        '</div>';
    });
    $('divisionRows').innerHTML = html;
  }

  function toggleEditor(open) {
    $('divisionEditor').hidden = !open;
    $('editDivisionsBtn').setAttribute('aria-expanded', String(open));
    if (open) renderDivisionRows();
  }

  $('editDivisionsBtn').addEventListener('click', function () { toggleEditor($('divisionEditor').hidden); });
  $('closeEditorBtn').addEventListener('click', function () { toggleEditor(false); });

  $('divisionRows').addEventListener('input', function (ev) {
    var row = ev.target.closest('[data-division]');
    if (!row) return;
    var id = row.getAttribute('data-division');
    state.divisions.forEach(function (d) { if (d.id === id) d.name = ev.target.value; });
    save();
    renderTabs();
    if (current()) {
      $('entriesDivisionName').textContent = divisionName(current());
      $('bracketDivisionName').textContent = divisionName(current());
      renderBracket();
    } else {
      renderSchedule();
    }
  });

  $('divisionRows').addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-remove-division]');
    if (!b || state.divisions.length === 1) return;
    var id = b.getAttribute('data-remove-division');
    var d = state.divisions.filter(function (x) { return x.id === id; })[0];
    var hasData = d.bracket || L.buildEntries(d.entryRows).entries.length;
    var inPlan = planHasDivision(d);
    if (hasData || inPlan) {
      var what = '「' + divisionName(d) + '」の参加チームと組み合わせ' + (inPlan ? '、全部門の試合進行表' : '');
      if (!window.confirm(what + 'は消えます。よろしいですか？')) return;
    }
    state.divisions = state.divisions.filter(function (x) { return x.id !== id; });
    selectedSlot = null;
    selectedCell = null;
    if (inPlan) {
      state.schedule.plan = null;
      state.schedule.stale = false;
      messages($('scheduleMessages'), []);
    }
    if (state.tab === id) state.tab = state.divisions[0].id;
    save();
    renderAll();
  });

  $('addDivisionBtn').addEventListener('click', function () {
    if (state.divisions.length >= L.MAX_DIVISIONS) {
      window.alert('部門は' + L.MAX_DIVISIONS + 'まで追加できます。');
      return;
    }
    var d = newDivision(nextDivisionId(), '');
    state.divisions.push(d);
    state.tab = d.id;
    selectedSlot = null;
    save();
    renderAll();
    var inputs = $('divisionRows').querySelectorAll('input');
    inputs[inputs.length - 1].focus();
  });

  // ---------- 大会名・参加チーム ----------

  $('titleInput').addEventListener('input', function () {
    state.title = this.value;
    save();
    if (current()) renderBracket();
  });

  function renderEntryRows() {
    var html = '';
    current().entryRows.forEach(function (r, i) {
      var n = i + 1;
      html += '<div class="entry-row" data-row="' + i + '">' +
        '<input type="text" data-field="name" value="' + esc(r.name) + '" placeholder="' + (SAMPLE[i] ? SAMPLE[i][0] : '') + '" aria-label="' + n + '行目のチーム名">' +
        '<input type="text" data-field="club" value="' + esc(r.club) + '" placeholder="' + (SAMPLE[i] ? SAMPLE[i][1] : '') + '" aria-label="' + n + '行目の所属">' +
        '<label class="seed-check"><input type="checkbox" data-field="seed"' + (r.seed ? ' checked' : '') + ' aria-label="' + n + '行目をシードにする"><span class="seed-label">シード</span></label>' +
        '<button type="button" data-remove="' + i + '" aria-label="' + n + '行目を削除">削除</button>' +
        '</div>';
    });
    $('entryRows').innerHTML = html;
  }

  function entriesChanged() {
    updateEntryCount();
    save();
    if (current().bracket) {
      messages($('entryMessages'), [], [], ['参加チームの変更は、「組み合わせを作成」を押すとトーナメント表に反映されます。']);
    }
  }

  $('entryRows').addEventListener('input', function (ev) {
    var t = ev.target;
    var row = t.closest('[data-row]');
    var field = t.getAttribute('data-field');
    if (!row || !field) return;
    var r = current().entryRows[Number(row.getAttribute('data-row'))];
    if (field === 'seed') r.seed = t.checked;
    else r[field] = t.value;
    entriesChanged();
  });

  $('entryRows').addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-remove]');
    if (!b) return;
    var rows = current().entryRows;
    rows.splice(Number(b.getAttribute('data-remove')), 1);
    if (!rows.length) rows.push(emptyRow());
    renderEntryRows();
    entriesChanged();
  });

  $('addRowBtn').addEventListener('click', function () {
    current().entryRows.push(emptyRow());
    renderEntryRows();
    entriesChanged();
    var inputs = $('entryRows').querySelectorAll('[data-field="name"]');
    inputs[inputs.length - 1].focus();
  });

  // 今の部門の組み合わせを entries で作り直す。試合進行表が使えなくなるなら消す（確認してから）。
  // 返り値: 作り直したら true
  function regenerate(entries) {
    var d = current();
    var bracket = L.generateBracket(entries);
    var after = state.divisions.map(function (x) {
      return x === d ? { id: d.id, name: d.name, entries: entries, bracket: bracket } : x;
    });
    var plan = state.schedule.plan;
    var dropPlan = plan && planHasDivision(d) && !L.validSchedule(plan, after);
    if (d.bracket || dropPlan) {
      var what = '「' + divisionName(d) + '」の今の組み合わせ' + (dropPlan ? 'と、全部門の試合進行表' : '');
      if (!window.confirm(what + 'は消えます。よろしいですか？')) return false;
    }
    d.entries = entries;
    d.bracket = bracket;
    selectedSlot = null;
    if (dropPlan) {
      state.schedule.plan = null;
      state.schedule.stale = false;
      messages($('scheduleMessages'), []);
    } else if (plan && planHasDivision(d)) {
      state.schedule.stale = true;
    }
    return true;
  }

  $('generateBtn').addEventListener('click', function () {
    var r = L.buildEntries(current().entryRows);
    if (r.errors.length) {
      messages($('entryMessages'), r.errors, r.warnings);
      return;
    }
    if (!regenerate(r.entries)) return;
    messages($('entryMessages'), [], r.warnings);
    save();
    renderBracket();
    $('bracketPanel').scrollIntoView({ behavior: 'smooth' });
  });

  $('rerollBtn').addEventListener('click', function () {
    if (!regenerate(current().entries)) return;
    save();
    renderBracket();
  });

  // チーム名を2回押して入れ替える
  $('bracketArea').addEventListener('click', function (ev) {
    var g = ev.target.closest('[data-slot]');
    if (!g) {
      if (selectedSlot !== null) { selectedSlot = null; renderBracket(); }
      return;
    }
    var slot = Number(g.getAttribute('data-slot'));
    if (selectedSlot === null) {
      selectedSlot = slot;
    } else if (selectedSlot === slot) {
      selectedSlot = null;
    } else {
      var d = current();
      L.swapSlots(d.bracket, selectedSlot, slot);
      selectedSlot = null;
      if (planHasDivision(d)) state.schedule.stale = true;
      save();
    }
    renderBracket();
  });

  // ---------- 試合進行表 ----------

  ['courtsInput', 'startInput', 'durationInput'].forEach(function (id) {
    $(id).addEventListener('input', readSettings);
  });
  $('restInput').addEventListener('change', readSettings);
  $('pairFromInput').addEventListener('change', readSettings);

  function readSettings() {
    state.schedule.settings = {
      courts: $('courtsInput').value,
      start: $('startInput').value,
      duration: Number($('durationInput').value),
      avoidBackToBack: $('restInput').checked,
      pairFrom: $('pairFromInput').value === 'sf' ? 'sf' : 'qf',
      printStyle: $('printStyleInput').value === 'detail' ? 'detail' : 'compact'
    };
    save();
  }

  $('printStyleInput').addEventListener('change', function () {
    state.schedule.settings.printStyle = this.value === 'detail' ? 'detail' : 'compact';
    save();
  });

  $('scheduleBtn').addEventListener('click', function () {
    readSettings();
    var st = state.schedule.settings;
    var courts = st.courts.split(/[,，、\s]+/).map(function (s) { return s.trim(); }).filter(Boolean);
    if (state.schedule.plan && !window.confirm('手で直した内容も含めて、今の試合進行表は消えます。作り直してよろしいですか？')) return;
    var res;
    try {
      res = L.scheduleEvent(state.divisions, {
        courts: courts,
        start: st.start,
        duration: st.duration,
        restSlots: st.avoidBackToBack ? 1 : 0,
        pairFrom: st.pairFrom
      });
    } catch (e) {
      messages($('scheduleMessages'), [e.message]);
      return;
    }
    state.schedule.plan = { courts: res.courts, slotTimes: res.slotTimes, matches: res.matches };
    state.schedule.stale = false;
    selectedCell = null;
    save();
    renderSchedule();
    showScheduleNotices([], res.warnings);
  });

  // マスを2回押して試合を入れ替える（空いたマスなら移す）
  $('scheduleArea').addEventListener('click', function (ev) {
    if (!state.schedule.plan || ev.target.closest('input, textarea')) return;
    var td = ev.target.closest('[data-cell]');
    if (!td) {
      if (selectedCell !== null) { selectedCell = null; renderSchedule(); }
      return;
    }
    var id = td.getAttribute('data-cell');
    var cells = planCells();
    if (selectedCell === null) {
      if (cells[id]) selectedCell = id;
    } else if (selectedCell === id) {
      selectedCell = null;
    } else {
      moveCells(cells, selectedCell, id);
      selectedCell = null;
      save();
      showScheduleNotices();
    }
    renderSchedule();
  });

  function moveCells(cells, from, to) {
    var plan = state.schedule.plan;
    var a = cells[from], b = cells[to];
    var pf = from.split(':').map(Number), pt = to.split(':').map(Number);
    if (a) { a.row.slot = pt[0]; a.row.court = pt[1]; }
    if (b) { b.row.slot = pf[0]; b.row.court = pf[1]; }
    // 空きの行に移したら時刻を足し、最後の行が空いたら消す
    while (plan.slotTimes.length <= pt[0]) {
      var last = L.parseTime(plan.slotTimes[plan.slotTimes.length - 1]);
      var dur = Number(state.schedule.settings.duration);
      plan.slotTimes.push(last !== null && dur > 0 ? L.formatTime(last + dur) : '');
    }
    var used = Object.keys(plan.matches).map(function (k) { return plan.matches[k].slot; });
    var maxSlot = Math.max.apply(null, used);
    plan.slotTimes.length = Math.max(maxSlot + 1, 1);
  }

  // 時刻と審判の手直し
  $('scheduleArea').addEventListener('input', function (ev) {
    var t = ev.target;
    var plan = state.schedule.plan;
    if (!plan) return;
    if (t.hasAttribute('data-slot-time')) {
      plan.slotTimes[Number(t.getAttribute('data-slot-time'))] = t.value;
    } else if (t.hasAttribute('data-key') && plan.matches[t.getAttribute('data-key')]) {
      plan.matches[t.getAttribute('data-key')].umpire = t.value;
    } else {
      return;
    }
    save();
  });

  // ---------- 印刷 ----------

  // ponytail: 詳しい表は1ページにコート4面ずつ並べる。対戦順が多いと1ページに収まらず、次のページに続く。
  var COURTS_PER_PAGE = 4;
  // ponytail: 番号の表は1つの表を15行までにする。時間枠が15を超えると表が分かれる。変えるときは ROWS_PER_BLOCK を直す（A4縦に収まる行数は CSS の行の高さと合わせる）。
  var ROWS_PER_BLOCK = 15;
  var TABLES_PER_PAGE = 2;

  // 番号の表の1つの表。slots: 行にする時間枠の番号の一覧、courtIdx: コートの番号の一覧、grid: { '時間枠:コート': 試合 }
  function compactTableHtml(plan, grid, slots, courtIdx) {
    // コートが4面に満たない表も、1面あたりの幅は4面の表と同じにする（順の列8mm＋1面46.4mm）
    var html = '<table class="compact" style="width:' + (8 + 46.4 * courtIdx.length).toFixed(1) + 'mm"><colgroup><col class="c-order">';
    courtIdx.forEach(function () { html += '<col class="c-match"><col class="c-ump">'; });
    html += '</colgroup><thead><tr><th rowspan="2" class="c-order">順</th>';
    courtIdx.forEach(function (c) { html += '<th colspan="2">コート' + esc(plan.courts[c]) + '</th>'; });
    html += '</tr><tr>';
    courtIdx.forEach(function () { html += '<th class="c-match">対戦</th><th class="c-ump">審判</th>'; });
    html += '</tr></thead><tbody>';
    slots.forEach(function (t, i) {
      html += '<tr><td class="c-order">' + (t + 1) + '</td>';
      courtIdx.forEach(function (c) {
        var cur = grid[t + ':' + c];
        // そのコートで前にあった試合（空きの行や、前の表の行もさかのぼる）
        var above = null;
        for (var u = t - 1; u >= 0 && !above; u--) above = grid[u + ':' + c] || null;
        var cls = cur && above && cur.divId !== above.divId ? ' div-change' : '';
        function lines(a) { return a.map(esc).join('<br>'); }
        html += '<td class="c-match' + cls + '">' + (cur ? lines(cur.match) : '') + '</td>' +
          '<td class="c-ump' + cls + '">' + (cur ? lines(cur.umpire) : '') + '</td>';
      });
      html += '</tr>';
    });
    return html + '</tbody></table>';
  }

  // 番号の表のページ（HTML の配列）。行のかたまりが外側、コート4面のかたまりが内側の順に表を並べ、2つずつ1ページにする。
  // コートが4面以下なら、1ページに1〜15行目と16〜30行目が上下に入る。
  // 5面以上なら、行のかたまりごとにページを分ける（別の行のかたまりの表と同じページにしない）。
  function compactPages(plan, title) {
    var cs = L.compactSchedule(state.divisions, plan);
    var grid = {};
    Object.keys(cs).forEach(function (k) {
      var r = plan.matches[k];
      grid[r.slot + ':' + r.court] = cs[k];
    });
    var tables = [];
    var pages = [];
    function flush() {
      for (var p = 0; p < tables.length; p += TABLES_PER_PAGE) {
        pages.push('<h2 class="print-title">' + esc(title) + '</h2>' + tables.slice(p, p + TABLES_PER_PAGE).join(''));
      }
      tables = [];
    }
    for (var t0 = 0; t0 < plan.slotTimes.length; t0 += ROWS_PER_BLOCK) {
      var slots = [];
      for (var t = t0; t < Math.min(t0 + ROWS_PER_BLOCK, plan.slotTimes.length); t++) slots.push(t);
      for (var c = 0; c < plan.courts.length; c += COURTS_PER_PAGE) {
        var idx = [];
        for (var i = c; i < Math.min(c + COURTS_PER_PAGE, plan.courts.length); i++) idx.push(i);
        tables.push(compactTableHtml(plan, grid, slots, idx));
      }
      if (plan.courts.length > COURTS_PER_PAGE) flush();
    }
    flush();
    return pages;
  }

  document.querySelectorAll('[data-print]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var target = btn.getAttribute('data-print');
      var blank = $('blankInfoInput').checked;
      var compact = state.schedule.settings.printStyle === 'compact';
      var pages = [];
      if (target === 'schedule') {
        var plan = state.schedule.plan;
        if (!plan) {
          messages($('printMessages'), ['試合進行表がまだありません。「試合進行表」のタブで「日程を自動作成」を押すと作成されます。']);
          return;
        }
        var title = L.titleFor(state.title, '試合進行表');
        if (compact) {
          pages = compactPages(plan, title);
        } else {
          for (var c = 0; c < plan.courts.length; c += COURTS_PER_PAGE) {
            var idx = [];
            for (var i = c; i < Math.min(c + COURTS_PER_PAGE, plan.courts.length); i++) idx.push(i);
            pages.push('<h2 class="print-title">' + esc(title) + '</h2>' + gridHtml(idx, true));
          }
        }
      } else {
        var list = target === 'division' ? [current()] : state.divisions;
        list.forEach(function (d) {
          if (d && d.bracket) pages.push(bracketSvg(d, { blank: blank }));
        });
        if (!pages.length) {
          messages($('printMessages'), [target === 'division'
            ? 'この部門の組み合わせがまだありません。「組み合わせを作成」を押すと作成されます。'
            : '組み合わせを作成した部門がありません。各部門で「組み合わせを作成」を押すと作成されます。']);
          return;
        }
      }
      messages($('printMessages'), []);
      // 番号の表だけA4縦。名前付きページ（@page 名前）に対応していないブラウザもあるので、印刷のたびに向きを書き換える。
      $('pageStyle').textContent = '@page { size: A4 ' + (target === 'schedule' && compact ? 'portrait' : 'landscape') + '; margin: 8mm; }';
      $('printArea').innerHTML = pages.map(function (p) {
        var kind = target !== 'schedule' ? 'bracket' : compact ? 'compact' : 'schedule';
        return '<div class="print-page print-' + kind + '">' + p + '</div>';
      }).join('');
      window.print();
    });
  });
  window.addEventListener('afterprint', function () {
    $('printArea').innerHTML = '';
  });

  // ---------- クリア ----------

  $('clearBtn').addEventListener('click', function () {
    if (!window.confirm('大会名・部門・参加チーム・トーナメント表・試合進行表など、入力した内容をすべて消して最初の状態に戻します。よろしいですか？')) return;
    state = defaultState();
    selectedSlot = null;
    selectedCell = null;
    ['entryMessages', 'bracketMessages', 'scheduleMessages', 'printMessages'].forEach(function (id) { messages($(id), []); });
    toggleEditor(false);
    save();
    renderAll();
    window.scrollTo({ top: 0 });
  });

  // ---------- ファイル ----------

  $('exportBtn').addEventListener('click', function () {
    var blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    var d = new Date();
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    a.href = URL.createObjectURL(blob);
    a.download = 'tournament-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  });

  $('importInput').addEventListener('change', function () {
    var file = this.files[0];
    this.value = '';
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var s, err, next;
      try {
        s = JSON.parse(reader.result);
        err = L.validateState(s);
        next = err ? null : normalize(s);
      } catch (e) {
        window.alert('ファイルを読み込めませんでした。このアプリで保存したファイルを選んでください。');
        return;
      }
      if (!next) {
        window.alert('ファイルを読み込めませんでした。' + (err ? '\n' + err : ''));
        return;
      }
      var hasData = state.divisions.some(function (d) { return d.bracket || L.buildEntries(d.entryRows).entries.length; });
      if (hasData && !window.confirm('今の内容は消え、読み込んだファイルの内容に置き換わります。よろしいですか？')) return;
      state = next;
      selectedSlot = null;
      selectedCell = null;
      ['entryMessages', 'bracketMessages', 'scheduleMessages', 'printMessages'].forEach(function (id) { messages($(id), []); });
      save();
      renderAll();
      if (state.tab === SCHEDULE_TAB) showScheduleNotices();
    };
    reader.onerror = function () { window.alert('ファイルを読み込めませんでした。'); };
    reader.readAsText(file);
  });

  renderAll();
  if (state.tab === SCHEDULE_TAB) showScheduleNotices();
})();

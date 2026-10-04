// 画面の操作
(function () {
  'use strict';

  var L = window.TournamentLogic;
  var esc = window.TournamentRender.esc;
  var STORAGE_KEY = 'tournament-maker-v1';

  var $ = function (id) { return document.getElementById(id); };

  function emptyRow() { return { name: '', club: '', seed: false }; }

  function defaultState() {
    return {
      version: 1,
      title: '〇〇杯',
      entryRows: [emptyRow(), emptyRow(), emptyRow()],
      entries: [],
      bracket: null,
      schedule: {
        settings: { courts: '1, 2, 3', start: '09:00', duration: 30, avoidBackToBack: true },
        order: null,
        rows: null,
        stale: false
      }
    };
  }

  var state = load();
  var selectedSlot = null;
  var printingBlank = false; // 印刷中だけ、トーナメント表の記入欄を空欄にする
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

  // 保存データを確かめ、足りない項目を補う。使えないデータなら null。
  function normalize(s) {
    if (L.validateState(s)) return null;
    var d = defaultState();
    var out = {
      version: 1,
      title: typeof s.title === 'string' ? s.title : d.title,
      entryRows: rowsFrom(s),
      entries: s.entries.map(function (e) {
        return { id: e.id, name: e.name, club: e.club, seed: typeof e.seed === 'number' ? e.seed : null };
      }),
      bracket: s.bracket ? { size: s.bracket.size, slots: s.bracket.slots.slice() } : null,
      schedule: d.schedule
    };
    var sc = s.schedule;
    if (sc && typeof sc === 'object') {
      var st = sc.settings || {};
      out.schedule.settings = {
        courts: typeof st.courts === 'string' ? st.courts : d.schedule.settings.courts,
        start: typeof st.start === 'string' ? st.start : d.schedule.settings.start,
        duration: Number(st.duration) > 0 ? Number(st.duration) : d.schedule.settings.duration,
        avoidBackToBack: st.avoidBackToBack !== false
      };
      if (out.bracket && Array.isArray(sc.order) && sc.rows && typeof sc.rows === 'object') {
        var ids = L.buildMatches(out.bracket).matches.map(function (m) { return m.id; });
        var okOrder = sc.order.length === ids.length && ids.every(function (id) { return sc.order.indexOf(id) >= 0; });
        var okRows = ids.every(function (id) {
          var r = sc.rows[id];
          return r && typeof r.time === 'string' && typeof r.court === 'string' && typeof r.umpire === 'string';
        });
        if (okOrder && okRows) {
          out.schedule.order = sc.order.slice();
          out.schedule.rows = {};
          ids.forEach(function (id) {
            var r = sc.rows[id];
            out.schedule.rows[id] = { time: r.time, court: r.court, umpire: r.umpire };
          });
          out.schedule.stale = sc.stale === true;
        }
      }
    }
    return out;
  }

  // ---------- 表示 ----------

  function messages(el, errors, warnings, infos) {
    var html = '';
    (errors || []).forEach(function (m) { html += '<p class="notice error">' + esc(m) + '</p>'; });
    (warnings || []).forEach(function (m) { html += '<p class="notice warn">' + esc(m) + '</p>'; });
    (infos || []).forEach(function (m) { html += '<p class="notice info">' + esc(m) + '</p>'; });
    el.innerHTML = html;
  }

  function hasSchedule() { return !!state.schedule.rows; }

  function renderAll() {
    $('titleInput').value = state.title;
    renderEntryRows();
    var st = state.schedule.settings;
    $('courtsInput').value = st.courts;
    $('startInput').value = st.start;
    $('durationInput').value = st.duration;
    $('restInput').checked = st.avoidBackToBack;
    updateEntryCount();
    renderBracket();
    renderSchedule();
  }

  function updateEntryCount() {
    var n = L.buildEntries(state.entryRows).entries.length;
    $('entryCount').textContent = n ? n + 'チーム' : '';
  }

  function renderBracket() {
    var has = !!state.bracket;
    $('bracketPanel').hidden = !has;
    $('schedulePanel').hidden = !has;
    $('printPanel').hidden = !has;
    if (!has) return;

    var clashes = L.firstRoundClubClashes(state.bracket, state.entries);
    var clashSlots = {};
    state.bracket.slots.forEach(function (id, i) {
      clashes.forEach(function (pair) {
        if (pair[0].id === id || pair[1].id === id) clashSlots[i] = true;
      });
    });
    var warnings = clashes.map(function (p) {
      return '1回戦で同じ所属（' + p[0].club + '）の「' + p[0].name + '」と「' + p[1].name + '」が対戦します。';
    });
    messages($('bracketMessages'), [], warnings);

    $('bracketArea').innerHTML = window.TournamentRender.renderBracket(state, {
      order: state.schedule.order,
      rows: state.schedule.rows,
      blank: printingBlank,
      selectedSlot: selectedSlot,
      clashSlots: clashSlots
    });
  }

  function renderSchedule() {
    var area = $('scheduleArea');
    if (!state.bracket || !hasSchedule()) {
      area.innerHTML = '';
      if (state.bracket && !$('scheduleMessages').innerHTML) {
        messages($('scheduleMessages'), [], [], ['「日程を自動作成」を押すと、時刻・コート・審判が割り当てられます。']);
      }
      return;
    }
    var built = L.buildMatches(state.bracket, state.schedule.order);
    var byId = L.indexEntries(state.entries);
    var byMatch = {};
    built.matches.forEach(function (m) { byMatch[m.id] = m; });

    function side(s) {
      if (s.type === 'entry') {
        var e = byId[s.entryId];
        return '<span class="pair">' + esc(e.name) + '</span>' + (e.club ? '<span class="club">' + esc(e.club) + '</span>' : '');
      }
      return '<span class="pair winner">' + esc(L.sideLabel(s, byId, byMatch)) + '</span>';
    }

    var html = '<h2 class="print-only">' + esc(L.titleFor(state.title, '試合進行表')) + '</h2>';
    html += '<table class="schedule"><thead><tr>' +
      '<th class="c-no">試合</th><th class="c-round">回戦</th><th class="c-time">時刻</th><th class="c-court">コート</th>' +
      '<th>対戦</th><th class="c-ump">審判</th><th class="c-score">結果</th></tr></thead><tbody>';
    built.matches.forEach(function (m) {
      var r = state.schedule.rows[m.id];
      html += '<tr>' +
        '<td class="c-no">第' + m.no + '試合</td>' +
        '<td class="c-round">' + esc(L.roundName(m.round, built.rounds)) + '</td>' +
        '<td class="c-time"><input data-match="' + m.id + '" data-field="time" value="' + esc(r.time) + '" aria-label="第' + m.no + '試合の時刻"></td>' +
        '<td class="c-court"><input data-match="' + m.id + '" data-field="court" value="' + esc(r.court) + '" aria-label="第' + m.no + '試合のコート"></td>' +
        '<td class="c-vs">' + side(m.sides[0]) + '<span class="vs">対</span>' + side(m.sides[1]) + '</td>' +
        '<td class="c-ump"><input data-match="' + m.id + '" data-field="umpire" value="' + esc(r.umpire) + '" aria-label="第' + m.no + '試合の審判"></td>' +
        '<td class="c-score"></td>' +
        '</tr>';
    });
    html += '</tbody></table>';
    area.innerHTML = html;
  }

  // ---------- 操作 ----------

  function confirmDiscardBracket() {
    if (!state.bracket) return true;
    var what = hasSchedule() ? '今の組み合わせと試合進行表' : '今の組み合わせ';
    return window.confirm(what + 'は消えます。よろしいですか？');
  }

  function clearSchedule() {
    state.schedule.order = null;
    state.schedule.rows = null;
    state.schedule.stale = false;
    messages($('scheduleMessages'), [], []);
  }

  function generate(entries) {
    state.bracket = L.generateBracket(entries);
    selectedSlot = null;
    clearSchedule();
  }

  $('titleInput').addEventListener('input', function () {
    state.title = this.value;
    save();
    if (state.bracket) {
      renderBracket();
      renderSchedule();
    }
  });

  function renderEntryRows() {
    var html = '';
    state.entryRows.forEach(function (r, i) {
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
    if (state.bracket) {
      messages($('entryMessages'), [], [], ['参加チームの変更は、「組み合わせを作成」を押すとトーナメント表に反映されます。']);
    }
  }

  $('entryRows').addEventListener('input', function (ev) {
    var t = ev.target;
    var row = t.closest('[data-row]');
    var field = t.getAttribute('data-field');
    if (!row || !field) return;
    var i = Number(row.getAttribute('data-row'));
    if (field === 'seed') {
      // シードは1チームだけ。別のチームにチェックを入れたら、前のチェックは外す。
      state.entryRows.forEach(function (r, j) { r.seed = j === i && t.checked; });
      renderEntryRows();
    } else {
      state.entryRows[i][field] = t.value;
    }
    entriesChanged();
  });

  $('entryRows').addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-remove]');
    if (!b) return;
    state.entryRows.splice(Number(b.getAttribute('data-remove')), 1);
    if (!state.entryRows.length) state.entryRows.push(emptyRow());
    renderEntryRows();
    entriesChanged();
  });

  $('addRowBtn').addEventListener('click', function () {
    state.entryRows.push(emptyRow());
    renderEntryRows();
    entriesChanged();
    var inputs = $('entryRows').querySelectorAll('[data-field="name"]');
    inputs[inputs.length - 1].focus();
  });

  $('generateBtn').addEventListener('click', function () {
    var r = L.buildEntries(state.entryRows);
    if (r.errors.length) {
      messages($('entryMessages'), r.errors, r.warnings);
      return;
    }
    if (!confirmDiscardBracket()) return;
    state.entries = r.entries;
    generate(r.entries);
    messages($('entryMessages'), [], r.warnings);
    save();
    renderAll();
    $('bracketPanel').scrollIntoView({ behavior: 'smooth' });
  });

  $('rerollBtn').addEventListener('click', function () {
    if (!confirmDiscardBracket()) return;
    generate(state.entries);
    save();
    renderAll();
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
      L.swapSlots(state.bracket, selectedSlot, slot);
      selectedSlot = null;
      if (hasSchedule()) {
        state.schedule.stale = true;
        showStale();
      }
      save();
      renderSchedule();
    }
    renderBracket();
  });

  function showStale() {
    if (state.schedule.stale) {
      messages($('scheduleMessages'), [], ['組み合わせを入れ替えたため、試合進行表の審判が合っていない場合があります。「日程を自動作成」を押すと試合進行表を作り直します。']);
    }
  }

  ['courtsInput', 'startInput', 'durationInput'].forEach(function (id) {
    $(id).addEventListener('input', readSettings);
  });
  $('restInput').addEventListener('change', readSettings);

  function readSettings() {
    state.schedule.settings = {
      courts: $('courtsInput').value,
      start: $('startInput').value,
      duration: Number($('durationInput').value),
      avoidBackToBack: $('restInput').checked
    };
    save();
  }

  $('scheduleBtn').addEventListener('click', function () {
    readSettings();
    var st = state.schedule.settings;
    var courts = st.courts.split(/[,，、\s]+/).map(function (s) { return s.trim(); }).filter(Boolean);
    if (hasSchedule() && !window.confirm('手で直した内容も含めて、今の試合進行表は消えます。作り直してよろしいですか？')) return;
    var res;
    try {
      res = L.scheduleMatches(state.bracket, state.entries, {
        courts: courts,
        start: st.start,
        duration: st.duration,
        restSlots: st.avoidBackToBack ? 1 : 0
      });
    } catch (e) {
      messages($('scheduleMessages'), [e.message]);
      return;
    }
    state.schedule.order = res.order;
    state.schedule.rows = res.rows;
    state.schedule.stale = false;
    messages($('scheduleMessages'), [], res.warnings);
    save();
    renderBracket();
    renderSchedule();
  });

  // 試合進行表の手直し
  $('scheduleArea').addEventListener('input', function (ev) {
    var t = ev.target;
    var id = t.getAttribute('data-match');
    var field = t.getAttribute('data-field');
    if (!id || !field || !state.schedule.rows[id]) return;
    state.schedule.rows[id][field] = t.value;
    save();
    renderBracket();
  });

  // ---------- 印刷 ----------

  document.querySelectorAll('[data-print]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var target = btn.getAttribute('data-print');
      if (target !== 'bracket' && !hasSchedule()) {
        messages($('scheduleMessages'), ['試合進行表がまだありません。「日程を自動作成」を押すと作成されます。']);
        $('schedulePanel').scrollIntoView({ behavior: 'smooth' });
        return;
      }
      document.body.setAttribute('data-print', target);
      selectedSlot = null;
      printingBlank = $('blankInfoInput').checked;
      renderBracket();
      window.print();
    });
  });
  window.addEventListener('afterprint', function () {
    document.body.removeAttribute('data-print');
    if (printingBlank) {
      printingBlank = false;
      renderBracket();
    }
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
      if (state.bracket && !window.confirm('今の内容は消え、読み込んだファイルの内容に置き換わります。よろしいですか？')) return;
      state = next;
      selectedSlot = null;
      messages($('entryMessages'), []);
      messages($('scheduleMessages'), []);
      save();
      renderAll();
      showStale();
    };
    reader.onerror = function () { window.alert('ファイルを読み込めませんでした。'); };
    reader.readAsText(file);
  });

  renderAll();
  showStale();
})();

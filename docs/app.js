(function() {
  var STORAGE_KEY = 'himajikanConfig';
  var REQUEST_TIMEOUT_MS = 25000;
  var IDLE_STATUS = 'ボタンを押しながら話してください';
  // 押しっぱなしのまま放置された場合の保険
  var MAX_HOLD_MS = 60000;

  var micButton = document.getElementById('micButton');
  var statusEl = document.getElementById('status');
  var resultCard = document.getElementById('resultCard');
  var retryButton = document.getElementById('retryButton');
  var textFallback = document.getElementById('textFallback');
  var textInput = document.getElementById('textInput');
  var textSubmit = document.getElementById('textSubmit');
  var settingsButton = document.getElementById('settingsButton');
  var setupPanel = document.getElementById('setupPanel');
  var setupEndpoint = document.getElementById('setupEndpoint');
  var setupSecret = document.getElementById('setupSecret');
  var setupSave = document.getElementById('setupSave');
  var setupError = document.getElementById('setupError');
  var calendarSection = document.getElementById('calendarSection');
  var calendarScroll = document.getElementById('calendarScroll');
  var todayButton = document.getElementById('todayButton');
  var dayDetail = document.getElementById('dayDetail');
  var conversationHint = document.getElementById('conversationHint');
  var conversationReset = document.getElementById('conversationReset');

  var currentConfig = loadConfig();
  var speechSupported = true;
  // 縦に繋げて表示する範囲。休みが入っているのは今年ぶんだけなので前後1年で足りる
  var MONTHS_BACK = 12;
  var MONTHS_FORWARD = 12;
  var MONTH_LOAD_MARGIN_PX = 600;
  var scrollPending = false;
  var monthData = {dayOffSet: {}, eventsByDate: {}};
  // 取得済みの月を保持して、行き来のたびに待たされないようにする。
  // 予定を変更したら丸ごと捨てる（古い内容を見せないため）
  var monthCache = {};
  var monthInFlight = {};
  // 聞き返しをまたいで文脈を保つための会話履歴。用が済んだら捨てる
  var conversation = [];
  var conversationAt = 0;
  var MAX_HISTORY = 10;
  var CONVERSATION_TTL_MS = 3 * 60 * 1000;
  var selectedDate = null;
  var WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土'];

  // 0-7時=睡眠 / 7-18時=仕事 / 18-24時=自由、予定はその上を塗り替える。
  // 睡眠と仕事は毎日同じで読み取る情報が無いので淡くして地に回し、予定だけを図として立たせる
  var DIAL_COLORS = {
    sleep: '#c2d3ea',
    work: '#fdd9b3',
    free: '#ffffff',
    event: '#5b21b6'
  };
  var SLEEP_END_MIN = 7 * 60;
  var WORK_END_MIN = 18 * 60;
  // バーは12時間で40px弱しかなく1時間が約3px。短すぎる予定が消えないよう最低幅を確保する
  var MIN_EVENT_SPAN_MIN = 30;

  function loadConfig() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var cfg = JSON.parse(raw);
      if (cfg && cfg.GAS_ENDPOINT && cfg.SHARED_SECRET) return cfg;
      return null;
    } catch (err) {
      return null;
    }
  }

  function saveConfig(cfg) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  }

  function setStatus(text) {
    statusEl.textContent = text;
    // 高さは固定なので、伸びた文字起こしは末尾（最新の発話）が見えるようにする
    statusEl.scrollTop = statusEl.scrollHeight;
  }

  function showResult(kind, message) {
    resultCard.textContent = message;
    resultCard.className = 'result-card ' + kind;
    resultCard.style.display = 'block';
    retryButton.style.display = (kind === 'error') ? 'inline-block' : 'none';
  }

  function hideResult() {
    resultCard.style.display = 'none';
    retryButton.style.display = 'none';
  }

  function showSetupPanel() {
    setupPanel.style.display = 'block';
    calendarSection.style.display = 'none';
    micButton.style.display = 'none';
    textFallback.style.display = 'none';
    settingsButton.style.display = 'none';
    hideResult();
    clearConversation();
    setStatus('');
    setupError.textContent = '';
    if (currentConfig) {
      setupEndpoint.value = currentConfig.GAS_ENDPOINT;
      setupSecret.value = currentConfig.SHARED_SECRET;
    }
  }

  function showMainUI() {
    setupPanel.style.display = 'none';
    settingsButton.style.display = 'inline-block';
    calendarSection.style.display = 'block';
    textFallback.style.display = 'flex';
    if (speechSupported) {
      micButton.style.display = '';
      setStatus(IDLE_STATUS);
    } else {
      micButton.style.display = 'none';
      setStatus('テキストで入力してください。');
    }
    // 設定前は取得できていないので、設定直後にここで読み込ませる
    scrollToToday();
    loadVisibleMonths();
  }

  setupSave.addEventListener('click', function() {
    var endpoint = setupEndpoint.value.trim();
    var secret = setupSecret.value.trim();
    if (!endpoint || endpoint.indexOf('https://') !== 0) {
      setupError.textContent = 'GAS_ENDPOINTには https:// から始まるURLを入力してください。';
      return;
    }
    if (!secret) {
      setupError.textContent = 'SHARED_SECRETを入力してください。';
      return;
    }
    currentConfig = {GAS_ENDPOINT: endpoint, SHARED_SECRET: secret};
    saveConfig(currentConfig);
    showMainUI();
  });

  settingsButton.addEventListener('click', showSetupPanel);

  function formatIso(d) {
    var pad = function(n) { return ('0' + n).slice(-2); };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function isSameDate(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }

  function buildDayCell(date, today) {
    var cell = document.createElement('div');
    cell.className = 'cal-day';
    if (isSameDate(date, today)) cell.classList.add('today');
    cell.dataset.date = formatIso(date);

    var num = document.createElement('span');
    num.className = 'cal-day-num';
    num.textContent = date.getDate();

    var bars = document.createElement('div');
    bars.className = 'cal-day-bars';
    var amBar = document.createElement('div');
    amBar.className = 'cal-day-bar am';
    var pmBar = document.createElement('div');
    pmBar.className = 'cal-day-bar pm';
    bars.appendChild(amBar);
    bars.appendChild(pmBar);

    cell.appendChild(num);
    cell.appendChild(bars);
    return cell;
  }

  // 月ごとに1ブロック。連続表示なので前後月の日は入れず、月初の曜日ぶんは空セルで詰める
  function buildMonthBlock(year, month, today) {
    var block = document.createElement('section');
    block.className = 'cal-month';
    block.dataset.month = month;
    block.dataset.key = year + '-' + month;

    var head = document.createElement('div');
    head.className = 'cal-month-head';
    head.textContent = year + '年' + (month + 1) + '月';
    block.appendChild(head);

    var grid = document.createElement('div');
    grid.className = 'cal-month-grid';

    var firstWeekday = new Date(year, month, 1).getDay();
    for (var i = 0; i < firstWeekday; i++) {
      var pad = document.createElement('div');
      pad.className = 'cal-day empty';
      grid.appendChild(pad);
    }
    var daysInMonth = new Date(year, month + 1, 0).getDate();
    for (var day = 1; day <= daysInMonth; day++) {
      grid.appendChild(buildDayCell(new Date(year, month, day), today));
    }

    block.appendChild(grid);
    return block;
  }

  function buildCalendar() {
    var today = new Date();
    calendarScroll.innerHTML = '';
    var first = new Date(today.getFullYear(), today.getMonth() - MONTHS_BACK, 1);
    var total = MONTHS_BACK + MONTHS_FORWARD + 1;
    for (var i = 0; i < total; i++) {
      var d = new Date(first.getFullYear(), first.getMonth() + i, 1);
      calendarScroll.appendChild(buildMonthBlock(d.getFullYear(), d.getMonth(), today));
    }
    // 先に今月へ寄せてから読む。順が逆だと1年前の月を取りに行ってしまう
    scrollToToday();
    loadVisibleMonths();
  }

  function scrollToToday() {
    var today = new Date();
    var block = calendarScroll.querySelector(
      '.cal-month[data-key="' + today.getFullYear() + '-' + today.getMonth() + '"]'
    );
    if (block) calendarScroll.scrollTop = block.offsetTop;
  }

  // 見えている（あと少しで見える）月だけ取りに行く。25ヶ月を一度に読むと待たされるため
  function loadVisibleMonths() {
    if (!currentConfig) return;
    var top = calendarScroll.scrollTop - MONTH_LOAD_MARGIN_PX;
    var bottom = calendarScroll.scrollTop + calendarScroll.clientHeight + MONTH_LOAD_MARGIN_PX;
    Array.prototype.forEach.call(calendarScroll.children, function(block) {
      var blockTop = block.offsetTop;
      if (blockTop + block.offsetHeight >= top && blockTop <= bottom) loadMonthBlock(block);
    });
  }

  // 描画が止まっている状況（背景タブ等）でも動くよう rAF ではなく setTimeout で間引く
  calendarScroll.addEventListener('scroll', function() {
    if (scrollPending) return;
    scrollPending = true;
    setTimeout(function() {
      scrollPending = false;
      loadVisibleMonths();
    }, 100);
  });

  function loadMonthBlock(block) {
    if (!currentConfig) return;
    if (block.dataset.loaded === '1' || block.dataset.loading === '1') return;
    block.dataset.loading = '1';

    var parts = block.dataset.key.split('-');
    var year = Number(parts[0]);
    var month = Number(parts[1]);

    requestMonth(new Date(year, month, 1), new Date(year, month + 1, 0))
      .then(function(data) {
        block.dataset.loading = '';
        block.dataset.loaded = '1';
        mergeMonthData(data);
        paintMonthBlock(block, data);
      })
      .catch(function(err) {
        block.dataset.loading = '';
        console.error(err);
      });
  }

  // 日詳細パネルは表示中の月に限らず引けるよう、読み込んだ月を積み上げて持つ
  function mergeMonthData(data) {
    Object.keys(data.dayOffSet).forEach(function(d) { monthData.dayOffSet[d] = true; });
    Object.keys(data.eventsByDate).forEach(function(d) { monthData.eventsByDate[d] = data.eventsByDate[d]; });
  }

  function reloadCalendarData() {
    monthCache = {};
    monthInFlight = {};
    monthData = {dayOffSet: {}, eventsByDate: {}};
    Array.prototype.forEach.call(calendarScroll.children, function(block) {
      block.dataset.loaded = '';
    });
    loadVisibleMonths();
  }

  function baseIntervals(isDayOff) {
    if (isDayOff) {
      return [
        {s: 0, e: SLEEP_END_MIN, c: DIAL_COLORS.sleep},
        {s: SLEEP_END_MIN, e: 1440, c: DIAL_COLORS.free}
      ];
    }
    return [
      {s: 0, e: SLEEP_END_MIN, c: DIAL_COLORS.sleep},
      {s: SLEEP_END_MIN, e: WORK_END_MIN, c: DIAL_COLORS.work},
      {s: WORK_END_MIN, e: 1440, c: DIAL_COLORS.free}
    ];
  }

  function overlayEvents(base, events) {
    var result = base;
    (events || []).forEach(function(ev) {
      var s = ev.s;
      var e = ev.e;
      if (e - s < MIN_EVENT_SPAN_MIN) e = Math.min(1440, s + MIN_EVENT_SPAN_MIN);
      var next = [];
      result.forEach(function(seg) {
        if (e <= seg.s || s >= seg.e) { next.push(seg); return; }
        if (s > seg.s) next.push({s: seg.s, e: s, c: seg.c});
        if (e < seg.e) next.push({s: e, e: seg.e, c: seg.c});
      });
      next.push({s: s, e: e, c: DIAL_COLORS.event});
      next.sort(function(a, b) { return a.s - b.s; });
      result = next;
    });
    return result;
  }

  // intervals のうち [from, to) の範囲だけを横バーのグラデーションに変換する
  function toLinearGradient(intervals, from, to) {
    var span = to - from;
    var parts = intervals
      .filter(function(seg) { return seg.e > from && seg.s < to; })
      .map(function(seg) {
        var a = ((seg.s > from ? seg.s : from) - from) / span * 100;
        var b = ((seg.e < to ? seg.e : to) - from) / span * 100;
        return seg.c + ' ' + a.toFixed(2) + '% ' + b.toFixed(2) + '%';
      });
    return 'linear-gradient(to right, ' + parts.join(', ') + ')';
  }

  function rangeKey(rangeStart, rangeEnd) {
    return formatIso(rangeStart) + '_' + formatIso(rangeEnd);
  }

  function requestMonth(rangeStart, rangeEnd) {
    var key = rangeKey(rangeStart, rangeEnd);
    if (monthCache[key]) return Promise.resolve(monthCache[key]);
    // 同じ範囲が同時に要求されることがある（起動時や先読みと表示の重なり）ので1本にまとめる
    if (monthInFlight[key]) return monthInFlight[key];

    var url = currentConfig.GAS_ENDPOINT +
      '?action=calendarMonth&start=' + formatIso(rangeStart) + '&end=' + formatIso(rangeEnd) +
      '&secret=' + encodeURIComponent(currentConfig.SHARED_SECRET);

    var pending = fetch(url)
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (data.status !== 'ok') throw new Error(data.message || 'calendarMonth failed');
        var dayOffSet = {};
        (data.dayOffDates || []).forEach(function(d) { dayOffSet[d] = true; });
        var parsed = {dayOffSet: dayOffSet, eventsByDate: data.events || {}};
        monthCache[key] = parsed;
        delete monthInFlight[key];
        return parsed;
      })
      .catch(function(err) {
        delete monthInFlight[key];
        throw err;
      });

    monthInFlight[key] = pending;
    return pending;
  }

  function paintMonthBlock(block, data) {
    var cells = Array.prototype.slice.call(block.querySelector('.cal-month-grid').children);

    cells.forEach(function(cell) {
      if (cell.classList.contains('empty')) return;
      var date = cell.dataset.date;
      var isDayOff = !!data.dayOffSet[date];
      cell.classList.toggle('dayoff', isDayOff);
      var segments = overlayEvents(baseIntervals(isDayOff), data.eventsByDate[date]);
      cell.querySelector('.am').style.background = toLinearGradient(segments, 0, 720);
      cell.querySelector('.pm').style.background = toLinearGradient(segments, 720, 1440);
    });

    // 連休は1本の帯に見せたいので、ブロックの両端だけ角を丸める（週をまたぐ側は丸めない）
    cells.forEach(function(cell, i) {
      if (cell.classList.contains('empty')) return;
      var prev = (i % 7 === 0) ? null : cells[i - 1];
      var next = (i % 7 === 6) ? null : cells[i + 1];
      var isDayOff = cell.classList.contains('dayoff');
      cell.classList.toggle('block-start', isDayOff && (!prev || !prev.classList.contains('dayoff')));
      cell.classList.toggle('block-end', isDayOff && (!next || !next.classList.contains('dayoff')));
    });

    // 削除などで内容が変わった後も開いたままのパネルを最新にする
    if (selectedDate) renderDayDetail(selectedDate);
  }

  function formatDateJa(dateIso) {
    var parts = dateIso.split('-').map(Number);
    var d = new Date(parts[0], parts[1] - 1, parts[2]);
    return (d.getMonth() + 1) + '/' + d.getDate() + '(' + WEEKDAY_JA[d.getDay()] + ')';
  }

  function formatMinutes(minutes) {
    return Math.floor(minutes / 60) % 24 + ':' + ('0' + (minutes % 60)).slice(-2);
  }

  function renderDayDetail(dateIso) {
    var isDayOff = !!monthData.dayOffSet[dateIso];
    var events = (monthData.eventsByDate[dateIso] || [])
      .slice()
      .sort(function(a, b) { return a.s - b.s; });

    var html = '<div class="day-detail-head">' + formatDateJa(dateIso) +
      '<span class="day-detail-tag' + (isDayOff ? ' off' : '') + '">' +
      (isDayOff ? '休み' : '仕事') + '</span></div>';

    if (!events.length) {
      html += '<div class="day-detail-empty">予定はありません</div>';
    } else {
      html += '<ul class="day-detail-list">' + events.map(function(ev) {
        return '<li><span class="time">' + formatMinutes(ev.s) + '〜' + formatMinutes(ev.e) +
          '</span><span>' + escapeHtml(ev.t || '') + '</span></li>';
      }).join('') + '</ul>';
    }

    dayDetail.innerHTML = html;
    dayDetail.style.display = 'block';
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, function(ch) {
      return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[ch];
    });
  }

  function selectDate(dateIso) {
    // 同じ日をもう一度タップしたら閉じる
    if (selectedDate === dateIso) {
      selectedDate = null;
      dayDetail.style.display = 'none';
    } else {
      selectedDate = dateIso;
      renderDayDetail(dateIso);
    }
    Array.prototype.forEach.call(calendarScroll.querySelectorAll('.cal-day'), function(cell) {
      cell.classList.toggle('selected', cell.dataset.date === selectedDate);
    });
  }

  calendarScroll.addEventListener('click', function(event) {
    var cell = event.target.closest('.cal-day');
    if (cell && cell.dataset.date) selectDate(cell.dataset.date);
  });

  todayButton.addEventListener('click', scrollToToday);

  function speak(text) {
    if (!window.speechSynthesis) return;
    var utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'ja-JP';
    window.speechSynthesis.speak(utterance);
  }

  function clearConversation() {
    conversation = [];
    conversationAt = 0;
    conversationHint.style.display = 'none';
  }

  // 聞き返しの往復だけを引き継ぐ。用が済んだ（ok/rejected/error）時点で捨てる
  function continueConversation(transcript, reply) {
    conversation.push({role: 'user', text: transcript});
    conversation.push({role: 'model', text: reply});
    if (conversation.length > MAX_HISTORY) {
      conversation = conversation.slice(-MAX_HISTORY);
    }
    conversationAt = Date.now();
    conversationHint.style.display = 'flex';
  }

  function sendToBackend(transcript) {
    if (!currentConfig) {
      showSetupPanel();
      return;
    }

    // 前の会話から時間が空いていたら別件とみなす
    if (conversation.length && Date.now() - conversationAt > CONVERSATION_TTL_MS) {
      clearConversation();
    }

    setStatus('送信中...');
    hideResult();

    var controller = new AbortController();
    var timeoutId = setTimeout(function() { controller.abort(); }, REQUEST_TIMEOUT_MS);

    fetch(currentConfig.GAS_ENDPOINT, {
      method: 'POST',
      // GASのCORSプリフライト回避のため text/plain で送る（JSON文字列はそのままbodyに入れる）
      headers: {'Content-Type': 'text/plain;charset=utf-8'},
      body: JSON.stringify({
        transcript: transcript,
        history: conversation,
        secret: currentConfig.SHARED_SECRET
      }),
      signal: controller.signal
    })
      .then(function(res) { return res.json(); })
      .then(function(data) {
        clearTimeout(timeoutId);
        setStatus(IDLE_STATUS);
        if (data.status === 'clarify') {
          continueConversation(transcript, data.message);
          showResult('clarify', data.message);
          speak(data.message);
          return;
        }

        clearConversation();
        if (data.status === 'ok') {
          showResult('ok', data.message);
          speak(data.message);
          // 予定が変わったのでキャッシュを捨てて取り直す
          if (data.type === 'add_event' || data.type === 'delete_event' || data.type === 'update_event') {
            reloadCalendarData();
          }
        } else if (data.status === 'rejected') {
          showResult('rejected', data.message);
          speak(data.message);
        } else {
          showResult('error', data.message || '不明なエラーが発生しました。');
        }
      })
      .catch(function(err) {
        clearTimeout(timeoutId);
        setStatus(IDLE_STATUS);
        console.error(err);
        clearConversation();
        showResult('error', 'サーバーとの通信に失敗しました。もう一度お試しください。');
      });
  }

  function setupSpeechRecognition() {
    var SpeechRecognitionImpl = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionImpl) {
      speechSupported = false;
      micButton.style.display = 'none';
      return;
    }

    var recognition = new SpeechRecognitionImpl();
    recognition.lang = 'ja-JP';
    // continuous を立てないと、ひと区切りの短い無音で勝手に打ち切られる
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    var listening = false;
    var stopRequested = false; // 自分で止めたのか、勝手に切れたのかの区別
    var committedText = '';    // 途中で再開をまたいで確定した分
    var sessionText = '';      // いま動いている認識セッションで確定した分
    var holdTimer = null;

    function finishListening() {
      clearTimeout(holdTimer);
      listening = false;
      micButton.classList.remove('listening');
      var text = (committedText + sessionText).trim();
      committedText = '';
      sessionText = '';
      if (text) {
        sendToBackend(text);
      } else {
        setStatus('聞き取れませんでした。もう一度お試しください');
      }
    }

    recognition.onresult = function(event) {
      var finals = '';
      var interim = '';
      for (var i = 0; i < event.results.length; i++) {
        var result = event.results[i];
        if (result.isFinal) {
          finals += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }
      // 同じ確定結果が何度も配信されることがあるので、足し込まず毎回組み立て直す
      sessionText = finals;
      setStatus((committedText + sessionText + interim) || '聞き取り中...');
    };

    recognition.onerror = function(event) {
      // continuous では無音のたびに no-speech が来る。指を離すまで聞き続ける
      if (event.error === 'no-speech') return;

      clearTimeout(holdTimer);
      stopRequested = true;
      listening = false;
      micButton.classList.remove('listening');
      if (event.error === 'not-allowed') {
        setStatus('マイクの使用が許可されていません。');
      } else if (event.error === 'aborted') {
        setStatus(IDLE_STATUS);
      } else {
        console.error(event.error);
        setStatus('音声認識でエラーが発生しました。もう一度お試しください');
      }
    };

    recognition.onend = function() {
      // Android Chrome は continuous でも勝手に終わることがあるので、
      // 指が離れていない限りは黙って聞き直す
      if (listening && !stopRequested) {
        // 再開すると results が空に戻るので、ここまでの確定分を退避しておく
        committedText += sessionText;
        sessionText = '';
        try {
          recognition.start();
          return;
        } catch (err) {
          console.warn(err);
        }
      }
      if (listening) finishListening();
    };

    function startHold() {
      if (!currentConfig) {
        showSetupPanel();
        return;
      }
      if (listening) return;
      hideResult();
      committedText = '';
      sessionText = '';
      stopRequested = false;
      listening = true;
      micButton.classList.add('listening');
      setStatus('聞き取り中...（離すと送信）');
      try {
        recognition.start();
        holdTimer = setTimeout(endHold, MAX_HOLD_MS);
      } catch (err) {
        console.error(err);
        listening = false;
        micButton.classList.remove('listening');
        setStatus('音声認識を開始できませんでした。');
      }
    }

    function endHold() {
      if (!listening) return;
      clearTimeout(holdTimer);
      stopRequested = true;
      // stop() の後に onend が来て finishListening() が走り、そこで送信される
      try {
        recognition.stop();
      } catch (err) {
        console.warn(err);
        finishListening();
      }
    }

    // 押している間だけ録る。pointer系でマウスとタッチをまとめて扱う
    micButton.addEventListener('pointerdown', function(event) {
      event.preventDefault();
      // 指が少しずれただけで離したと判定されないよう、ポインタをボタンに固定する。
      // 固定すると pointerleave は飛ばないので、終了は pointerup / pointercancel だけを見る
      if (micButton.setPointerCapture) {
        try { micButton.setPointerCapture(event.pointerId); } catch (err) { console.warn(err); }
      }
      startHold();
    });
    ['pointerup', 'pointercancel'].forEach(function(name) {
      micButton.addEventListener(name, function(event) {
        event.preventDefault();
        endHold();
      });
    });
    // 長押しでコンテキストメニューが出ると指を離すイベントを取り逃がす
    micButton.addEventListener('contextmenu', function(event) { event.preventDefault(); });
  }

  textSubmit.addEventListener('click', function() {
    var value = textInput.value.trim();
    if (!value) return;
    sendToBackend(value);
    textInput.value = '';
  });

  textInput.addEventListener('keydown', function(event) {
    if (event.key === 'Enter') {
      textSubmit.click();
    }
  });

  retryButton.addEventListener('click', function() {
    hideResult();
  });

  conversationReset.addEventListener('click', function() {
    clearConversation();
    hideResult();
    setStatus(IDLE_STATUS);
  });

  if (!window.isSecureContext) {
    speechSupported = false;
    micButton.style.display = 'none';
    setStatus('この機能はHTTPS環境が必要です。');
  } else {
    setupSpeechRecognition();
  }

  buildCalendar();

  if (currentConfig) {
    showMainUI();
  } else {
    showSetupPanel();
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').catch(function(err) {
      console.warn('Service worker registration failed', err);
    });
  }
})();

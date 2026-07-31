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
  var calMonthLabel = document.getElementById('calMonthLabel');
  var calendarGrid = document.getElementById('calendarGrid');
  var calPrev = document.getElementById('calPrev');
  var calNext = document.getElementById('calNext');
  var dayDetail = document.getElementById('dayDetail');
  var conversationHint = document.getElementById('conversationHint');
  var conversationReset = document.getElementById('conversationReset');

  var currentConfig = loadConfig();
  var speechSupported = true;
  var calViewYear, calViewMonth;
  var gridRangeStart, gridRangeEnd;
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
    fetchMonthData(gridRangeStart, gridRangeEnd);
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

  function initCalendar() {
    var now = new Date();
    calViewYear = now.getFullYear();
    calViewMonth = now.getMonth();
    renderCalendar();
  }

  // その月のカレンダーが覆う日曜始まりの範囲
  function gridRangeFor(year, month) {
    var gridStart = new Date(year, month, 1);
    gridStart.setDate(gridStart.getDate() - gridStart.getDay());
    var gridEnd = new Date(year, month + 1, 0);
    gridEnd.setDate(gridEnd.getDate() + (6 - gridEnd.getDay()));
    return {start: gridStart, end: gridEnd};
  }

  function renderCalendar() {
    calMonthLabel.textContent = calViewYear + '年' + (calViewMonth + 1) + '月';

    var range = gridRangeFor(calViewYear, calViewMonth);
    var gridStart = range.start;
    var gridEnd = range.end;

    gridRangeStart = gridStart;
    gridRangeEnd = gridEnd;

    // 月を移動したらセルが作り直されるので選択状態は解除する
    selectedDate = null;
    dayDetail.style.display = 'none';

    var today = new Date();
    calendarGrid.innerHTML = '';
    var cursor = new Date(gridStart);
    while (cursor <= gridEnd) {
      var cell = document.createElement('div');
      cell.className = 'cal-day';
      if (cursor.getMonth() !== calViewMonth) cell.classList.add('other-month');
      if (isSameDate(cursor, today)) cell.classList.add('today');
      cell.dataset.date = formatIso(cursor);

      var num = document.createElement('span');
      num.className = 'cal-day-num';
      num.textContent = cursor.getDate();

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
      calendarGrid.appendChild(cell);
      cursor.setDate(cursor.getDate() + 1);
    }

    fetchMonthData(gridStart, gridEnd);
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

  function applyMonthData(data) {
    monthData = data;
    var cells = Array.prototype.slice.call(calendarGrid.children);

    cells.forEach(function(cell) {
      var date = cell.dataset.date;
      var isDayOff = !!data.dayOffSet[date];
      cell.classList.toggle('dayoff', isDayOff);
      var segments = overlayEvents(baseIntervals(isDayOff), data.eventsByDate[date]);
      cell.querySelector('.am').style.background = toLinearGradient(segments, 0, 720);
      cell.querySelector('.pm').style.background = toLinearGradient(segments, 720, 1440);
    });

    // 連休は1本の帯に見せたいので、ブロックの両端だけ角を丸める（週をまたぐ側は丸めない）
    cells.forEach(function(cell, i) {
      var prev = (i % 7 === 0) ? null : cells[i - 1];
      var next = (i % 7 === 6) ? null : cells[i + 1];
      var isDayOff = cell.classList.contains('dayoff');
      cell.classList.toggle('block-start', isDayOff && (!prev || !prev.classList.contains('dayoff')));
      cell.classList.toggle('block-end', isDayOff && (!next || !next.classList.contains('dayoff')));
    });

    // 削除などで内容が変わった後も開いたままのパネルを最新にする
    if (selectedDate) renderDayDetail(selectedDate);
  }

  // 表示中の月の前後を裏で取っておく。次/前を押した時点で待ち時間が無くなる
  function prefetchNeighbours() {
    if (!currentConfig) return;
    [-1, 1].forEach(function(offset) {
      var month = calViewMonth + offset;
      var year = calViewYear;
      if (month < 0) { month = 11; year--; }
      if (month > 11) { month = 0; year++; }
      var range = gridRangeFor(year, month);
      if (monthCache[rangeKey(range.start, range.end)]) return;
      requestMonth(range.start, range.end).catch(function(err) { console.warn(err); });
    });
  }

  function fetchMonthData(rangeStart, rangeEnd) {
    if (!currentConfig || !rangeStart || !rangeEnd) return;
    var requestedKey = rangeKey(rangeStart, rangeEnd);
    requestMonth(rangeStart, rangeEnd)
      .then(function(data) {
        // 取得中に月を切り替えられていたら、古い月のデータを描き込まない
        if (rangeKey(gridRangeStart, gridRangeEnd) !== requestedKey) return;
        applyMonthData(data);
        prefetchNeighbours();
      })
      .catch(function(err) { console.error(err); });
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
    Array.prototype.forEach.call(calendarGrid.children, function(cell) {
      cell.classList.toggle('selected', cell.dataset.date === selectedDate);
    });
  }

  calendarGrid.addEventListener('click', function(event) {
    var cell = event.target.closest('.cal-day');
    if (cell && cell.dataset.date) selectDate(cell.dataset.date);
  });

  calPrev.addEventListener('click', function() {
    calViewMonth--;
    if (calViewMonth < 0) { calViewMonth = 11; calViewYear--; }
    renderCalendar();
  });

  calNext.addEventListener('click', function() {
    calViewMonth++;
    if (calViewMonth > 11) { calViewMonth = 0; calViewYear++; }
    renderCalendar();
  });

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
            monthCache = {};
            monthInFlight = {};
            fetchMonthData(gridRangeStart, gridRangeEnd);
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
    var finalText = '';
    var holdTimer = null;

    function finishListening() {
      clearTimeout(holdTimer);
      listening = false;
      micButton.classList.remove('listening');
      var text = finalText.trim();
      finalText = '';
      if (text) {
        sendToBackend(text);
      } else {
        setStatus('聞き取れませんでした。もう一度お試しください');
      }
    }

    recognition.onresult = function(event) {
      var interim = '';
      for (var i = event.resultIndex; i < event.results.length; i++) {
        var result = event.results[i];
        if (result.isFinal) {
          finalText += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }
      setStatus((finalText + interim) || '聞き取り中...');
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
      finalText = '';
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
      startHold();
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function(name) {
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

  initCalendar();

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

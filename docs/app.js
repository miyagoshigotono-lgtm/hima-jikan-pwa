(function() {
  var STORAGE_KEY = 'himajikanConfig';
  var REQUEST_TIMEOUT_MS = 25000;

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

  var currentConfig = loadConfig();
  var speechSupported = true;
  var calViewYear, calViewMonth;
  var gridRangeStart, gridRangeEnd;

  // 24時間リングの配色。0-7時=睡眠 / 7-18時=仕事 / 18-24時=自由、予定はその上を塗り替える
  var DIAL_COLORS = {
    sleep: '#0f3b7c',
    work: '#fb7a00',
    free: '#ffffff',
    event: '#805ad5'
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
      setStatus('タップして話しかけてください');
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

  function renderCalendar() {
    calMonthLabel.textContent = calViewYear + '年' + (calViewMonth + 1) + '月';

    var firstOfMonth = new Date(calViewYear, calViewMonth, 1);
    var lastOfMonth = new Date(calViewYear, calViewMonth + 1, 0);
    var gridStart = new Date(firstOfMonth);
    gridStart.setDate(gridStart.getDate() - gridStart.getDay());
    var gridEnd = new Date(lastOfMonth);
    gridEnd.setDate(gridEnd.getDate() + (6 - gridEnd.getDay()));

    gridRangeStart = gridStart;
    gridRangeEnd = gridEnd;

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

  function fetchMonthData(rangeStart, rangeEnd) {
    if (!currentConfig || !rangeStart || !rangeEnd) return;
    var url = currentConfig.GAS_ENDPOINT +
      '?action=calendarMonth&start=' + formatIso(rangeStart) + '&end=' + formatIso(rangeEnd) +
      '&secret=' + encodeURIComponent(currentConfig.SHARED_SECRET);
    fetch(url)
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (data.status !== 'ok') return;
        var dayOffSet = {};
        (data.dayOffDates || []).forEach(function(d) { dayOffSet[d] = true; });
        var eventsByDate = data.events || {};
        var cells = Array.prototype.slice.call(calendarGrid.children);

        cells.forEach(function(cell) {
          var date = cell.dataset.date;
          var isDayOff = !!dayOffSet[date];
          cell.classList.toggle('dayoff', isDayOff);
          var segments = overlayEvents(baseIntervals(isDayOff), eventsByDate[date]);
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
      })
      .catch(function(err) { console.error(err); });
  }

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

  function sendToBackend(transcript) {
    if (!currentConfig) {
      showSetupPanel();
      return;
    }

    setStatus('送信中...');
    hideResult();

    var controller = new AbortController();
    var timeoutId = setTimeout(function() { controller.abort(); }, REQUEST_TIMEOUT_MS);

    fetch(currentConfig.GAS_ENDPOINT, {
      method: 'POST',
      // GASのCORSプリフライト回避のため text/plain で送る（JSON文字列はそのままbodyに入れる）
      headers: {'Content-Type': 'text/plain;charset=utf-8'},
      body: JSON.stringify({transcript: transcript, secret: currentConfig.SHARED_SECRET}),
      signal: controller.signal
    })
      .then(function(res) { return res.json(); })
      .then(function(data) {
        clearTimeout(timeoutId);
        setStatus('タップして話しかけてください');
        if (data.status === 'ok') {
          showResult('ok', data.message);
          speak(data.message);
          // 予定が増えたのでカレンダーのリングを描き直す
          if (data.type === 'add_event') fetchMonthData(gridRangeStart, gridRangeEnd);
        } else if (data.status === 'rejected') {
          showResult('rejected', data.message);
          speak(data.message);
        } else if (data.status === 'clarify') {
          showResult('clarify', data.message);
        } else {
          showResult('error', data.message || '不明なエラーが発生しました。');
        }
      })
      .catch(function(err) {
        clearTimeout(timeoutId);
        setStatus('タップして話しかけてください');
        console.error(err);
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
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    var listening = false;

    recognition.onresult = function(event) {
      var transcript = event.results[0][0].transcript;
      sendToBackend(transcript);
    };

    recognition.onerror = function(event) {
      listening = false;
      micButton.classList.remove('listening');
      if (event.error === 'no-speech') {
        setStatus('聞き取れませんでした。もう一度お試しください');
      } else if (event.error === 'not-allowed') {
        setStatus('マイクの使用が許可されていません。');
      } else {
        setStatus('音声認識でエラーが発生しました。もう一度お試しください');
      }
    };

    recognition.onend = function() {
      listening = false;
      micButton.classList.remove('listening');
    };

    micButton.addEventListener('click', function() {
      if (!currentConfig) {
        showSetupPanel();
        return;
      }
      if (listening) {
        recognition.stop();
        return;
      }
      hideResult();
      listening = true;
      micButton.classList.add('listening');
      setStatus('聞き取り中...');
      try {
        recognition.start();
      } catch (err) {
        console.error(err);
        listening = false;
        micButton.classList.remove('listening');
        setStatus('音声認識を開始できませんでした。');
      }
    });
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

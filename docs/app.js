(function() {
  var micButton = document.getElementById('micButton');
  var statusEl = document.getElementById('status');
  var resultCard = document.getElementById('resultCard');
  var retryButton = document.getElementById('retryButton');
  var textFallback = document.getElementById('textFallback');
  var textInput = document.getElementById('textInput');
  var textSubmit = document.getElementById('textSubmit');

  var REQUEST_TIMEOUT_MS = 25000;

  function isConfigured() {
    var cfg = window.APP_CONFIG;
    return !!(cfg && cfg.GAS_ENDPOINT && cfg.GAS_ENDPOINT.indexOf('XXXX') === -1);
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

  function sendToBackend(transcript) {
    if (!isConfigured()) {
      showResult('error', 'config.js が未設定です。config.example.js をコピーして GAS_ENDPOINT と SHARED_SECRET を設定してください。');
      return;
    }

    setStatus('送信中...');
    hideResult();

    var controller = new AbortController();
    var timeoutId = setTimeout(function() { controller.abort(); }, REQUEST_TIMEOUT_MS);

    fetch(window.APP_CONFIG.GAS_ENDPOINT, {
      method: 'POST',
      // GASのCORSプリフライト回避のため text/plain で送る（JSON文字列はそのままbodyに入れる）
      headers: {'Content-Type': 'text/plain;charset=utf-8'},
      body: JSON.stringify({transcript: transcript, secret: window.APP_CONFIG.SHARED_SECRET}),
      signal: controller.signal
    })
      .then(function(res) { return res.json(); })
      .then(function(data) {
        clearTimeout(timeoutId);
        setStatus('タップして話しかけてください');
        if (data.status === 'ok') {
          showResult('ok', data.message);
          if (window.speechSynthesis) {
            var utterance = new SpeechSynthesisUtterance(data.message);
            utterance.lang = 'ja-JP';
            window.speechSynthesis.speak(utterance);
          }
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
      micButton.style.display = 'none';
      textFallback.style.display = 'flex';
      setStatus('この端末は音声入力に対応していません。テキストで入力してください。');
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
    setStatus('この機能はHTTPS環境が必要です。');
  } else {
    setupSpeechRecognition();
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').catch(function(err) {
      console.warn('Service worker registration failed', err);
    });
  }
})();

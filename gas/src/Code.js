function doGet(e) {
  var params = e.parameter || {};
  if (params.action === 'calendarMonth') {
    return handleCalendarMonth(params);
  }
  return ContentService.createTextOutput('OK').setMimeType(ContentService.MimeType.TEXT);
}

function handleCalendarMonth(params) {
  var sharedSecret = PropertiesService.getScriptProperties().getProperty('SHARED_SECRET');
  if (!sharedSecret || params.secret !== sharedSecret) {
    return jsonOutput({status: 'error', message: '認証エラー'});
  }
  if (!params.start || !params.end) {
    return jsonOutput({status: 'error', message: 'start/endパラメータが必要です'});
  }
  try {
    var dayOffDates = CalendarService.fetchDayOffDates(
      parseIsoDate(params.start),
      parseIsoDate(addDays(params.end, 1))
    );
    return jsonOutput({status: 'ok', dayOffDates: dayOffDates});
  } catch (err) {
    console.error(err);
    return jsonOutput({status: 'error', message: 'カレンダーの取得に失敗しました。'});
  }
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var sharedSecret = PropertiesService.getScriptProperties().getProperty('SHARED_SECRET');
    if (!sharedSecret || body.secret !== sharedSecret) {
      return jsonOutput({status: 'error', message: '認証エラー'});
    }
    return jsonOutput(handleRequest(body.transcript));
  } catch (err) {
    console.error(err);
    return jsonOutput({status: 'error', message: 'サーバーでエラーが発生しました。時間をおいて再度お試しください。'});
  }
}

function jsonOutput(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function handleRequest(transcript) {
  if (!transcript || !transcript.trim()) {
    return {status: 'clarify', message: '発話内容が空でした。もう一度お話しください。'};
  }

  var todayIso = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd');
  var extraction;
  try {
    extraction = IntentService.classifyAndExtract(transcript, todayIso);
  } catch (err) {
    console.error(err);
    return {status: 'error', message: '音声内容の解析に失敗しました。もう一度お試しください。'};
  }

  if (extraction.clarificationNeeded) {
    return {status: 'clarify', message: extraction.clarificationNeeded};
  }

  if (extraction.intent === 'add_event') {
    if (!extraction.addEvent || !extraction.addEvent.title || !extraction.addEvent.startDateTime) {
      return {status: 'clarify', message: '予定のタイトルと日時をもう少し詳しく教えてください。'};
    }
    return handleAddEvent(extraction.addEvent);
  }

  if (extraction.intent === 'query_free_time') {
    if (!extraction.freeTimeQuery || !extraction.freeTimeQuery.periodStart || !extraction.freeTimeQuery.periodEnd) {
      return {status: 'clarify', message: 'いつからいつまでの範囲か、もう少し詳しく教えてください。'};
    }
    return handleFreeTimeQuery(extraction.freeTimeQuery);
  }

  return {status: 'clarify', message: 'ご要望が予定追加か空き時間照会か判断できませんでした。もう一度お話しください。'};
}

function handleAddEvent(fields) {
  try {
    var event = CalendarService.createCalendarEvent(fields);
    return {
      status: 'ok',
      type: 'add_event',
      message: '「' + fields.title + '」を追加しました。',
      event: {
        title: fields.title,
        start: event.getStartTime().toISOString(),
        end: event.getEndTime().toISOString()
      }
    };
  } catch (err) {
    console.error(err);
    return {status: 'error', message: '予定の追加に失敗しました。もう一度お試しください。'};
  }
}

function handleFreeTimeQuery(query) {
  var spanDays = (parseIsoDate(query.periodEnd) - parseIsoDate(query.periodStart)) / 86400000;
  if (spanDays < 0 || spanDays > CONFIG.MAX_QUERY_SPAN_DAYS) {
    return {
      status: 'clarify',
      message: '照会範囲が広すぎるか不正です。' + CONFIG.MAX_QUERY_SPAN_DAYS + '日以内の範囲で聞き直してください。'
    };
  }

  var padStart = addDays(query.periodStart, -CONFIG.BLOCK_PADDING_DAYS);
  var padEnd = addDays(query.periodEnd, CONFIG.BLOCK_PADDING_DAYS);

  var dayOffDates, allFree = [];
  try {
    dayOffDates = CalendarService.fetchDayOffDates(parseIsoDate(padStart), parseIsoDate(padEnd));

    var blocks = FreeTime.mergeConsecutiveDates(dayOffDates);
    var windows = blocks.map(function(b) { return FreeTime.blockToWindow(b); });

    var qStart = toTokyoDate(query.periodStart, 0, 0);
    var qEnd = toTokyoDate(query.periodEnd, 23, 59);
    var qualifying = windows.filter(function(w) { return FreeTime.windowOverlapsRange(w, qStart, qEnd); });

    qualifying.forEach(function(w) {
      var busy = CalendarService.fetchBusyIntervals(w.windowStart, w.windowEnd);
      allFree = allFree.concat(FreeTime.subtractIntervals(w, busy));
    });
  } catch (err) {
    console.error(err);
    return {status: 'error', message: 'カレンダーの取得に失敗しました。もう一度お試しください。'};
  }

  var answer;
  try {
    answer = AnswerService.generateFreeTimeAnswer(query.periodDescription, allFree);
  } catch (err) {
    console.error(err);
    answer = AnswerService.formatIntervalsFallback(allFree);
  }

  return {
    status: 'ok',
    type: 'query_free_time',
    message: answer,
    freeIntervals: allFree.map(function(f) {
      return {start: f.start.toISOString(), end: f.end.toISOString()};
    })
  };
}

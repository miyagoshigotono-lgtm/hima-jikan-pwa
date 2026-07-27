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
    var rangeStart = parseIsoDate(params.start);
    var rangeEnd = parseIsoDate(addDays(params.end, 1));
    return jsonOutput({
      status: 'ok',
      dayOffDates: CalendarService.fetchDayOffDates(rangeStart, rangeEnd),
      events: CalendarService.fetchTimedEventsByDate(rangeStart, rangeEnd)
    });
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
    if (!extraction.addEvent || !extraction.addEvent.title || !extraction.addEvent.date) {
      return {status: 'clarify', message: '予定のタイトルと日付をもう少し詳しく教えてください。'};
    }
    return handleAddEvent(extraction.addEvent);
  }

  if (extraction.intent === 'query_free_time') {
    if (!extraction.freeTimeQuery || !extraction.freeTimeQuery.periodStart || !extraction.freeTimeQuery.periodEnd) {
      return {status: 'clarify', message: 'いつからいつまでの範囲か、もう少し詳しく教えてください。'};
    }
    return handleFreeTimeQuery(extraction.freeTimeQuery);
  }

  if (extraction.intent === 'query_free_evenings') {
    if (!extraction.freeEveningsQuery || !extraction.freeEveningsQuery.periodStart || !extraction.freeEveningsQuery.periodEnd) {
      return {status: 'clarify', message: 'いつからいつまでの範囲か、もう少し詳しく教えてください。'};
    }
    return handleFreeEveningsQuery(extraction.freeEveningsQuery);
  }

  return {status: 'clarify', message: 'ご要望が予定追加か空き時間照会か判断できませんでした。もう一度お話しください。'};
}

// 期間の妥当性チェック。問題なければ null を返す
function validateQuerySpan(periodStart, periodEnd) {
  var spanDays = (parseIsoDate(periodEnd) - parseIsoDate(periodStart)) / 86400000;
  if (spanDays < 0 || spanDays > CONFIG.MAX_QUERY_SPAN_DAYS) {
    return {
      status: 'clarify',
      message: '照会範囲が広すぎるか不正です。' + CONFIG.MAX_QUERY_SPAN_DAYS + '日以内の範囲で聞き直してください。'
    };
  }
  return null;
}

// 予定は重ならないことを前提に管理する。衝突する場合は追加せず rejected を返し、
// ユーザーには改めて空き状況を照会してもらう（会話を続けない単発完結の設計）
function handleAddEvent(fields) {
  var dateIso = fields.date;
  var duration = CONFIG.DEFAULT_EVENT_DURATION_MIN;

  var isDayOff, dayEvents;
  try {
    var dayStart = parseIsoDate(dateIso);
    var dayEnd = parseIsoDate(addDays(dateIso, 1));
    isDayOff = CalendarService.fetchDayOffDates(dayStart, dayEnd).indexOf(dateIso) !== -1;
    dayEvents = CalendarService.fetchTimedEventsByDate(dayStart, dayEnd)[dateIso] || [];
  } catch (err) {
    console.error(err);
    return {status: 'error', message: 'カレンダーの取得に失敗しました。もう一度お試しください。'};
  }

  var startMin, endMin;

  if (fields.startTime) {
    startMin = parseHhMm(fields.startTime);
    endMin = fields.endTime ? parseHhMm(fields.endTime) : startMin + duration;
    if (endMin <= startMin) endMin = startMin + duration;

    var conflicts = Scheduling.findConflicts(isDayOff, dayEvents, startMin, endMin);
    if (conflicts.work) {
      return {
        status: 'rejected',
        type: 'add_event',
        message: formatDateJa(dateIso) + 'は仕事です（' + CONFIG.WORK_START_HOUR + '時〜' + CONFIG.WORK_END_HOUR +
          '時）。「' + fields.title + '」は追加していません。'
      };
    }
    if (conflicts.events.length) {
      var names = conflicts.events.map(function(ev) { return '「' + ev.t + '」'; }).join('、');
      return {
        status: 'rejected',
        type: 'add_event',
        message: formatDateJa(dateIso) + ' ' + formatMinutes(startMin) + 'は' + names +
          'が入っています。「' + fields.title + '」は追加していません。'
      };
    }
  } else {
    var slot = Scheduling.findAutoSlot(isDayOff, dayEvents, duration);
    if (!slot) {
      return {
        status: 'rejected',
        type: 'add_event',
        message: formatDateJa(dateIso) + 'は空きがありません。「' + fields.title + '」は追加していません。'
      };
    }
    startMin = slot.s;
    endMin = slot.e;
  }

  try {
    var event = CalendarService.createCalendarEvent({
      title: fields.title,
      start: minutesToDate(dateIso, startMin),
      end: minutesToDate(dateIso, endMin),
      location: fields.location,
      notes: fields.notes
    });
    return {
      status: 'ok',
      type: 'add_event',
      message: formatDateJa(dateIso) + ' ' + formatMinutes(startMin) + '〜' + formatMinutes(endMin) +
        ' に「' + fields.title + '」を追加しました。',
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

// 期間内の各日について、仕事終わり（18:00〜22:00）の空きを返す
function handleFreeEveningsQuery(query) {
  var invalid = validateQuerySpan(query.periodStart, query.periodEnd);
  if (invalid) return invalid;

  var days = [];
  try {
    var rangeStart = parseIsoDate(query.periodStart);
    var rangeEnd = parseIsoDate(addDays(query.periodEnd, 1));
    var dayOffSet = {};
    CalendarService.fetchDayOffDates(rangeStart, rangeEnd).forEach(function(d) { dayOffSet[d] = true; });
    var eventsByDate = CalendarService.fetchTimedEventsByDate(rangeStart, rangeEnd);

    var cursor = query.periodStart;
    while (cursor <= query.periodEnd) {
      var isDayOff = !!dayOffSet[cursor];
      if (!(query.excludeDayOff && isDayOff)) {
        var free = Scheduling.eveningFreeIntervals(eventsByDate[cursor] || []);
        if (free.length) {
          days.push({date: cursor, isDayOff: isDayOff, intervals: free});
        }
      }
      cursor = addDays(cursor, 1);
    }
  } catch (err) {
    console.error(err);
    return {status: 'error', message: 'カレンダーの取得に失敗しました。もう一度お試しください。'};
  }

  var answer;
  try {
    answer = AnswerService.generateFreeEveningsAnswer(query.periodDescription, days);
  } catch (err) {
    console.error(err);
    answer = AnswerService.formatFreeEveningsFallback(query.periodDescription, days);
  }

  return {
    status: 'ok',
    type: 'query_free_evenings',
    message: answer,
    freeEvenings: days
  };
}

function handleFreeTimeQuery(query) {
  var invalid = validateQuerySpan(query.periodStart, query.periodEnd);
  if (invalid) return invalid;

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

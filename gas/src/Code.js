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

  if (extraction.intent === 'delete_event') {
    return handleDeleteEvent(extraction.deleteEvent || {}, transcript);
  }

  if (extraction.intent === 'update_event') {
    return handleUpdateEvent(extraction.updateEvent || {}, transcript);
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
    endMin = fields.endTime
      ? normalizeEndMinutes(startMin, parseHhMm(fields.endTime), duration)
      : startMin + duration;

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

// 削除・変更で共通の「どの予定を指しているか」の特定。
// 特定できたら {event, label} を、できなければそのまま返せる {response} を返す
function resolveTargetEvent(fields, transcript, type, actionNoun) {
  var todayIso = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd');
  var searchFrom = fields.date || todayIso;
  var searchTo = fields.date ? addDays(fields.date, 1) : addDays(todayIso, CONFIG.DELETE_SEARCH_DAYS);

  var candidates;
  try {
    candidates = CalendarService.findTimedEvents(parseIsoDate(searchFrom), parseIsoDate(searchTo));
  } catch (err) {
    console.error(err);
    return {response: {status: 'error', message: 'カレンダーの取得に失敗しました。もう一度お試しください。'}};
  }

  var where = fields.date ? formatDateJa(fields.date) + 'に' : 'これから先に';
  if (!candidates.length) {
    return {response: {
      status: 'rejected', type: type,
      message: where + actionNoun + 'できる予定はありませんでした。'
    }};
  }

  var labels = candidates.map(function(e) {
    return formatDateJa(Utilities.formatDate(e.getStartTime(), CONFIG.TIMEZONE, 'yyyy-MM-dd')) + ' ' +
      formatMinutes(minutesOfDay(e.getStartTime())) + '〜' +
      formatMinutes(minutesOfDay(e.getEndTime())) + ' ' + e.getTitle();
  });

  var index;
  try {
    index = IntentService.pickTargetEvent(transcript, labels);
  } catch (err) {
    console.error(err);
    return {response: {status: 'error', message: '対象の予定の特定に失敗しました。もう一度お試しください。'}};
  }

  if (index < 0 || index >= candidates.length) {
    return {response: {
      status: 'rejected', type: type,
      message: 'どの予定か特定できませんでした。候補は次の通りです。\n' + labels.join('\n')
    }};
  }

  return {event: candidates[index], label: labels[index]};
}

// 確認を挟まず即削除する。ただし発話がどれを指すか特定できない場合だけは候補を返して聞き直してもらう
function handleDeleteEvent(fields, transcript) {
  var resolved = resolveTargetEvent(fields, transcript, 'delete_event', '削除');
  if (resolved.response) return resolved.response;

  try {
    resolved.event.deleteEvent();
  } catch (err) {
    console.error(err);
    return {status: 'error', message: '予定の削除に失敗しました。もう一度お試しください。'};
  }

  return {status: 'ok', type: 'delete_event', message: resolved.label + ' を削除しました。'};
}

function handleUpdateEvent(fields, transcript) {
  var resolved = resolveTargetEvent(fields, transcript, 'update_event', '変更');
  if (resolved.response) return resolved.response;

  var target = resolved.event;
  var beforeLabel = resolved.label;

  var originalDate = Utilities.formatDate(target.getStartTime(), CONFIG.TIMEZONE, 'yyyy-MM-dd');
  var originalStart = minutesOfDay(target.getStartTime());
  var originalDuration = minutesOfDay(target.getEndTime()) - originalStart;

  var timeChanged = !!(fields.newDate || fields.newStartTime || fields.newEndTime);
  if (!timeChanged && !fields.newTitle) {
    return {status: 'clarify', message: '何をどう変更するか、もう少し詳しく教えてください。'};
  }

  var newDate = fields.newDate || originalDate;
  var startMin = fields.newStartTime ? parseHhMm(fields.newStartTime) : originalStart;
  var endMin = fields.newEndTime
    ? normalizeEndMinutes(startMin, parseHhMm(fields.newEndTime), CONFIG.DEFAULT_EVENT_DURATION_MIN)
    : startMin + originalDuration; // 終了を言われなければ元の所要時間を保つ

  if (timeChanged) {
    var isDayOff, others;
    try {
      var dayStart = parseIsoDate(newDate);
      var dayEnd = parseIsoDate(addDays(newDate, 1));
      isDayOff = CalendarService.fetchDayOffDates(dayStart, dayEnd).indexOf(newDate) !== -1;
      // 変更対象自身は衝突判定から外す。外さないと時間を延ばすだけで自分自身と衝突して弾かれる
      others = (CalendarService.fetchTimedEventsByDate(dayStart, dayEnd)[newDate] || [])
        .filter(function(ev) { return ev.i !== target.getId(); });
    } catch (err) {
      console.error(err);
      return {status: 'error', message: 'カレンダーの取得に失敗しました。もう一度お試しください。'};
    }

    var conflicts = Scheduling.findConflicts(isDayOff, others, startMin, endMin);
    if (conflicts.work) {
      return {
        status: 'rejected', type: 'update_event',
        message: formatDateJa(newDate) + 'は仕事です（' + CONFIG.WORK_START_HOUR + '時〜' +
          CONFIG.WORK_END_HOUR + '時）。変更していません。'
      };
    }
    if (conflicts.events.length) {
      var names = conflicts.events.map(function(ev) { return '「' + ev.t + '」'; }).join('、');
      return {
        status: 'rejected', type: 'update_event',
        message: formatDateJa(newDate) + ' ' + formatMinutes(startMin) + 'は' + names +
          'が入っています。変更していません。'
      };
    }
  }

  try {
    if (timeChanged) {
      target.setTime(minutesToDate(newDate, startMin), minutesToDate(newDate, endMin));
    }
    if (fields.newTitle) target.setTitle(fields.newTitle);
  } catch (err) {
    console.error(err);
    return {status: 'error', message: '予定の変更に失敗しました。もう一度お試しください。'};
  }

  var afterLabel = formatDateJa(newDate) + ' ' + formatMinutes(startMin) + '〜' + formatMinutes(endMin) +
    ' ' + (fields.newTitle || target.getTitle());
  return {
    status: 'ok', type: 'update_event',
    message: beforeLabel + '\n→ ' + afterLabel + '\nに変更しました。'
  };
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

var CalendarService = {
  // start/end は Date。時刻の決定は呼び出し側（Code.js）が済ませておく
  createCalendarEvent: function(fields) {
    var cal = CalendarApp.getCalendarById(CONFIG.CALENDAR_ID);
    return cal.createEvent(fields.title, fields.start, fields.end, {
      location: fields.location || '',
      description: fields.notes || ''
    });
  },

  // rangeStart/rangeEnd: Date -> 'yyyy-MM-dd'の昇順・重複なし配列
  fetchDayOffDates: function(rangeStart, rangeEnd) {
    var events = CalendarApp.getCalendarById(CONFIG.CALENDAR_ID).getEvents(rangeStart, rangeEnd);
    var dates = events
      .filter(function(e) { return e.isAllDayEvent() && e.getTitle().trim() === CONFIG.DAYOFF_TITLE; })
      .map(function(e) { return Utilities.formatDate(e.getAllDayStartDate(), CONFIG.TIMEZONE, 'yyyy-MM-dd'); });
    var unique = Array.from(new Set(dates));
    unique.sort();
    return unique;
  },

  // 時間指定の予定を日付ごとに分割し {'yyyy-MM-dd': [{s: 開始分, e: 終了分, t: タイトル, i: ID}, ...]} で返す。
  // 日をまたぐ予定は日境界で分割する（カレンダーUIが1日=1円として描画するため）
  fetchTimedEventsByDate: function(rangeStart, rangeEnd) {
    var events = CalendarApp.getCalendarById(CONFIG.CALENDAR_ID).getEvents(rangeStart, rangeEnd);
    var byDate = {};
    events
      .filter(function(e) { return !e.isAllDayEvent(); })
      .forEach(function(e) {
        var end = e.getEndTime();
        var cursor = new Date(e.getStartTime());
        while (cursor < end) {
          var nextMidnight = new Date(cursor);
          nextMidnight.setHours(24, 0, 0, 0);
          var segEnd = end < nextMidnight ? end : nextMidnight;
          var startMin = minutesOfDay(cursor);
          var endMin = (segEnd.getTime() === nextMidnight.getTime()) ? 1440 : minutesOfDay(segEnd);
          if (endMin > startMin) {
            var key = Utilities.formatDate(cursor, CONFIG.TIMEZONE, 'yyyy-MM-dd');
            if (!byDate[key]) byDate[key] = [];
            byDate[key].push({s: startMin, e: endMin, t: e.getTitle(), i: e.getId()});
          }
          cursor = nextMidnight;
        }
      });
    return byDate;
  },

  // 削除候補の列挙。終日予定（「休み」を含む）は対象外。startTime を指定した場合は開始時刻も一致するものだけ
  findTimedEvents: function(rangeStart, rangeEnd, startTime) {
    var startMin = startTime ? parseHhMm(startTime) : null;
    return CalendarApp.getCalendarById(CONFIG.CALENDAR_ID)
      .getEvents(rangeStart, rangeEnd)
      .filter(function(e) {
        if (e.isAllDayEvent()) return false;
        if (startMin !== null && minutesOfDay(e.getStartTime()) !== startMin) return false;
        return true;
      });
  },

  // 「休み」以外の終日予定は無視し、時間指定の予定のみを対象にする
  fetchBusyIntervals: function(windowStart, windowEnd) {
    var events = CalendarApp.getCalendarById(CONFIG.CALENDAR_ID).getEvents(windowStart, windowEnd);
    return events
      .filter(function(e) { return !e.isAllDayEvent(); })
      .map(function(e) { return {start: e.getStartTime(), end: e.getEndTime()}; });
  }
};

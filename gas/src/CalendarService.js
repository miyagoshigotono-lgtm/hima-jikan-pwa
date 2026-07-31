// 時間指定の予定を日境界で分割して byDate に積む（カレンダーUIが1日=1行として描画するため）
function collectTimedEvent(event, byDate) {
  var end = event.getEndTime();
  var cursor = new Date(event.getStartTime());
  while (cursor < end) {
    var nextMidnight = new Date(cursor);
    nextMidnight.setHours(24, 0, 0, 0);
    var segEnd = end < nextMidnight ? end : nextMidnight;
    var startMin = minutesOfDay(cursor);
    var endMin = (segEnd.getTime() === nextMidnight.getTime()) ? 1440 : minutesOfDay(segEnd);
    if (endMin > startMin) {
      var key = Utilities.formatDate(cursor, CONFIG.TIMEZONE, 'yyyy-MM-dd');
      if (!byDate[key]) byDate[key] = [];
      byDate[key].push({s: startMin, e: endMin, t: event.getTitle(), i: event.getId()});
    }
    cursor = nextMidnight;
  }
}

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

  // 時間指定の予定を日付ごとに分割し {'yyyy-MM-dd': [{s: 開始分, e: 終了分, t: タイトル, i: ID}, ...]} で返す
  fetchTimedEventsByDate: function(rangeStart, rangeEnd) {
    var byDate = {};
    CalendarApp.getCalendarById(CONFIG.CALENDAR_ID)
      .getEvents(rangeStart, rangeEnd)
      .forEach(function(e) {
        if (!e.isAllDayEvent()) collectTimedEvent(e, byDate);
      });
    return byDate;
  },

  // カレンダー表示用。「休み」と時間指定予定を1度の取得でまとめて返す。
  // 月を切り替えるたびに getEvents を2回叩いていたのを1回にするための入口
  fetchMonthSummary: function(rangeStart, rangeEnd) {
    var dayOffSeen = {};
    var dayOffDates = [];
    var byDate = {};

    CalendarApp.getCalendarById(CONFIG.CALENDAR_ID)
      .getEvents(rangeStart, rangeEnd)
      .forEach(function(e) {
        if (!e.isAllDayEvent()) {
          collectTimedEvent(e, byDate);
          return;
        }
        if (e.getTitle().trim() !== CONFIG.DAYOFF_TITLE) return;
        var d = Utilities.formatDate(e.getAllDayStartDate(), CONFIG.TIMEZONE, 'yyyy-MM-dd');
        if (!dayOffSeen[d]) {
          dayOffSeen[d] = true;
          dayOffDates.push(d);
        }
      });

    dayOffDates.sort();
    return {dayOffDates: dayOffDates, events: byDate};
  },

  // 削除・変更の候補列挙。終日予定（「休み」を含む）は対象外。
  // 時刻での絞り込みはしない。候補のラベルには時刻が入っており、どれを指すかはGeminiに判定させるため
  findTimedEvents: function(rangeStart, rangeEnd) {
    return CalendarApp.getCalendarById(CONFIG.CALENDAR_ID)
      .getEvents(rangeStart, rangeEnd)
      .filter(function(e) { return !e.isAllDayEvent(); });
  },

  // 「休み」以外の終日予定は無視し、時間指定の予定のみを対象にする
  fetchBusyIntervals: function(windowStart, windowEnd) {
    var events = CalendarApp.getCalendarById(CONFIG.CALENDAR_ID).getEvents(windowStart, windowEnd);
    return events
      .filter(function(e) { return !e.isAllDayEvent(); })
      .map(function(e) { return {start: e.getStartTime(), end: e.getEndTime()}; });
  }
};

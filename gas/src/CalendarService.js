var CalendarService = {
  createCalendarEvent: function(fields) {
    var cal = CalendarApp.getCalendarById(CONFIG.CALENDAR_ID);
    var start = new Date(fields.startDateTime);
    var end = fields.endDateTime
      ? new Date(fields.endDateTime)
      : new Date(start.getTime() + CONFIG.DEFAULT_EVENT_DURATION_MIN * 60000);
    return cal.createEvent(fields.title, start, end, {
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

  // 「休み」以外の終日予定は無視し、時間指定の予定のみを対象にする
  fetchBusyIntervals: function(windowStart, windowEnd) {
    var events = CalendarApp.getCalendarById(CONFIG.CALENDAR_ID).getEvents(windowStart, windowEnd);
    return events
      .filter(function(e) { return !e.isAllDayEvent(); })
      .map(function(e) { return {start: e.getStartTime(), end: e.getEndTime()}; });
  }
};

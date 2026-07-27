// 予定の重複判定と自動時刻割当。分単位（0-1440）で計算する純粋ロジックで、
// CalendarApp/UrlFetchApp は呼ばない。dayEvents は [{s, e, t}] 形式。
var Scheduling = {
  mergeIntervals: function(intervals) {
    var sorted = intervals.slice().sort(function(a, b) { return a.s - b.s; });
    var merged = [];
    sorted.forEach(function(iv) {
      var last = merged[merged.length - 1];
      if (last && iv.s <= last.e) {
        if (iv.e > last.e) last.e = iv.e;
      } else {
        merged.push({s: iv.s, e: iv.e});
      }
    });
    return merged;
  },

  // その日の「埋まっている」区間。平日は勤務時間も埋まっているとみなす
  occupiedIntervals: function(isDayOff, dayEvents) {
    var occupied = (dayEvents || []).map(function(ev) { return {s: ev.s, e: ev.e}; });
    if (!isDayOff) {
      occupied.push({s: CONFIG.WORK_START_HOUR * 60, e: CONFIG.WORK_END_HOUR * 60});
    }
    return Scheduling.mergeIntervals(occupied);
  },

  // 時刻未指定で予定を追加するときの割当先。空きが無ければ null
  findAutoSlot: function(isDayOff, dayEvents, durationMin) {
    var startHour = isDayOff ? CONFIG.AUTO_SLOT_DAYOFF_START_HOUR : CONFIG.AUTO_SLOT_WORKDAY_START_HOUR;
    var searchStart = startHour * 60;
    var searchEnd = CONFIG.AUTO_SLOT_END_HOUR * 60;
    var occupied = Scheduling.occupiedIntervals(isDayOff, dayEvents);

    var cursor = searchStart;
    for (var i = 0; i < occupied.length && cursor < searchEnd; i++) {
      var iv = occupied[i];
      if (iv.e <= cursor) continue;
      var gapEnd = iv.s < searchEnd ? iv.s : searchEnd;
      if (gapEnd - cursor >= durationMin) {
        return {s: cursor, e: cursor + durationMin};
      }
      if (iv.e > cursor) cursor = iv.e;
    }
    if (searchEnd - cursor >= durationMin) {
      return {s: cursor, e: cursor + durationMin};
    }
    return null;
  },

  // 時刻を明示指定したときの衝突判定。睡眠帯は明示指定なら尊重するので見ない
  findConflicts: function(isDayOff, dayEvents, startMin, endMin) {
    var workConflict = false;
    if (!isDayOff) {
      var workStart = CONFIG.WORK_START_HOUR * 60;
      var workEnd = CONFIG.WORK_END_HOUR * 60;
      workConflict = startMin < workEnd && endMin > workStart;
    }
    var eventConflicts = (dayEvents || []).filter(function(ev) {
      return startMin < ev.e && endMin > ev.s;
    });
    return {work: workConflict, events: eventConflicts};
  },

  // 仕事終わり（18:00〜22:00）のうち予定が入っていない区間
  eveningFreeIntervals: function(dayEvents) {
    var start = CONFIG.FREE_WINDOW_START_HOUR * 60;
    var end = CONFIG.FREE_WINDOW_END_HOUR * 60;
    var occupied = Scheduling.mergeIntervals(
      (dayEvents || [])
        .map(function(ev) {
          return {s: ev.s > start ? ev.s : start, e: ev.e < end ? ev.e : end};
        })
        .filter(function(iv) { return iv.e > iv.s; })
    );

    var gaps = [];
    var cursor = start;
    occupied.forEach(function(iv) {
      if (iv.s > cursor) gaps.push({s: cursor, e: iv.s});
      if (iv.e > cursor) cursor = iv.e;
    });
    if (cursor < end) gaps.push({s: cursor, e: end});
    return gaps;
  }
};

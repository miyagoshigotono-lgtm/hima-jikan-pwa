var FreeTime = {
  // sortedDateStrings: ['yyyy-MM-dd', ...] 昇順・重複なし -> [{startDate, endDate}, ...]
  mergeConsecutiveDates: function(sortedDateStrings) {
    if (!sortedDateStrings.length) return [];
    var blocks = [];
    var blockStart = sortedDateStrings[0];
    var prev = sortedDateStrings[0];
    for (var i = 1; i < sortedDateStrings.length; i++) {
      var cur = sortedDateStrings[i];
      if (cur === addDays(prev, 1)) {
        prev = cur;
      } else {
        blocks.push({startDate: blockStart, endDate: prev});
        blockStart = cur;
        prev = cur;
      }
    }
    blocks.push({startDate: blockStart, endDate: prev});
    return blocks;
  },

  // block: {startDate, endDate} -> {windowStart: Date, windowEnd: Date}
  blockToWindow: function(block) {
    var dayBefore = addDays(block.startDate, -1);
    var windowStart = toTokyoDate(dayBefore, CONFIG.FREE_WINDOW_START_HOUR, 0);
    var windowEnd = toTokyoDate(block.endDate, CONFIG.FREE_WINDOW_END_HOUR, 0);
    return {windowStart: windowStart, windowEnd: windowEnd};
  },

  windowOverlapsRange: function(window, rangeStart, rangeEnd) {
    return window.windowEnd > rangeStart && window.windowStart < rangeEnd;
  },

  // busyIntervals: [{start: Date, end: Date}, ...] -> window内の空き区間 [{start, end}, ...]
  subtractIntervals: function(window, busyIntervals) {
    var clipped = busyIntervals
      .map(function(b) {
        var start = b.start > window.windowStart ? b.start : window.windowStart;
        var end = b.end < window.windowEnd ? b.end : window.windowEnd;
        return {start: start, end: end};
      })
      .filter(function(b) { return b.end > b.start; })
      .sort(function(a, b) { return a.start - b.start; });

    var merged = [];
    clipped.forEach(function(b) {
      var last = merged[merged.length - 1];
      if (last && b.start <= last.end) {
        if (b.end > last.end) last.end = b.end;
      } else {
        merged.push({start: b.start, end: b.end});
      }
    });

    var gaps = [];
    var cursor = window.windowStart;
    merged.forEach(function(b) {
      if (b.start > cursor) gaps.push({start: cursor, end: b.start});
      if (b.end > cursor) cursor = b.end;
    });
    if (cursor < window.windowEnd) gaps.push({start: cursor, end: window.windowEnd});
    return gaps;
  }
};

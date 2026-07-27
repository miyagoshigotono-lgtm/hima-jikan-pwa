var WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土'];

function parseIsoDate(dateStr) {
  var parts = dateStr.split('-').map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function addDays(dateStr, n) {
  var d = parseIsoDate(dateStr);
  d.setDate(d.getDate() + n);
  return Utilities.formatDate(d, CONFIG.TIMEZONE, 'yyyy-MM-dd');
}

function toTokyoDate(dateStr, hour, minute) {
  var parts = dateStr.split('-').map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2], hour, minute, 0);
}

// その日の0時からの経過分（0-1440）
function minutesOfDay(date) {
  var hh = parseInt(Utilities.formatDate(date, CONFIG.TIMEZONE, 'HH'), 10);
  var mm = parseInt(Utilities.formatDate(date, CONFIG.TIMEZONE, 'mm'), 10);
  return hh * 60 + mm;
}

// 'HH:mm' -> その日の0時からの経過分
function parseHhMm(hhmm) {
  var parts = String(hhmm).split(':');
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1] || '0', 10);
}

// 0時からの経過分 -> Date。1440を超える場合は翌日に繰り上がる
function minutesToDate(dateStr, minutes) {
  return toTokyoDate(dateStr, Math.floor(minutes / 60), minutes % 60);
}

function formatMinutes(minutes) {
  var hh = Math.floor(minutes / 60) % 24;
  var mm = minutes % 60;
  return hh + ':' + ('0' + mm).slice(-2);
}

function formatDateJa(dateStr) {
  var d = parseIsoDate(dateStr);
  return (d.getMonth() + 1) + '/' + d.getDate() + '(' + WEEKDAY_JA[d.getDay()] + ')';
}

function formatDateTimeJa(date) {
  var m = date.getMonth() + 1;
  var d = date.getDate();
  var w = WEEKDAY_JA[date.getDay()];
  var hh = ('0' + date.getHours()).slice(-2);
  var mm = ('0' + date.getMinutes()).slice(-2);
  return m + '/' + d + '(' + w + ')' + hh + ':' + mm;
}

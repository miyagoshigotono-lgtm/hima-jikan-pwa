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

function formatDateTimeJa(date) {
  var m = date.getMonth() + 1;
  var d = date.getDate();
  var w = WEEKDAY_JA[date.getDay()];
  var hh = ('0' + date.getHours()).slice(-2);
  var mm = ('0' + date.getMinutes()).slice(-2);
  return m + '/' + d + '(' + w + ')' + hh + ':' + mm;
}

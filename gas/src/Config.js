var CONFIG = {
  CALENDAR_ID: 'miyago.shigotono@gmail.com',
  TIMEZONE: 'Asia/Tokyo',
  DAYOFF_TITLE: '休み',
  DEFAULT_EVENT_DURATION_MIN: 60,
  BLOCK_PADDING_DAYS: 14,
  MAX_QUERY_SPAN_DAYS: 120,
  // 暇時間帯ルール（仕様書4章）。休みブロックの前夜18:00〜最終日22:00
  FREE_WINDOW_START_HOUR: 18,
  FREE_WINDOW_END_HOUR: 22,

  // 勤務時間。平日のこの時間帯は「埋まっている」とみなす
  WORK_START_HOUR: 7,
  WORK_END_HOUR: 18,

  // 時刻を指定せずに予定を追加したときの自動割当
  AUTO_SLOT_DAYOFF_START_HOUR: 7,   // 休みの日は起床直後から探す
  AUTO_SLOT_WORKDAY_START_HOUR: 18, // 平日は仕事終わりから探す
  AUTO_SLOT_END_HOUR: 22            // 探索上限（暇時間帯ルールの終端と揃える）
};

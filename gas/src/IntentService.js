var IntentService = {
  classifyAndExtract: function(transcript, todayIso) {
    var systemInstruction =
      'あなたは日本語音声入力アシスタントの意図解析エンジンです。\n' +
      '今日の日付は ' + todayIso + '（Asia/Tokyo基準）です。相対的な日付表現（来週の土曜、来月、8月後半等）は' +
      'この日付を基準に解決してください。\n' +
      '発話は次のいずれかです。\n' +
      '1. 予定追加（add_event）: カレンダーに新しい予定を追加したい\n' +
      '2. 空き時間照会（query_free_time）: 自分の暇な時間帯を知りたい\n' +
      '意図、または必須項目（予定追加ならタイトルと開始日時、空き時間照会なら対象期間）が発話から確実に読み取れない場合は、' +
      '無理に推測せず intent を "unclear" とし、clarificationNeeded に確認したい内容を日本語の質問文で書いてください。\n' +
      'startDateTime / endDateTime は yyyy-MM-ddTHH:mm:ss+09:00 形式で出力してください。\n' +
      'periodStart / periodEnd は yyyy-MM-dd 形式（両端含む）で出力してください。';

    var responseSchema = {
      type: 'OBJECT',
      properties: {
        intent: {type: 'STRING', enum: ['add_event', 'query_free_time', 'unclear']},
        clarificationNeeded: {type: 'STRING', nullable: true},
        addEvent: {
          type: 'OBJECT',
          nullable: true,
          properties: {
            title: {type: 'STRING'},
            startDateTime: {type: 'STRING'},
            endDateTime: {type: 'STRING', nullable: true},
            location: {type: 'STRING', nullable: true},
            counterpart: {type: 'STRING', nullable: true},
            notes: {type: 'STRING', nullable: true}
          },
          required: ['title', 'startDateTime']
        },
        freeTimeQuery: {
          type: 'OBJECT',
          nullable: true,
          properties: {
            periodStart: {type: 'STRING'},
            periodEnd: {type: 'STRING'},
            periodDescription: {type: 'STRING'}
          },
          required: ['periodStart', 'periodEnd', 'periodDescription']
        }
      },
      required: ['intent']
    };

    return GeminiClient.call(systemInstruction, transcript, responseSchema);
  }
};

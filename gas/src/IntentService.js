var IntentService = {
  classifyAndExtract: function(transcript, todayIso) {
    var systemInstruction =
      'あなたは日本語音声入力アシスタントの意図解析エンジンです。\n' +
      '今日の日付は ' + todayIso + '（Asia/Tokyo基準）です。相対的な日付表現（来週の土曜、来月、8月後半等）は' +
      'この日付を基準に解決してください。\n' +
      '発話は次のいずれかです。\n' +
      '1. 予定追加（add_event）: カレンダーに新しい予定を追加したい\n' +
      '   例:「今週の金曜日、大ちゃんと遊ぶ予定です」「来週土曜19時から田中さんと飲み会」\n' +
      '2. まとまった暇時間の照会（query_free_time）: 休日を含むまとまった空き時間を知りたい\n' +
      '   例:「来月どこが空いてる？」「今度の連休いつ暇？」\n' +
      '3. 仕事終わりの空き照会（query_free_evenings）: 日ごとの夜の空きを知りたい\n' +
      '   例:「今週の平日で予定が空いてる日は？」「仕事終わりが空いてる日は？」\n' +
      '意図、または必須項目（予定追加ならタイトルと日付、照会なら対象期間）が発話から確実に読み取れない場合は、' +
      '無理に推測せず intent を "unclear" とし、clarificationNeeded に確認したい内容を日本語の質問文で書いてください。\n' +
      '\n' +
      '【予定追加の重要な注意】\n' +
      'date は yyyy-MM-dd 形式で必ず埋めてください。\n' +
      'startTime / endTime は "HH:mm" 形式ですが、発話に時刻が含まれていない場合は必ず null にしてください。' +
      '時刻を勝手に補完してはいけません（時刻が null のときは、システム側が空いている時間を自動で割り当てます）。\n' +
      '\n' +
      '【照会の重要な注意】\n' +
      'periodStart / periodEnd は yyyy-MM-dd 形式（両端含む）で出力してください。\n' +
      'query_free_evenings で「平日で」「仕事終わりで」のように休日を除いて聞かれている場合は excludeDayOff を true にしてください。';

    var responseSchema = {
      type: 'OBJECT',
      properties: {
        intent: {
          type: 'STRING',
          enum: ['add_event', 'query_free_time', 'query_free_evenings', 'unclear']
        },
        clarificationNeeded: {type: 'STRING', nullable: true},
        addEvent: {
          type: 'OBJECT',
          nullable: true,
          properties: {
            title: {type: 'STRING'},
            date: {type: 'STRING'},
            startTime: {type: 'STRING', nullable: true},
            endTime: {type: 'STRING', nullable: true},
            location: {type: 'STRING', nullable: true},
            counterpart: {type: 'STRING', nullable: true},
            notes: {type: 'STRING', nullable: true}
          },
          required: ['title', 'date']
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
        },
        freeEveningsQuery: {
          type: 'OBJECT',
          nullable: true,
          properties: {
            periodStart: {type: 'STRING'},
            periodEnd: {type: 'STRING'},
            periodDescription: {type: 'STRING'},
            excludeDayOff: {type: 'BOOLEAN', nullable: true}
          },
          required: ['periodStart', 'periodEnd', 'periodDescription']
        }
      },
      required: ['intent']
    };

    return GeminiClient.call(systemInstruction, transcript, responseSchema);
  }
};

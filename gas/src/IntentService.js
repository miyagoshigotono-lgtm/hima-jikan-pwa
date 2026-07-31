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
      '4. 予定削除（delete_event）: 登録済みの予定を消したい\n' +
      '   例:「8月1日の会食を削除して」「大ちゃんと遊ぶ予定を消して」「金曜の飲み会キャンセルになった」\n' +
      '5. 予定変更（update_event）: 登録済みの予定の日時やタイトルを変えたい\n' +
      '   例:「大ちゃんと遊ぶ予定を18〜22時に変更」「8月1日の会食を8月3日に移動」「飲み会のタイトルを歓迎会にして」\n' +
      '意図、または必須項目（予定追加ならタイトルと日付、照会なら対象期間）が発話から確実に読み取れない場合は、' +
      '無理に推測せず intent を "unclear" とし、clarificationNeeded に確認したい内容を日本語の質問文で書いてください。\n' +
      '\n' +
      '【時刻の解釈】これは特に重要です\n' +
      '日本語の口語的な時刻表現を必ず24時間制の "HH:mm" に変換してください。\n' +
      '  「夜の9時」「夜9時」「21時」 → "21:00"\n' +
      '  「朝7時」「午前7時」 → "07:00"\n' +
      '  「昼の12時」「正午」 → "12:00"\n' +
      '  「午後3時」「昼の3時」 → "15:00"\n' +
      '  「夕方6時」 → "18:00"\n' +
      '  「深夜1時」 → "01:00"\n' +
      '「ごろ」「くらい」「あたり」「なんとなく」のような曖昧さを表す語が付いていても、' +
      '時刻が述べられている限り必ず埋めてください。曖昧さを理由に null にしてはいけません。\n' +
      '「AからBまで」のように範囲が述べられている場合は開始と終了の両方を埋めてください。\n' +
      '  例:「昼の12時から夜の9時まで」→ 開始="12:00", 終了="21:00"\n' +
      '  例:「8月13日夜の9時ごろに流星群を見る」→ 開始="21:00"\n' +
      '時刻を null にしてよいのは、発話に時刻が一切現れない場合だけです。\n' +
      '  例:「金曜日に大ちゃんと遊ぶ」→ 開始=null, 終了=null\n' +
      '\n' +
      '【予定追加の重要な注意】\n' +
      'date は yyyy-MM-dd 形式で必ず埋めてください。\n' +
      'startTime / endTime は上の【時刻の解釈】に従ってください。' +
      '発話に時刻が無い場合だけ null にします（その場合はシステム側が空き時間を自動で割り当てます）。\n' +
      '\n' +
      '【照会の重要な注意】\n' +
      'periodStart / periodEnd は yyyy-MM-dd 形式（両端含む）で出力してください。\n' +
      'query_free_evenings で「平日で」「仕事終わりで」のように休日を除いて聞かれている場合は excludeDayOff を true にしてください。\n' +
      '\n' +
      '【予定削除の重要な注意】\n' +
      'date は発話に「その予定が今入っている日付」が含まれる場合のみ yyyy-MM-dd で埋め、含まれない場合は null にしてください。\n' +
      '\n' +
      '【予定変更の重要な注意】これは特に重要です\n' +
      'updateEvent では「どの予定を変えるか」と「何に変えるか」を厳密に区別してください。\n' +
      '  date        = その予定が【今】入っている日付。対象を探すための条件。\n' +
      '  newDate / newStartTime / newEndTime / newTitle = 【変更後】の値。\n' +
      '「〜に変更」「〜にして」「〜に移動」「〜に変えて」の直前で述べられた日時は、' +
      '対象を探す条件ではなく必ず【変更後】の値です。new... 側に入れてください。\n' +
      '変更しない項目は必ず null にしてください。\n' +
      '例:「流星群を見る予定を21時から22時に変更して」\n' +
      '  → date=null, newStartTime="21:00", newEndTime="22:00"\n' +
      '    （21時・22時は変更後の時刻です。対象を探す条件ではありません）\n' +
      '例:「大ちゃんと遊ぶ予定を18〜22時に変更」\n' +
      '  → date=null, newStartTime="18:00", newEndTime="22:00"\n' +
      '例:「8月1日の会食を8月3日に移動」\n' +
      '  → date="2026-08-01", newDate="2026-08-03", newStartTime=null, newEndTime=null';

    var responseSchema = {
      type: 'OBJECT',
      properties: {
        intent: {
          type: 'STRING',
          enum: ['add_event', 'query_free_time', 'query_free_evenings', 'delete_event', 'update_event', 'unclear']
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
        },
        deleteEvent: {
          type: 'OBJECT',
          nullable: true,
          properties: {
            date: {type: 'STRING', nullable: true}
          }
        },
        updateEvent: {
          type: 'OBJECT',
          nullable: true,
          properties: {
            date: {type: 'STRING', nullable: true},
            newDate: {type: 'STRING', nullable: true},
            newStartTime: {type: 'STRING', nullable: true},
            newEndTime: {type: 'STRING', nullable: true},
            newTitle: {type: 'STRING', nullable: true}
          }
        }
      },
      required: ['intent']
    };

    return GeminiClient.call(systemInstruction, transcript, responseSchema);
  },

  // 候補のうち発話が指しているものを選ばせる（削除・変更で共用）。
  // 「会食」と「社長と水金部長とご飯」のように文字列一致しないケースがあるため文字列照合では足りない
  pickTargetEvent: function(transcript, candidates) {
    var systemInstruction =
      'ユーザーはカレンダーの予定を操作（削除または変更）しようとしています。以下は候補の一覧です。\n' +
      candidates.map(function(c, i) { return i + ': ' + c; }).join('\n') + '\n\n' +
      'ユーザーの発話が指している予定の番号を matchIndex に入れてください。' +
      '発話とタイトルは表現が違うことがあります（例:「会食」と「社長と部長とご飯」は同じ予定を指します）。' +
      '意味的に合致するものを選んでください。\n' +
      'どれを指しているか確信が持てない場合、または該当するものが無い場合は matchIndex を -1 にしてください。';

    var responseSchema = {
      type: 'OBJECT',
      properties: {matchIndex: {type: 'INTEGER'}},
      required: ['matchIndex']
    };

    return GeminiClient.call(systemInstruction, transcript, responseSchema).matchIndex;
  }
};

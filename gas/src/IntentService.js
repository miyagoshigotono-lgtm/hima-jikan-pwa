var IntentService = {
  // turns: [{role: 'user'|'model', text}] の配列。最後がユーザーの最新発話
  classifyAndExtract: function(turns, todayIso) {
    var systemInstruction =
      'あなたは日本語の発話をカレンダー操作に変換するアシスタントです。\n' +
      '今日は ' + todayIso + '（Asia/Tokyo）です。相対的な日付表現はこれを基準に解決してください。\n' +
      '\n' +
      '会話は複数回にわたることがあります。直前までのやりとりも踏まえ、' +
      'そこで既に判明している情報（日付・時刻・タイトルなど）を引き継いで解釈してください。\n' +
      '\n' +
      'できる操作:\n' +
      '- add_event: 予定を追加する\n' +
      '- update_event: 既存の予定の日時やタイトルを変える\n' +
      '- delete_event: 既存の予定を消す\n' +
      '- query_free_time: 休日を含むまとまった空き時間を尋ねる\n' +
      '- query_free_evenings: 日ごとの仕事終わりの空きを尋ねる\n' +
      '必要な情報が揃わない場合は intent を "unclear" とし、clarificationNeeded に聞きたいことを書いてください。\n' +
      '\n' +
      '日付は yyyy-MM-dd、時刻は24時間制の HH:mm で出力してください。\n' +
      '\n' +
      'このアプリ固有の約束:\n' +
      '- 予定追加で時刻が述べられていなければ startTime / endTime は null にしてください。' +
      'システムが空いている時間を自動で割り当てます。\n' +
      '- 予定変更では date が「その予定が今入っている日付」、new... が「変更後の値」です。' +
      '変更しない項目は null にしてください。\n' +
      '- query_free_evenings で休日を除いて聞かれている場合は excludeDayOff を true にしてください。';

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

    return GeminiClient.call(systemInstruction, turns, responseSchema);
  },

  // 候補のうち発話が指しているものを選ばせる（削除・変更で共用）。
  // 「会食」と「社長と水金部長とご飯」のように文字列一致しないケースがあるため文字列照合では足りない
  pickTargetEvent: function(turns, candidates) {
    var systemInstruction =
      'ユーザーはカレンダーの予定を操作（削除または変更）しようとしています。以下は候補の一覧です。\n' +
      candidates.map(function(c, i) { return i + ': ' + c; }).join('\n') + '\n\n' +
      'ユーザーの発話が指している予定の番号を matchIndex に入れてください。' +
      '発話とタイトルは表現が違うことがあります（例:「会食」と「社長と部長とご飯」は同じ予定を指します）。' +
      '意味的に合致するものを選んでください。\n' +
      'どれを指しているか確信が持てない場合、または該当するものが無い場合は matchIndex を -1 にしてください。';
    // 会話が複数ターンにわたる場合があるので、やりとり全体を渡して判断させる

    var responseSchema = {
      type: 'OBJECT',
      properties: {matchIndex: {type: 'INTEGER'}},
      required: ['matchIndex']
    };

    return GeminiClient.call(systemInstruction, turns, responseSchema).matchIndex;
  }
};

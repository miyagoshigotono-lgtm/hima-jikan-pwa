var AnswerService = {
  generateFreeTimeAnswer: function(periodDescription, freeIntervals) {
    if (!freeIntervals.length) {
      return periodDescription + 'は、休みブロックに基づく暇時間帯が見つかりませんでした。';
    }

    var listText = freeIntervals
      .map(function(f) { return formatDateTimeJa(f.start) + '〜' + formatDateTimeJa(f.end); })
      .join('、');

    var systemInstruction =
      'あなたはユーザーの予定管理アシスタントです。以下は「' + periodDescription + '」における暇時間帯の計算結果です。\n' +
      '自然な日本語の一文〜数文で、親しみやすく簡潔に回答文を作成してください。時刻や日付の情報は改変せずそのまま使ってください。';

    var responseSchema = {
      type: 'OBJECT',
      properties: {answer: {type: 'STRING'}},
      required: ['answer']
    };

    var result = GeminiClient.call(systemInstruction, listText, responseSchema);
    return result.answer;
  },

  generateFreeEveningsAnswer: function(periodDescription, days) {
    if (!days.length) {
      return periodDescription + 'は、仕事終わりに空いている日がありませんでした。';
    }

    var listText = days
      .map(function(d) {
        var times = d.intervals
          .map(function(iv) { return formatMinutes(iv.s) + '〜' + formatMinutes(iv.e); })
          .join('、');
        return formatDateJa(d.date) + (d.isDayOff ? '[休み]' : '') + ' ' + times;
      })
      .join('\n');

    var systemInstruction =
      'あなたはユーザーの予定管理アシスタントです。以下は「' + periodDescription + '」における、' +
      '仕事終わり（18時〜22時）に空いている日と時間帯の一覧です。\n' +
      '自然な日本語で、どの日が空いているかが分かるように簡潔に回答してください。' +
      '日付や時刻の情報は改変せずそのまま使ってください。[休み]と付いている日は仕事が休みの日です。';

    var responseSchema = {
      type: 'OBJECT',
      properties: {answer: {type: 'STRING'}},
      required: ['answer']
    };

    return GeminiClient.call(systemInstruction, listText, responseSchema).answer;
  },

  formatFreeEveningsFallback: function(periodDescription, days) {
    if (!days.length) {
      return periodDescription + 'は、仕事終わりに空いている日がありませんでした。';
    }
    var listText = days
      .map(function(d) {
        var times = d.intervals
          .map(function(iv) { return formatMinutes(iv.s) + '〜' + formatMinutes(iv.e); })
          .join('、');
        return formatDateJa(d.date) + ' ' + times;
      })
      .join('、');
    return '仕事終わりが空いているのは ' + listText + ' です。';
  },

  // Gemini呼び出し失敗時のフォールバック（決定的整形、Gemini不使用）
  formatIntervalsFallback: function(freeIntervals) {
    if (!freeIntervals.length) {
      return '該当する暇時間帯が見つかりませんでした。';
    }
    var listText = freeIntervals
      .map(function(f) { return formatDateTimeJa(f.start) + '〜' + formatDateTimeJa(f.end); })
      .join('、');
    return '空いているのは ' + listText + ' です。';
  }
};

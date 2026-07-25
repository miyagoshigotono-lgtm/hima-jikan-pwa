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

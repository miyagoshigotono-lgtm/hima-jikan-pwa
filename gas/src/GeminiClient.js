var GeminiClient = {
  // userContent は文字列（単発）か [{role:'user'|'model', text}] の配列（複数ターン）
  call: function(systemInstruction, userContent, responseSchema) {
    var props = PropertiesService.getScriptProperties();
    var apiKey = props.getProperty('GEMINI_API_KEY');
    var model = props.getProperty('GEMINI_MODEL');
    if (!apiKey || !model) {
      throw new Error('GEMINI_API_KEY または GEMINI_MODEL が未設定です（スクリプトプロパティを確認してください）');
    }

    var contents = (typeof userContent === 'string')
      ? [{role: 'user', parts: [{text: userContent}]}]
      : userContent.map(function(turn) {
          return {
            role: turn.role === 'model' ? 'model' : 'user',
            parts: [{text: String(turn.text)}]
          };
        });

    var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + apiKey;
    var payload = {
      systemInstruction: {parts: [{text: systemInstruction}]},
      contents: contents,
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: responseSchema
      }
    };

    var resp = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    if (resp.getResponseCode() !== 200) {
      throw new Error('Gemini error ' + resp.getResponseCode() + ': ' + resp.getContentText());
    }

    var data = JSON.parse(resp.getContentText());
    var text = data.candidates[0].content.parts[0].text;
    return JSON.parse(text);
  }
};

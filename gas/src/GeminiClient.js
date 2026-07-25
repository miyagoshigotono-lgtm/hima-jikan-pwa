var GeminiClient = {
  call: function(systemInstruction, userText, responseSchema) {
    var props = PropertiesService.getScriptProperties();
    var apiKey = props.getProperty('GEMINI_API_KEY');
    var model = props.getProperty('GEMINI_MODEL');
    if (!apiKey || !model) {
      throw new Error('GEMINI_API_KEY または GEMINI_MODEL が未設定です（スクリプトプロパティを確認してください）');
    }

    var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + apiKey;
    var payload = {
      systemInstruction: {parts: [{text: systemInstruction}]},
      contents: [{role: 'user', parts: [{text: userText}]}],
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

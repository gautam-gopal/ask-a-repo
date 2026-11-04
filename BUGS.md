# Bugs

## B-001: Streaming route called a function that did not exist

Symptom: POST /ask/stream tests received only an `error` event; sources/token/done never appeared.
Root cause: the answer.js edit (import generateStream + answerQuestionStream) was never applied, so repos.js imported undefined and threw TypeError after the headers were flushed, which the stream error handler turned into an error event.
Fix: add the import and the function to answer.js.
Prevention: the "unknown error" route test now needs to assert that the mocked generateStream was called; a test that accepts any thrown error cannot catch a missing function. Also grep for new exports after applying multi-file changes.

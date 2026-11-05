// Pure SSE frame parser. No imports, so the server's Vitest can test it too.
// parseSseStream() -> { feed(text) -> events[], end() -> { events, incomplete } }
// feed() takes already-decoded text in any split. Events are { event, data } where data is the
// raw string (lines joined with LF); the caller does JSON.parse. Comment lines (": keep-alive")
// are ignored. An event with no "event:" line is named "message". Unknown names pass through.
// A frame still open when the stream ends is discarded (per the SSE spec) and reported as
// incomplete: true, never dispatched.
export function parseSseStream() {
  let buf = "";
  let event = "";
  let dataLines = [];
  const out = [];

  const dispatch = () => {
    if (dataLines.length > 0)
      out.push({ event: event || "message", data: dataLines.join("\n") });
    event = "";
    dataLines = [];
  };
  const line = (l) => {
    if (l === "") return dispatch();
    if (l.startsWith(":")) return;
    const i = l.indexOf(":");
    const field = i === -1 ? l : l.slice(0, i);
    let value = i === -1 ? "" : l.slice(i + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") event = value;
    else if (field === "data") dataLines.push(value);
  };
  const drain = () => {
    for (;;) {
      const m = /\r\n|\n|\r/.exec(buf);
      if (!m) return;
      // A trailing "\r" may be the first half of "\r\n": wait for more text.
      if (m[0] === "\r" && m.index + 1 === buf.length) return;
      line(buf.slice(0, m.index));
      buf = buf.slice(m.index + m[0].length);
    }
  };

  return {
    feed(text) {
      buf += text;
      drain();
      return out.splice(0);
    },
    end() {
      if (buf.endsWith("\r")) {
        line(buf.slice(0, -1)); // a lone CR at EOF was a line terminator
        buf = "";
      }
      const incomplete = buf !== "" || dataLines.length > 0 || event !== "";
      const events = out.splice(0);
      buf = "";
      event = "";
      dataLines = [];
      return { events, incomplete };
    },
  };
}

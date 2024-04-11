import WebSocket from 'ws';

let ws = new WebSocket('ws://wsapi.goodentry.io/delta');

/// Nice looking logs
const prettyLog = (...args) => { console.log("[date]".replace("date", new Date().toLocaleString()), ...args); }

ws.on('error', console.error);

ws.on('open', function open() {
  ws.send('something');
});

ws.on('message', function message(data) {
  prettyLog('received: %s', JSON.parse(data));
});

const myTimeout = setInterval(function testWs() {
  try {
    prettyLog("Ping ws")
    ws.send('something');
  }
  catch(e) {
    console.log("broken?", e)
    ws = new WebSocket('ws://wsapi.goodentry.io/delta');
  }
}, 5000);
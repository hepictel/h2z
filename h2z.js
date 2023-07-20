import {WebSocketServer} from 'ws'
import axios from 'axios'
import { LRUCache } from 'lru-cache'
import { v4 as uuid } from 'uuid'
import microtime from 'microtime'
import crypto from 'crypto'

const debug = true;

const options = {
  max: process.env.MAX_CACHE || 10000,
  ttl: 2000,
  ttlAutopurge: true,
  dispose: function(n, key) {
    console.log('Batch disposal... ')
    const payload = JSON.stringify(n);
    console.log(payload);
    axios.post(process.env.HTTP_ENDPOINT || 'https://localhost:3100/tempo/api/push', payload, {
      headers:{
        'Content-Type': 'application/json'
      }
    })
      .then((response) => {
        console.log('Zipkin Data successfully sent', response.data);
      })
      .catch((error) => {
        console.log('An error occurred while sending data', error);
      });
  }
};

let messages = new LRUCache(options);

function middleware(data) {

  data = allStrings(data)
  var traceId = hashString(data.callid);

  var trace = [{
   "id": data.uuid.split('-')[0],
   "traceId": traceId,
   "timestamp": data.micro_ts,
   "duration": data.duration * 1000000 || 1000,
   "name": `${data.from_user} -> ${data.ruri_user}: ${data.status_text}`,
   "tags": data,
    "localEndpoint": {
      "serviceName": data.type || "hepic"
    }
  }]
  // Sub Span Generator
  if (data.cdr_ringing > 0) {
        trace.push({
           "id": data.uuid.split('-')[0] + "1",
           "parentId": data.uuid.split('-')[0],
           "traceId": traceId,
           "timestamp": data.cdr_start * 1000,
           "duration": (data.cdr_ringing * 1000) - data.micro_ts || 1000,
           "name": `${data.from_user} -> ${data.ruri_user}: Ringing`,
           "tags": data,
            "localEndpoint": {
              "serviceName": data.type || "hepic"
            }
        })
  }
  if (data.cdr_connect > 0) {
        trace.push({
           "id": data.uuid.split('-')[0] + "2",
           "parentId": data.uuid.split('-')[0],
           "traceId": traceId,
           "timestamp": data.cdr_start * 1000,
           "duration": (data.cdr_connect * 1000 ) - data.micro_ts || 1000,
           "name": `${data.from_user} -> ${data.ruri_user}: Connected`,
           "tags": data,
            "localEndpoint": {
              "serviceName": data.type || "hepic"
            }
        })
  }

  return trace;
}

const wss = new WebSocketServer({ port: process.env.WS_PORT || 18909 });
console.log('Listening on ', process.env.WS_PORT || 18909)

wss.on('connection', (ws) => {
  console.log('New WS connection established');

  ws.on('error', (err) => {
    console.log(`Websocket error: ${err}`)
  })

  ws.on('message', async (data) => {
    data = JSON.parse(data.toString());
    if (data.status < 10 ) return;
    if (messages.has(data.uuid)) return;
    const modifiedData = middleware(data)
    messages.set(modifiedData.uuid, modifiedData)
  });

  ws.on('close', () => {
    console.log('WS Connection closed');
  });
});

/* Utils */

function hashString(str) {
    const hash = crypto.createHash('sha256');
    hash.update(str.toString());
    const fullHash = hash.digest('hex');
    return fullHash.substr(0, 32);
}

function allStrings(data){
  for (let key in data) {
    data[key] = data[key].toString()
  }
  return data;
}

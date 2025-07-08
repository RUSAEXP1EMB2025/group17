const fs = require('fs').promises;
const path = require('path');
const process = require('process');
const {authenticate} = require('@google-cloud/local-auth');
const {google} = require('googleapis');
const axios = require('axios');

require('dotenv').config();


// スコープ設定: スプレッドシート読み取り専用権限 
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets.readonly'];
// トークンおよび認証情報ファイルのパス 
const TOKEN_PATH = path.join(process.cwd(), 'token.json');
const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');

// --- スプレッドシート情報 ---
const YOUR_SPREADSHEET_ID = process.env.YOUR_SPREADSHEET_ID; // スプレッドシートID
const YOUR_SHEET_NAME = 'sensor'; // 読み込むシート名 
const RANGE_TO_READ = `${YOUR_SHEET_NAME}!A:Z`; // シート全体(A列からZ列まで)を読み込む設定。


const REMO_ACCESS_TOKEN = process.env.REMO_ACCESS_TOKEN;
const SPEAKER_SIGNAL_ID = process.env.SPEAKER_SIGNAL_ID; 
const HUMIDIFIER_SIGNAL_ID = process.env.HUMIDIFIER_SIGNAL_ID;



let currentPowerState = 0; // 0: OFF, 1: ON

let intervalId = null;

/**
 * 以前に認証された認証情報を保存ファイルから読み込みます。
 */
async function loadSavedCredentialsIfExist() {
  try {
    const content = await fs.readFile(TOKEN_PATH);
    const credentials = JSON.parse(content);
    return google.auth.fromJSON(credentials);
  } catch (err) {
    return null;
  }
}

/**
 * 認証情報を GoogleAuth.fromJSON と互換性のあるファイルにシリアル化します。
 */
async function saveCredentials(client) {
  const content = await fs.readFile(CREDENTIALS_PATH);
  const keys = JSON.parse(content);
  const key = keys.installed || keys.web; // インストール済みアプリまたはウェブアプリの認証情報
  const payload = JSON.stringify({
    type: 'authorized_user',
    client_id: key.client_id,
    client_secret: key.client_secret,
    refresh_token: client.credentials.refresh_token,
  });
  await fs.writeFile(TOKEN_PATH, payload);
}

/**
 * API を呼び出すための認証情報をロードまたはリクエストします。
 */
async function authorize() {
  let client = await loadSavedCredentialsIfExist();
  if (client) {
    return client;
  }
  client = await authenticate({
    scopes: SCOPES,
    keyfilePath: CREDENTIALS_PATH,
  });
  if (client.credentials) {
    await saveCredentials(client);
  }
  return client;
}

/**
 * Google スプレッドシートからデータを読み込み、コンソールに出力します。
 */
async function readSpreadsheetData(auth) {
  const sheets = google.sheets({version: 'v4', auth});
  
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: YOUR_SPREADSHEET_ID,
      range: RANGE_TO_READ,
    });
    
    const rows = res.data.values;

    if (!rows || rows.length === 0) {
      console.log('スプレッドシートにデータが見つかりません。');
      return;
    }


  } catch (error) {
    console.error('スプレッドシートのデータ読み込みに失敗しました:', error.message);
    if (error.code === 403) {
        console.error("権限エラー: Google Cloud Console でスコープとスプレッドシートの共有設定を確認してください。");
    } else if (error.code === 404) {
        console.error("スプレッドシートまたはシート名が見つかりません: IDとシート名を確認してください。");
    }
  }
}




/**
 * Nature Remo API からデバイスデータを取得します。
 */
async function getNatureRemoData(endpoint = "devices") {
    if (!REMO_ACCESS_TOKEN || REMO_ACCESS_TOKEN === 'ory_at_WilqlTFMnBRyl5ceRC4ai4Vi2fU5JaMHmLx36qlf4HU.TWdtElA_3OwWJR2R3fEL35QZGEIXnlk4YwHW1dO4E7M') {
        console.error('エラー: Nature Remo Access Token が設定されていません。');
        return null;
    }
    try {
        const url = `https://api.nature.global/1/${endpoint}`;
        const headers = {
            "Authorization": `Bearer ${REMO_ACCESS_TOKEN}`,
            "Content-Type": "application/json;"
        };
        const response = await axios.get(url, { headers: headers });
        return response.data;
    } catch (error) {
        console.error('Nature Remo データ取得に失敗しました:', error.message);
        if (error.response) {
            console.error('応答ステータス:', error.response.status);
            console.error('応答データ:', error.response.data);
            if (error.response.status === 401) {
                console.error('Access Token が無効または期限切れです。');
            }
        }
        return null;
    }
}


/**
 * Nature Remo に信号を送信します。
 */
async function sendNatureRemoSignal(signalId) {
  if (!REMO_ACCESS_TOKEN || REMO_ACCESS_TOKEN === 'ory_at_WilqlTFMnBRyl5ceRC4ai4Vi2fU5JaMHmLx36qlf4HU.TWdtElA_3OwWJR2R3fEL35QZGEIXnlk4YwHW1dO4E7M') {
      console.error('エラー: Nature Remo Access Token が設定されていません。');
      return;
  }
  if (!signalId || signalId === 'YOUR_NATURE_REMO_SIGNAL_ID') {
      console.error('エラー: Nature Remo Signal ID が設定されていません。');
      return;
  }

  try {
    const url = `https://api.nature.global/1/signals/${signalId}/send`;
    const headers = {
      "Authorization": `Bearer ${REMO_ACCESS_TOKEN}`,
      "Content-Type": "application/json"
    };

    // POSTリクエストを送信
    await axios.post(url, {}, { headers: headers });
    console.log(`信号ID ${signalId} を送信しました。`);
  } catch (error) {
    console.error('信号送信に失敗しました:', error.message);
    if (error.response) {
      console.error('応答ステータス:', error.response.status);
      console.error('応答データ:', error.response.data);
    }
  }
}



async function onoff(auth) {

  const sheets = google.sheets({version: 'v4', auth});

  let rows;

  try{
    const sheetRes = await sheets.spreadsheets.values.get({
      spreadsheetId: YOUR_SPREADSHEET_ID,
      range: RANGE_TO_READ, // シート全体のデータ範囲
    });
  
    rows = sheetRes.data.values;
  }catch(err){
    console.error('スプレッドシートのデータ取得に失敗しました:', error.message);
    return;
  }

  if (!rows || rows.length === 0) {
    console.error('エラー: スプレッドシートにデータが見つかりません。操作をスキップします。');
    return;
}


  const deviceData = await getNatureRemoData("devices");
  if (!deviceData || deviceData.length === 0 || !deviceData[0].newest_events || !deviceData[0].newest_events.hu) {
    console.error('Nature Remoデバイスの湿度データが見つかりません。');
    return;
  }
  
  const situdo = deviceData[0].newest_events.hu.val;
  const LOW = rows[1][3];
  const HIGH = rows[2][3];
  const MODE = rows[1][4];

  console.log(`現在の湿度: ${situdo}%`);
  console.log(`設定LOW: ${LOW}%`);
  console.log(`設定HIGH: ${HIGH}%`);
  console.log(`設定MODE: ${MODE}`);
  console.log(`現在の電源状態 (内部): ${currentPowerState === 1 ? 'ON' : 'OFF'}`);



 if (MODE === "OFF") {
  if (intervalId) {
      clearInterval(intervalId); 
      intervalId = null; 
      console.log("自動モードOFFです。");
    }

    if (currentPowerState === 1) {
      console.log('MODEが OFFなので現在ONの状態の装置をOFFにします。');
      await sendNatureRemoSignal(SPEAKER_SIGNAL_ID); 
      await sendNatureRemoSignal(HUMIDIFIER_SIGNAL_ID); 
      currentPowerState = 0; 
  }
  return; 
  }



  if (situdo <= LOW && currentPowerState === 0) {
    console.log('湿度がLOW以下なので電源をONにします。');
    await sendNatureRemoSignal(SPEAKER_SIGNAL_ID); // 信号送信
    await sendNatureRemoSignal(HUMIDIFIER_SIGNAL_ID); // 信号送信
    currentPowerState = 1; // 電源をONの状態に更新
  } else if (situdo >= HIGH && currentPowerState === 1) {
    console.log('湿度がHIGH以上なので電源をOFFにします。');
    await sendNatureRemoSignal(SPEAKER_SIGNAL_ID); // 信号送信
    await sendNatureRemoSignal(HUMIDIFIER_SIGNAL_ID); // 信号送信
    currentPowerState = 0; // 電源をOFFの状態に更新
  }
}


authorize().then(auth => {
  onoff(auth).catch(console.error);
  if (intervalId === null) {
    intervalId = setInterval(() => onoff(auth).catch(console.error), 300000);
}
}).catch(console.error);
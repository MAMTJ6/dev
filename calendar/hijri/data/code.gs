// =================================================================
// FAIL: Code.gs
// FUNGSI: Menguruskan logik backend untuk berinteraksi dengan GitHub API.
// =================================================================

// Fungsi utama untuk memaparkan antaramuka HTML
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Page')
    .setTitle('Admin Panel Kalendar Islam')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

// Objek untuk konfigurasi - membaca dari Script Properties
const CONFIG = {
  GITHUB_PAT: PropertiesService.getScriptProperties().getProperty('GITHUB_PAT'),
  GITHUB_USER: PropertiesService.getScriptProperties().getProperty('GITHUB_USER'),
  GITHUB_REPO: PropertiesService.getScriptProperties().getProperty('GITHUB_REPO'),
  PIN: PropertiesService.getScriptProperties().getProperty('PIN'),
  FILE_PATH: 'calendar/hijri/data/events.json'
};

/**
 * Mendapatkan kandungan fail events.json dari repositori GitHub.
 * @returns {string} Kandungan fail JSON sebagai teks.
 */
function loadEventsFromGithub() {
  const url = `https://api.github.com/repos/${CONFIG.GITHUB_USER}/${CONFIG.GITHUB_REPO}/contents/${CONFIG.FILE_PATH}`;
  
  const options = {
    'method': 'get',
    'headers': {
      'Authorization': `Bearer ${CONFIG.GITHUB_PAT}`,
      'Accept': 'application/vnd.github.v3+json'
    },
    'muteHttpExceptions': true
  };
  
  try {
    const response = UrlFetchApp.fetch(url, options);
    const responseCode = response.getResponseCode();
    const result = JSON.parse(response.getContentText());

    if (responseCode === 200) {
      const content = Utilities.newBlob(Utilities.base64Decode(result.content)).getDataAsString();
      return content;
    } else {
      throw new Error(`Gagal memuatkan data dari GitHub. Mesej: ${result.message}`);
    }
  } catch (e) {
    throw new Error(`Ralat rangkaian: ${e.message}`);
  }
}

/**
 * Menyimpan data JSON yang dikemas kini ke fail events.json di GitHub.
 * @param {string} jsonData - Data acara yang baharu dalam format string JSON.
 * @param {string} userPin - PIN yang dimasukkan oleh pengguna untuk pengesahan.
 * @returns {object} Objek yang mengandungi status kejayaan dan mesej.
 */
function saveEventsToGithub(jsonData, userPin) {
  // 1. Sahkan PIN
  if (userPin !== CONFIG.PIN) {
    return { success: false, message: 'PIN tidak sah. Data tidak disimpan.' };
  }

  const url = `https://api.github.com/repos/${CONFIG.GITHUB_USER}/${CONFIG.GITHUB_REPO}/contents/${CONFIG.FILE_PATH}`;
  
  try {
    // 2. Dapatkan SHA fail semasa (diperlukan untuk kemas kini)
    const getFileOptions = {
      'method': 'get',
      'headers': { 'Authorization': `Bearer ${CONFIG.GITHUB_PAT}` },
      'muteHttpExceptions': true
    };
    const fileInfoResponse = UrlFetchApp.fetch(url, getFileOptions);
    if (fileInfoResponse.getResponseCode() !== 200) {
      throw new Error("Gagal mendapatkan maklumat fail (SHA) sebelum menyimpan.");
    }
    const fileInfo = JSON.parse(fileInfoResponse.getContentText());
    const currentSha = fileInfo.sha;

    // 3. Sediakan data untuk dihantar (payload)
    const payload = {
      message: `Kemas kini data acara melalui Admin Panel - ${new Date().toISOString()}`,
      content: Utilities.base64Encode(jsonData),
      sha: currentSha
    };

    // 4. Hantar permintaan PUT untuk mengemas kini fail
    const putOptions = {
      'method': 'put',
      'headers': {
        'Authorization': `Bearer ${CONFIG.GITHUB_PAT}`,
        'Accept': 'application/vnd.github.v3+json'
      },
      'contentType': 'application/json',
      'payload': JSON.stringify(payload),
      'muteHttpExceptions': true
    };
    
    const saveResponse = UrlFetchApp.fetch(url, putOptions);
    
    if (saveResponse.getResponseCode() === 200) {
      return { success: true, message: 'Data berjaya disimpan ke GitHub!' };
    } else {
      const errorResult = JSON.parse(saveResponse.getContentText());
      return { success: false, message: `Gagal menyimpan data. Ralat GitHub: ${errorResult.message}` };
    }

  } catch (e) {
    return { success: false, message: `Ralat semasa proses menyimpan: ${e.message}` };
  }
}
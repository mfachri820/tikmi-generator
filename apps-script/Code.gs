/**
 * TIKMI Generator: Google Form -> app ingest.
 *
 * Paste into the form's own Apps Script project (form editor > ⋮ > Apps
 * Script), or a standalone project with FORM_ID set. Setup: apps-script/README.md.
 *
 * Per response (and per edit of a response: same response ID, new version):
 *   1. POST {INGEST_URL}/api/ingest/start   metadata + answers keyed by item ID
 *   2. each uploaded Drive file:
 *        small (<= DIRECT_MAX_BYTES) or no storage: POST /api/ingest/file (base64)
 *        otherwise: PUT the bytes to the one-time signed URL the app returned
 *   3. POST /api/ingest/complete            the app parses, validates and versions
 *
 * Every request is signed: header x-tikmi-timestamp (ms) and x-tikmi-signature
 * = hex HMAC-SHA256 of "<timestamp>.<body>" with FORM_INGEST_SECRET.
 */

/** Files up to this size go through the app (base64 stays under Vercel's 4.5 MB body limit). */
var DIRECT_MAX_BYTES = 3 * 1024 * 1024;

/**
 * How the script finds its questions. Titles repeat between Bagian 2 and 3
 * (both have "Upload Asesmen Mandiri Infrastruktur TI"), so file questions are
 * told apart by the section they are in. Adjust if the form's wording changes;
 * run dumpItems() to see what the script sees.
 */
var ITEMS = {
  pjpName: /^Nama Penyelenggara PJP Pengawasan Wilker DKI Jakarta$/,
  pjpOther: /\(Jika memilih Other\)/,
  bundling: /^Bundling Aktivitas$/,
  mrUpload: /^Upload Asesmen Mandiri Manajemen Risiko/,
  itUpload: /^Upload Asesmen Mandiri Infrastruktur TI/,
};

function props_() {
  return PropertiesService.getScriptProperties();
}

function getForm_() {
  var id = props_().getProperty('FORM_ID');
  return id ? FormApp.openById(id) : FormApp.getActiveForm();
}

function onFormSubmit(e) {
  sendResponse_(e.response);
}

/** Creates the on-submit trigger (run once; re-running replaces it). */
function installTrigger() {
  var form = getForm_();
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'onFormSubmit'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('onFormSubmit').forForm(form).onFormSubmit().create();
  Logger.log('Trigger installed for form: ' + form.getTitle());
}

/** Sends the newest response again (connection test). */
function testLatestResponse() {
  var responses = getForm_().getResponses();
  if (!responses.length) throw new Error('The form has no responses yet.');
  sendResponse_(responses[responses.length - 1]);
}

/** Sends every response, oldest first. Safe to re-run: each run adds versions, and the latest submission wins. */
function resendAllResponses() {
  getForm_().getResponses().forEach(function (r) { sendResponse_(r); });
}

/** Lists every item (ID, type, section, title) in the execution log, to check ITEMS. */
function dumpItems() {
  var section = 'Bagian 1';
  getForm_().getItems().forEach(function (item) {
    if (item.getType() === FormApp.ItemType.PAGE_BREAK) section = item.getTitle();
    Logger.log([item.getId(), item.getType(), section, item.getTitle()].join(' | '));
  });
}

/** itemId -> { title, type, section } for the whole form. */
function itemIndex_() {
  var index = {};
  var section = 'Bagian 1';
  getForm_().getItems().forEach(function (item) {
    if (item.getType() === FormApp.ItemType.PAGE_BREAK) section = item.getTitle();
    index[String(item.getId())] = { title: item.getTitle().replace(/\s+/g, ' ').trim(), type: String(item.getType()), section: section };
  });
  return index;
}

function sign_(body) {
  var secret = props_().getProperty('FORM_INGEST_SECRET');
  if (!secret) throw new Error('Set FORM_INGEST_SECRET in Script Properties.');
  var ts = String(Date.now());
  var sig = Utilities.computeHmacSha256Signature(ts + '.' + body, secret, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); })
    .join('');
  return { 'x-tikmi-timestamp': ts, 'x-tikmi-signature': sig };
}

function post_(path, payload) {
  var base = props_().getProperty('INGEST_URL');
  if (!base) throw new Error('Set INGEST_URL in Script Properties (e.g. https://tikmi.example.app).');
  var body = JSON.stringify(payload);
  var res = UrlFetchApp.fetch(base.replace(/\/$/, '') + path, {
    method: 'post',
    contentType: 'application/json; charset=utf-8',
    payload: body,
    headers: sign_(body),
    muteHttpExceptions: true,
  });
  var code = res.getResponseCode();
  var text = res.getContentText();
  // A failure is thrown: the run is marked failed under Executions and Google emails the owner.
  if (code < 200 || code >= 300) throw new Error(path + ' failed (' + code + '): ' + text);
  return JSON.parse(text);
}

function sendResponse_(response) {
  var index = itemIndex_();
  var answers = {};
  var pjpName = null;
  var pjpOther = null;
  var bundling = null;
  var uploads = []; // { kind, driveFileId }

  response.getItemResponses().forEach(function (ir) {
    var id = String(ir.getItem().getId());
    var meta = index[id] || { title: ir.getItem().getTitle(), type: String(ir.getItem().getType()), section: '' };
    var value = ir.getResponse(); // string, or array (checkbox / file upload: Drive file IDs)
    answers[id] = { title: meta.title, section: meta.section, value: value };
    if (ITEMS.pjpName.test(meta.title)) pjpName = value;
    else if (ITEMS.pjpOther.test(meta.title)) pjpOther = value;
    else if (ITEMS.bundling.test(meta.title)) {
      var m = /Bundling\s+(\d)/.exec(String(value));
      bundling = m ? Number(m[1]) : null;
    } else if (meta.type === 'FILE_UPLOAD') {
      var kind = ITEMS.mrUpload.test(meta.title) ? 'mr' : ITEMS.itUpload.test(meta.title) ? 'it' : null;
      if (kind) (Array.isArray(value) ? value : [value]).forEach(function (fid) { if (fid) uploads.push({ kind: kind, driveFileId: fid }); });
    }
  });
  if (!pjpName) throw new Error('No answer for the PJP question: check ITEMS.pjpName (run dumpItems()).');

  // The form takes one file per question; if a PJP somehow sent more, the last one counts.
  var byKind = {};
  uploads.forEach(function (u) { byKind[u.kind] = u; });
  var files = Object.keys(byKind).map(function (kind) {
    var f = DriveApp.getFileById(byKind[kind].driveFileId);
    return { kind: kind, name: f.getName(), size: f.getSize(), driveFileId: byKind[kind].driveFileId, file: f };
  });
  if (!files.length) throw new Error('Response ' + response.getId() + ' has no uploaded file.');

  var start = post_('/api/ingest/start', {
    responseId: response.getId(),
    submittedAt: response.getTimestamp().toISOString(),
    respondentEmail: response.getRespondentEmail() || null,
    pjpName: pjpName,
    pjpOther: pjpOther,
    bundling: bundling,
    answers: answers,
    files: files.map(function (f) { return { kind: f.kind, name: f.name, size: f.size, driveFileId: f.driveFileId }; }),
    preferDirect: files.every(function (f) { return f.size <= DIRECT_MAX_BYTES; }),
  });

  start.files.forEach(function (target) {
    var f = files.filter(function (x) { return x.kind === target.kind; })[0];
    var blob = f.file.getBlob();
    if (target.mode === 'signed') {
      var put = UrlFetchApp.fetch(target.uploadUrl, {
        method: 'put',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        payload: blob.getBytes(),
        muteHttpExceptions: true,
      });
      if (put.getResponseCode() >= 300) throw new Error('Upload of ' + f.name + ' failed (' + put.getResponseCode() + '): ' + put.getContentText());
    } else {
      if (f.size > DIRECT_MAX_BYTES) throw new Error(f.name + ' is too large for direct upload and the app has no file storage configured.');
      post_('/api/ingest/file', { fileId: target.fileId, base64: Utilities.base64Encode(blob.getBytes()) });
    }
  });

  var done = post_('/api/ingest/complete', { submissionId: start.submissionId });
  Logger.log('Response ' + response.getId() + ' v' + start.version + ' (' + pjpName + '): ' + JSON.stringify(done));
}

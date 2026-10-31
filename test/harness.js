const fs = require("node:fs");
const path = require("node:path");

const scriptSource = fs.readFileSync(
  path.join(__dirname, "..", "url-archiver.js"),
  "utf8",
);

const KARAKEEP_URL = "https://karakeep.example.com";
const NOTE_URL = "https://trilium.example.com/#root/parentA/noteB";
const NOTE_TITLE = "Reading list";

/**
 * Returns the mock bookmark ID that the default Karakeep handler gives a URL.
 *
 * @param {string} url The URL as Karakeep receives it.
 * @returns {string} The bookmark ID.
 */
function bookmarkId(url) {
  return `bm-${url.replace(/^https:\/\//, "").replace(/[^a-z0-9]+/gi, "-")}`;
}

/**
 * Returns the Karakeep preview link for a bookmark ID.
 *
 * @param {string} id The bookmark ID.
 * @returns {string} The preview link.
 */
function previewUrl(id) {
  return `${KARAKEEP_URL}/dashboard/preview/${id}`;
}

/**
 * Returns the note field that the script writes for a list of Trilium notes.
 *
 * @param {{noteTitle: string, noteUrl: string}[]} notes The Trilium notes.
 * @returns {string} The note field text.
 */
function noteField(notes) {
  return `Trilium Notes:\n[\n  ${notes.map((n) => JSON.stringify(n)).join(",\n  ")}\n]`;
}

/**
 * Answers each Karakeep request as for a URL that has no bookmark yet.
 *
 * @param {{method: string, body: object|null}} request The request to Karakeep.
 * @returns {{status: number, body: string}} The mock response.
 */
function newBookmarks(request) {
  if (request.method === "POST") {
    return {
      status: 201,
      body: JSON.stringify({ id: bookmarkId(request.body.url) }),
    };
  }
  return { status: 204, body: "" };
}

function makeNote({ content, type, ignored }) {
  const root = { noteId: "root", getParentNotes: () => [] };
  const parent = { noteId: "parentA", getParentNotes: () => [root] };
  let current = content;
  return {
    noteId: "noteB",
    title: NOTE_TITLE,
    type,
    getContent: () => current,
    setContent: (value) => {
      current = value;
    },
    hasAttribute: (attrType, name, value) =>
      ignored &&
      attrType === "label" &&
      name === "urlArchiver" &&
      value === "ignore",
    getParentNotes: () => [parent],
  };
}

/**
 * Runs url-archiver.js once against a mock Trilium note and a mock Karakeep API.
 *
 * @param {object} options The test input.
 * @param {string} options.content The HTML content of the note.
 * @param {string} [options.type] The Trilium note type.
 * @param {boolean} [options.ignored] True when the note has the label urlArchiver=ignore.
 * @param {Function} [options.karakeep] Returns the mock response for each request. A response with `error` makes fetch reject.
 * @returns {Promise<{requests: object[], logs: string[], content: string}>} The requests to Karakeep, the log lines and the final note content.
 */
async function runScript({
  content,
  type = "text",
  ignored = false,
  karakeep = newBookmarks,
}) {
  const note = makeNote({ content, type, ignored });
  const requests = [];
  const logs = [];

  const api = {
    originEntity: note,
    log: (...args) => logs.push(args.map(String).join(" ")),
  };

  const fetch = async (url, options) => {
    const request = {
      method: options.method,
      url,
      authorization: options.headers.Authorization,
      body: options.body ? JSON.parse(options.body) : null,
    };
    requests.push(request);
    const response = karakeep(request);
    if (response.error) {
      throw new Error(response.error);
    }
    return {
      status: response.status,
      ok: response.status >= 200 && response.status < 300,
      json: async () => JSON.parse(response.body),
      text: async () => response.body,
    };
  };

  new Function("api", "fetch", scriptSource)(api, fetch);
  // the script does not return its promises, and the mocks settle within one macrotask
  await new Promise((resolve) => setImmediate(resolve));

  return { requests, logs, content: note.getContent() };
}

module.exports = {
  KARAKEEP_URL,
  NOTE_TITLE,
  NOTE_URL,
  bookmarkId,
  newBookmarks,
  noteField,
  previewUrl,
  runScript,
};

const assert = require("node:assert/strict");
const { describe, test } = require("node:test");
const {
  KARAKEEP_URL,
  NOTE_TITLE,
  NOTE_URL,
  bookmarkId,
  newBookmarks,
  noteField,
  previewUrl,
  runScript,
} = require("./harness");

const THIS_NOTE = { noteTitle: NOTE_TITLE, noteUrl: NOTE_URL };

async function archivedUrls(content) {
  const { requests } = await runScript({ content });
  return requests.filter((r) => r.method === "POST").map((r) => r.body.url);
}

function existingBookmark(id, note) {
  return (request) => {
    if (request.method === "POST") {
      return { status: 200, body: JSON.stringify({ id, note }) };
    }
    return { status: 200, body: "{}" };
  };
}

describe("URL detection", () => {
  const cases = [
    ["a URL in text", "<p>https://github.com/a</p>", ["https://github.com/a"]],
    [
      "a link target",
      '<p><a href="https://github.com/a">GitHub</a></p>',
      ["https://github.com/a"],
    ],
    [
      "link text that is the URL, once",
      '<p><a href="https://github.com/a">https://github.com/a</a></p>',
      ["https://github.com/a"],
    ],
    [
      "a URL in a code block",
      "<pre><code>curl https://github.com/a</code></pre>",
      [],
    ],
    [
      "a URL in inline code",
      "<p>see <code>https://github.com/a</code></p>",
      [],
    ],
    ["an image source", '<p><img src="https://github.com/a.png"></p>', []],
    ["an http URL", "<p>http://github.com/a</p>", []],
    ["an ignored domain", "<p>https://example.com/x</p>", []],
    ["an ignored domain with no path", "<p>https://example.com</p>", []],
    [
      "a subdomain of an ignored domain",
      "<p>https://karakeep.example.com/x</p>",
      [],
    ],
    [
      "a deep subdomain of an ignored domain",
      "<p>https://a.b.example.net/y</p>",
      [],
    ],
    [
      "a host that only starts with an ignored domain",
      "<p>https://example.community/x https://example.com.other.org/y</p>",
      ["https://example.community/x", "https://example.com.other.org/y"],
    ],
    [
      "a URL with trailing punctuation",
      "<p>https://a.org/1. https://a.org/2, https://a.org/3; https://a.org/4: https://a.org/5! https://a.org/6? 'https://a.org/7'</p>",
      [
        "https://a.org/1",
        "https://a.org/2",
        "https://a.org/3",
        "https://a.org/4",
        "https://a.org/5",
        "https://a.org/6",
        "https://a.org/7",
      ],
    ],
    [
      "a host with a full stop after it",
      "<p>see https://github.com.</p>",
      ["https://github.com"],
    ],
    [
      "dots, a query, a port and a trailing slash inside a URL",
      "<p>https://x.org/f.html https://x.org/v1.2/g https://x.org/h?q=1 https://x.org:8080/i https://x.org/j/</p>",
      [
        "https://x.org/f.html",
        "https://x.org/v1.2/g",
        "https://x.org/h?q=1",
        "https://x.org:8080/i",
        "https://x.org/j/",
      ],
    ],
    ["a URL in parentheses", "<p>(https://x.org/k)</p>", ["https://x.org/k"]],
    [
      "a URL before &nbsp;",
      "<p>https://x.org/o&nbsp;more</p>",
      ["https://x.org/o"],
    ],
    [
      "a URL with &amp; in text",
      "<p>https://x.org/e?q=1&amp;r=2 end</p>",
      ["https://x.org/e?q=1&r=2"],
    ],
    [
      "a link target with &amp;",
      '<p><a href="https://x.org/s?a=1&amp;b=2">x</a></p>',
      ["https://x.org/s?a=1&b=2"],
    ],
    [
      "the same URL twice, once",
      "<p>https://github.com/a and https://github.com/a</p>",
      ["https://github.com/a"],
    ],
  ];

  for (const [name, content, expected] of cases) {
    test(`archives ${name}`, async () => {
      assert.deepEqual(await archivedUrls(content), expected);
    });
  }
});

describe("note content", () => {
  test("replaces a URL and keeps the punctuation after it", async () => {
    const { content } = await runScript({
      content: "<p>see https://github.com/a.</p>",
    });
    assert.equal(
      content,
      `<p>see ${previewUrl(bookmarkId("https://github.com/a"))}.</p>`,
    );
  });

  test("keeps &nbsp; after a URL", async () => {
    const { content } = await runScript({
      content: "<p>https://x.org/o&nbsp;</p>",
    });
    assert.equal(
      content,
      `<p>${previewUrl(bookmarkId("https://x.org/o"))}&nbsp;</p>`,
    );
  });

  test("replaces a URL that holds &amp;", async () => {
    const { content } = await runScript({
      content: "<p>https://x.org/e?q=1&amp;r=2 end</p>",
    });
    assert.equal(
      content,
      `<p>${previewUrl(bookmarkId("https://x.org/e?q=1&r=2"))} end</p>`,
    );
  });

  test("replaces a link target and keeps the link text", async () => {
    const { content } = await runScript({
      content: '<p><a href="https://gitlab.com/b">GitLab</a></p>',
    });
    assert.equal(
      content,
      `<p><a href="${previewUrl(bookmarkId("https://gitlab.com/b"))}">GitLab</a></p>`,
    );
  });

  test("replaces both copies when the link text is the URL", async () => {
    const preview = previewUrl(bookmarkId("https://github.com/a"));
    const { content } = await runScript({
      content: '<p><a href="https://github.com/a">https://github.com/a</a></p>',
    });
    assert.equal(content, `<p><a href="${preview}">${preview}</a></p>`);
  });

  test("replaces each copy of a URL that is in the note twice", async () => {
    const preview = previewUrl(bookmarkId("https://github.com/a"));
    const { content } = await runScript({
      content: "<p>https://github.com/a and https://github.com/a</p>",
    });
    assert.equal(content, `<p>${preview} and ${preview}</p>`);
  });

  test("writes the note once for all the URLs", async () => {
    const { content, writes } = await runScript({
      content:
        "<p>https://github.com/a https://gitlab.com/b https://x.org/c</p>",
    });
    assert.equal(writes, 1);
    assert.equal(
      content,
      `<p>${previewUrl(bookmarkId("https://github.com/a"))} ${previewUrl(bookmarkId("https://gitlab.com/b"))} ${previewUrl(bookmarkId("https://x.org/c"))}</p>`,
    );
  });

  test("does not write the note when no URL was archived", async () => {
    const { writes } = await runScript({
      content: "<p>https://github.com/a</p>",
      karakeep: () => ({ error: "ECONNREFUSED" }),
    });
    assert.equal(writes, 0);
  });

  test("does not change ignored URLs or URLs in code", async () => {
    const original =
      "<p>https://karakeep.example.com/x https://example.com</p><pre><code>https://github.com/z</code></pre>";
    const { content, requests } = await runScript({ content: original });
    assert.equal(content, original);
    assert.equal(requests.length, 0);
  });
});

describe("new bookmark", () => {
  test("creates the bookmark with a reference to the note", async () => {
    const { requests } = await runScript({
      content: "<p>https://github.com/a</p>",
    });
    const post = requests.find((r) => r.method === "POST");
    assert.equal(post.url, `${KARAKEEP_URL}/api/v1/bookmarks`);
    assert.equal(post.authorization, "Bearer <karakeep-api-token>");
    assert.deepEqual(post.body, {
      type: "link",
      url: "https://github.com/a",
      note: noteField([THIS_NOTE]),
      source: "api",
    });
  });

  test("adds the bookmark to the list and sends no PATCH", async () => {
    const { requests } = await runScript({
      content: "<p>https://github.com/a</p>",
    });
    assert.deepEqual(
      requests.map((r) => [r.method, r.url]),
      [
        ["POST", `${KARAKEEP_URL}/api/v1/bookmarks`],
        [
          "PUT",
          `${KARAKEEP_URL}/api/v1/lists/<karakeep-list-id>/bookmarks/${bookmarkId("https://github.com/a")}`,
        ],
      ],
    );
  });
});

describe("existing bookmark", () => {
  const patchCases = [
    [
      "adds this note after the other notes and keeps the other text",
      `my own text\n\n${noteField([{ noteTitle: "Other", noteUrl: "https://trilium.example.com/#root/z" }])}`,
      `my own text\n\n${noteField([{ noteTitle: "Other", noteUrl: "https://trilium.example.com/#root/z" }, THIS_NOTE])}`,
    ],
    [
      "does not add this note twice",
      noteField([THIS_NOTE]),
      noteField([THIS_NOTE]),
    ],
    [
      "keeps text that has no marker",
      "  plain text  ",
      `plain text\n\n${noteField([THIS_NOTE])}`,
    ],
    [
      "writes a new field when the field is empty",
      null,
      noteField([THIS_NOTE]),
    ],
    [
      "starts a new list when the JSON is not valid",
      "text\nTrilium Notes: [not json",
      `text\n\n${noteField([THIS_NOTE])}`,
    ],
  ];

  for (const [name, existing, expected] of patchCases) {
    test(name, async () => {
      const { requests, content } = await runScript({
        content: "<p>https://github.com/a</p>",
        karakeep: existingBookmark("old1", existing),
      });
      const patch = requests.find((r) => r.method === "PATCH");
      assert.equal(patch.url, `${KARAKEEP_URL}/api/v1/bookmarks/old1`);
      assert.deepEqual(patch.body, { note: expected });
      assert.ok(
        requests.some(
          (r) =>
            r.method === "PUT" &&
            r.url ===
              `${KARAKEEP_URL}/api/v1/lists/<karakeep-list-id>/bookmarks/old1`,
        ),
      );
      assert.equal(content, `<p>${previewUrl("old1")}</p>`);
    });
  }

  test("logs a JSON parse failure", async () => {
    const { logs } = await runScript({
      content: "<p>https://github.com/a</p>",
      karakeep: existingBookmark("old1", "Trilium Notes: [not json"),
    });
    assert.ok(
      logs.includes(
        "Failed to parse existing Trilium notes JSON, starting fresh",
      ),
    );
  });
});

describe("errors", () => {
  test("does not change the URL when the response has no bookmark ID", async () => {
    const { requests, logs, content } = await runScript({
      content: "<p>https://github.com/a</p>",
      karakeep: () => ({ status: 400, body: JSON.stringify({ error: "bad" }) }),
    });
    assert.equal(content, "<p>https://github.com/a</p>");
    assert.deepEqual(
      requests.map((r) => r.method),
      ["POST"],
    );
    assert.ok(logs.includes("Error: Bookmark ID not found in the response"));
  });

  test("a network error on one URL does not stop the other URLs", async () => {
    const { content, logs } = await runScript({
      content: "<p>https://github.com/a https://gitlab.com/b</p>",
      karakeep: (request) =>
        request.method === "POST" && request.body.url.includes("gitlab")
          ? { error: "ECONNREFUSED" }
          : newBookmarks(request),
    });
    assert.equal(
      content,
      `<p>${previewUrl(bookmarkId("https://github.com/a"))} https://gitlab.com/b</p>`,
    );
    assert.ok(logs.some((l) => l.startsWith("Error making API request:")));
  });

  test("a failed PATCH still replaces the URL", async () => {
    const { content, logs } = await runScript({
      content: "<p>https://github.com/a</p>",
      karakeep: (request) =>
        request.method === "POST"
          ? { status: 200, body: JSON.stringify({ id: "old1", note: null }) }
          : request.method === "PATCH"
            ? { status: 500, body: "error" }
            : { status: 204, body: "" },
    });
    assert.equal(content, `<p>${previewUrl("old1")}</p>`);
    assert.ok(logs.some((l) => l.startsWith("Error updating bookmark note:")));
  });

  test("a failed list request still replaces the URL", async () => {
    const { content, logs } = await runScript({
      content: "<p>https://github.com/a</p>",
      karakeep: (request) =>
        request.method === "PUT"
          ? { status: 500, body: "error" }
          : newBookmarks(request),
    });
    assert.equal(
      content,
      `<p>${previewUrl(bookmarkId("https://github.com/a"))}</p>`,
    );
    assert.ok(logs.some((l) => l.startsWith("Error adding to list:")));
  });
});

describe("skipped notes", () => {
  const cases = [
    ["a code note", { type: "code" }],
    ["a note with the label urlArchiver=ignore", { ignored: true }],
  ];

  for (const [name, options] of cases) {
    test(`does not change ${name}`, async () => {
      const { requests, content } = await runScript({
        content: "<p>https://github.com/a</p>",
        ...options,
      });
      assert.equal(requests.length, 0);
      assert.equal(content, "<p>https://github.com/a</p>");
    });
  }
});

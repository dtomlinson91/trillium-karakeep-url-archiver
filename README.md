# trillium-karakeep-url-archiver

`url-archiver.js` is a backend script for [Trilium](https://github.com/TriliumNext/Trilium). It archives the external URLs of a note in [Karakeep](https://github.com/karakeep-app/karakeep).

When the content of a note changes, the script finds each external `https://` URL in the note. It sends each URL to Karakeep as a bookmark. Then it replaces the URL in the note with a link to the Karakeep preview of that bookmark. Karakeep can keep its own copy of each page, so the content can stay available when the original page goes offline.

## What the script does

Trilium runs the script after each content change to a note that has the `runOnNoteContentChange` relation. For that note, the script does these steps:

1. It stops if the note is a code note, or if the note has the label `urlArchiver=ignore`.
2. It finds each external `https://` URL in the HTML of the note. It removes duplicates.
3. For each URL, it sends a `POST /api/v1/bookmarks` request to Karakeep. The request holds the URL and a reference to the Trilium note. The script sends the requests for all the URLs at the same time.
4. If the bookmark exists already (HTTP 200), Karakeep keeps the old note field. The script then adds the reference to the note field with a `PATCH` request. It keeps the text that is in the field. It does not add the same Trilium note twice.
5. It adds the bookmark to the Karakeep list in `karakeepListId`.
6. When Karakeep has replied for all the URLs, the script replaces each copy of each archived URL with `<karakeepUrl>/dashboard/preview/<bookmarkId>`. It writes the note one time, for all the URLs together.

The note field of a bookmark holds a JSON list of the Trilium notes that link to the URL:

```
Trilium Notes:
[
  {"noteTitle":"Reading list","noteUrl":"https://trilium.example.com/#root/abc123/def456"}
]
```

### Which URLs the script archives

| URL in the note                                                                                                                    | Archived         |
| ---------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| Text: `https://github.com/a`                                                                                                       | yes              |
| A link target: `<a href="https://github.com/a">GitHub</a>`                                                                         | yes              |
| Link text that is the URL: `<a href="https://github.com/a">https://github.com/a</a>`                                               | yes, both copies |
| A URL in a code block or in inline code, when no tag comes between the URL and `</code>`                                           | no               |
| An image source: `<img src="https://github.com/a.png">`                                                                            | no               |
| An `http://` URL                                                                                                                   | no               |
| An ignored domain or one of its subdomains: `https://example.com/x`, `https://karakeep.example.com/x`, `https://a.b.example.com/y` | no               |
| A host that only starts with an ignored domain: `https://example.community/x`, `https://example.com.other.org/y`                   | yes              |

A URL ends at a space, a non-breaking space (`&nbsp;`), `<`, `>`, `"` or `)`. Trilium stores a `&` in a URL as `&amp;`. The script changes it back to `&` before it sends the URL to Karakeep. In note text, a `.`, `,`, `;`, `:`, `!`, `?` or `'` at the end of a URL is not part of the URL. For example, `see https://github.com/a.` sends `https://github.com/a` to Karakeep, and the full stop stays in the note.

## Requirements

- Trilium with backend scripts. The script was used on TriliumNext v0.100.0. It uses `fetch`, so the Trilium server must run on Node.js 18 or later.
- A Karakeep instance that the Trilium server can reach.
- A Karakeep API key.
- A list in Karakeep for the archived bookmarks.

## Configuration

Set these constants at the top of `url-archiver.js`:

| Constant           | Value                                                                                                                                | Example                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------- |
| `ignoredDomains`   | The domains that the script does not archive. The script also skips all their subdomains. Put the domains of your own services here. | `["example.com", "example.net"]` |
| `karakeepUrl`      | The base URL of Karakeep, with no `/` at the end.                                                                                    | `"https://karakeep.example.com"` |
| `karakeepApiToken` | The Karakeep API key.                                                                                                                | `"<karakeep-api-token>"`         |
| `karakeepListId`   | The ID of the Karakeep list that gets each bookmark.                                                                                 | `"<karakeep-list-id>"`           |
| `triliumUrl`       | The base URL of Trilium, with no `/` at the end. The script uses it to make the note links in each bookmark.                         | `"https://trilium.example.com"`  |

> [!WARNING]
> Make sure that the host of `karakeepUrl` is in `ignoredDomains`, or is a subdomain of a domain in `ignoredDomains`. The script writes preview links into your text note. This is a content change, so Trilium can run the script on that note again. If Karakeep is not ignored, the script archives the preview links as new bookmarks. The same thing occurs when you paste a preview link into a note.

> [!WARNING]
> The API key is in plain text in the script note. Each user who can read the note can read the key.

## Install in Trilium

### 1. Get the Karakeep values

1. In Karakeep, open **Settings** > **API Keys**. Create a key. Copy it.
2. Create a list for the archived bookmarks, or use one that exists.
3. Open the list. Copy the list ID from the end of the URL in the browser, for example `/dashboard/lists/<list-id>`.

### 2. Create the script note

1. In Trilium, create a new note. Give it the title `url-archiver`.
2. Set the note type to **Code**.
3. Set the language of the note to **JS backend**.
4. Copy the content of `url-archiver.js` into the note.
5. Set the constants. See [Configuration](#configuration).

### 3. Connect the script to your notes

The `runOnNoteContentChange` relation tells Trilium to run the script when the content of a note changes. An inheritable relation applies to the note and to all the notes below it.

The easiest way is to put the relation on the root note. The script then runs for every note in Trilium. To limit the script to one part of your notes, see [Archive URLs in one subtree](#archive-urls-in-one-subtree).

1. Open the root note.
2. In the **Owned Attributes** of the root note, add a relation.
3. Set the name to `runOnNoteContentChange`.
4. Set the target note to the `url-archiver` note.
5. Select **Inheritable**.
6. Save the attribute.

### 4. Test the script

1. Create a new test note.
2. Type an external URL, for example `https://github.com/karakeep-app/karakeep`.
3. Wait some seconds. The script changes the note only after Karakeep replies for all the URLs.
4. Open the note again. The URL is now a link to `<karakeepUrl>/dashboard/preview/<bookmarkId>`.
5. In Karakeep, open the list. The bookmark is in the list.

If the URL does not change, open **Menu** > **Advanced** > **Show backend log**. The script writes each Karakeep response and each error to this log.

## Use the script

After the install, you do not have to do anything. Write your notes as usual. The script archives the external URLs each time that the content of a note changes.

### Only new changes are archived

> [!IMPORTANT]
> The relation does not archive the URLs in all your notes at once. The script runs only when the content of a note changes. From the time that you add the relation, it archives the URLs in each new note and in each note that you edit. Notes that you do not edit keep their original URLs.

### Edit old notes with care

> [!CAUTION]
> When you edit an old note, the script archives every external URL in that note, not only the URLs that you add. If the note has many links, the script changes all of them, and Karakeep gets a bookmark for each one.

A small edit to an old note can therefore make a large change. To keep the URLs of an old note, add the skip label before you edit the note. See [Skip all URLs in one note](#skip-all-urls-in-one-note).

You can undo the change. The risk is small, but the undo takes some work:

1. Add the label `#urlArchiver=ignore` to the note. A restore is a content change too, so the script may run again without the label.
2. In Trilium, open the revisions of the note. Restore the version before the script changed it.
3. If you want the script to run on the note again, remove the label.
4. In Karakeep, open the list from `karakeepListId`. Delete the bookmarks that the script made.

> [!WARNING]
> In step 4, delete only the new bookmarks. A bookmark that existed before the edit can also link to other Trilium notes. Its note field lists those notes.

### Archive URLs in one subtree

To limit the script to one part of your notes, put the relation on the top note of that subtree, not on the root note. Select **Inheritable**. The script then runs only for that note and the notes below it.

### Skip all URLs in one note

Add the label `#urlArchiver=ignore` to the note. The script then does not change any URL in that note.

1. Open the note.
2. In the **Owned Attributes** of the note, type `#urlArchiver=ignore`.
3. Save the attribute.

### Skip one URL

Put the URL in a code block or in inline code. This is a quick way to keep one URL as it is. The script skips a URL in code when no other tag comes between the URL and the end of the code.

### Skip your own services

Add the domains of your own services to `ignoredDomains`. The script then does not archive URLs on those domains or on their subdomains. For example, with `example.com` in the list, the script skips `https://example.com` and `https://trilium.example.com`.

## Errors

The script writes each error to the Trilium backend log. When a request for a URL fails, the script does not change that URL in the note. The failure has no effect on the other URLs. The next content change to the note tries the URL again.

The script also runs after a content change through the Trilium ETAPI.

## Development

The repo has tests and a linter for `url-archiver.js`. Neither one changes the script. Trilium gets only the content of `url-archiver.js`.

### Requirements

- Node.js 22 or later.
- Run `npm install` one time. It installs [Biome](https://biomejs.dev), the linter and formatter. The tests need no packages.

### Commands

| Command          | What it does                                            |
| ---------------- | ------------------------------------------------------- |
| `npm test`       | Runs the tests in `test/` with the Node.js test runner. |
| `npm run check`  | Lints and checks the format of all files with Biome.    |
| `npm run lint`   | Lints all files with Biome.                             |
| `npm run format` | Formats all files with Biome.                           |

Run `npm test` and `npm run check` after each change. Both must pass.

### Tests

`test/harness.js` runs the real `url-archiver.js` with a mock Trilium note and a mock Karakeep API. It records each request to Karakeep, each log line, each note write and the final note content. `test/url-archiver.test.js` holds the tests.

> [!IMPORTANT]
> The tests use the example values at the top of `url-archiver.js`. Keep those values in the repo. Put your own values only in the script note in Trilium.

### CI

`.forgejo/workflows/test.yml` runs `npm test` and `npm run check` on each push and on each pull request.

### Release a change

1. Change `url-archiver.js`. Run `npm test` and `npm run check`.
2. Copy the content of `url-archiver.js` into the script note in Trilium.
3. In the script note, set the 5 constants to your own values again. See [Configuration](#configuration).

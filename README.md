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
6. It replaces each copy of the URL in the note with `<karakeepUrl>/dashboard/preview/<bookmarkId>`.

The note field of a bookmark holds a JSON list of the Trilium notes that link to the URL:

```
Trilium Notes:
[
  {"noteTitle":"Reading list","noteUrl":"https://trilium.example.com/#root/abc123/def456"}
]
```

### Which URLs the script archives

| URL in the note | Archived |
|---|---|
| Text: `https://github.com/a` | yes |
| A link target: `<a href="https://github.com/a">GitHub</a>` | yes |
| Link text that is the URL: `<a href="https://github.com/a">https://github.com/a</a>` | yes, both copies |
| A URL in a code block, when no tag comes between the URL and `</code>` | no |
| An image source: `<img src="https://github.com/a.png">` | no |
| An `http://` URL | no |
| A subdomain of an ignored domain: `https://karakeep.example.com/x`, `https://a.b.example.com/y` | no |
| An ignored domain with no subdomain: `https://example.com/x` | yes |

A URL ends at a space, `<`, `>`, `"` or `)`. A full stop or a comma directly after a URL becomes part of the URL. For example, `see https://github.com/a.` sends `https://github.com/a.` to Karakeep.

## Requirements

- Trilium with backend scripts. The script was used on TriliumNext v0.100.0. It uses `fetch`, so the Trilium server must run on Node.js 18 or later.
- A Karakeep instance that the Trilium server can reach.
- A Karakeep API key.
- A list in Karakeep for the archived bookmarks.

## Configuration

Set these constants at the top of `url-archiver.js`:

| Constant | Value | Example |
|---|---|---|
| `ignoredDomains` | The domains whose subdomains the script does not archive. Put the domains of your own services here. | `["example.com", "example.net"]` |
| `karakeepUrl` | The base URL of Karakeep, with no `/` at the end. | `"https://karakeep.example.com"` |
| `karakeepApiToken` | The Karakeep API key. | `"<karakeep-api-token>"` |
| `karakeepListId` | The ID of the Karakeep list that gets each bookmark. | `"<karakeep-list-id>"` |
| `triliumUrl` | The base URL of Trilium, with no `/` at the end. The script uses it to make the note links in each bookmark. | `"https://trilium.example.com"` |

> [!WARNING]
> Make sure that `karakeepUrl` is a subdomain of a domain in `ignoredDomains`. The script changes the note, so Trilium runs the script again. If Karakeep is not ignored, the second run archives the preview links too.

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

1. Open the root note to archive URLs in all notes. Open a different note to archive URLs only in its subtree.
2. In the **Owned Attributes** of that note, add a relation.
3. Set the name to `runOnNoteContentChange`.
4. Set the target note to the `url-archiver` note.
5. Select **Inheritable**.
6. Save the attribute.

### 4. Test the script

1. Create a test note below the note from step 3.
2. Type an external URL, for example `https://github.com/karakeep-app/karakeep`.
3. Wait some seconds. The script changes a URL only after Karakeep replies for that URL.
4. Open the note again. The URL is now a link to `<karakeepUrl>/dashboard/preview/<bookmarkId>`.
5. In Karakeep, open the list. The bookmark is in the list.

If the URL does not change, open **Menu** > **Advanced** > **Show backend log**. The script writes each Karakeep response and each error to this log.

## Options

| Option | How | Effect |
|---|---|---|
| Archive all notes | Put the relation on the root note, with **Inheritable** selected. | The script runs for each note in Trilium. |
| Archive one subtree | Put the relation on the top note of the subtree, with **Inheritable** selected. | The script runs only for the notes in that subtree. |
| Skip one note | Add the label `#urlArchiver=ignore` to the note. | The script does not change the note. |
| Skip your own services | Add their domains to `ignoredDomains`. | The script does not archive URLs on subdomains of those domains. |
| Keep a URL as it is | Put the URL in a code block. | The script does not archive the URL. |
| Choose the Karakeep list | Set `karakeepListId`. | Each archived bookmark goes into that list. |

An inheritable label `#urlArchiver(inheritable)=ignore` on a parent note may skip its whole subtree. This was not tested.

## Errors

The script writes each error to the Trilium backend log. When a request for a URL fails, the script does not change that URL in the note. The failure has no effect on the other URLs. The next content change to the note tries the URL again.

The script also runs after a content change through the Trilium ETAPI.

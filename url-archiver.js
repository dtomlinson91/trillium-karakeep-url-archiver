const ignoredDomains = ["example.com", "example.net"];
const karakeepUrl = "https://karakeep.example.com";
const karakeepApiToken = "<karakeep-api-token>";
const karakeepListId = "<karakeep-list-id>";
const triliumUrl = "https://trilium.example.com";

const dynamicRegex = createDynamicRegex(ignoredDomains);
const urls = getUrls();

function getAncestorPath(note) {
  const path = [];
  let current = note;

  while (current.getParentNotes().length > 0) {
    const parent = current.getParentNotes()[0];
    if (parent.noteId === "root") break;
    path.unshift(parent.noteId);
    current = parent;
  }

  return path;
}

function getNoteUrl(note) {
  const ancestors = getAncestorPath(note);
  const noteId = note.noteId;
  const pathParts = ["root"].concat(ancestors).concat([noteId]);
  return `${triliumUrl}/#${pathParts.join("/")}`;
}

function createDynamicRegex(domains) {
  const escapedDomains = domains.map((domain) =>
    domain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  );
  const dynamicPart = escapedDomains
    .map((domain) => `(?:[a-zA-Z0-9-]+\\.)*${domain}(?![\\w-]|\\.[\\w-])`)
    .join("|");
  const regexPattern = `(?<!<code[^>]>[^<])(?<!<img[^>]>[^<])(https:\\/\\/(?!${dynamicPart})[\\w-]+(?:\\.[\\w-]+)+(?:(?:(?!&nbsp;)[^\\s<>"\\)])*(?!&nbsp;)[^\\s<>"\\).,;:!?'])?)(?![^<]*<\\/code>)(?![^<]*>)|<a[^>]+?href="(https:\\/\\/(?!${dynamicPart})[\\w.-]+(?:\\.[\\w.-]+)+[^\\s<>"\\)]*)`;

  return new RegExp(regexPattern, "g");
}

function getUrls() {
  const noteContent = api.originEntity.getContent();
  const urlsFound = [];

  for (const match of noteContent.matchAll(dynamicRegex)) {
    const url = match[1] || match[2];
    if (url) urlsFound.push(url);
  }

  const dedupSet = new Set(urlsFound);
  const dedup = Array.from(dedupSet);

  return dedup;
}

function decodeHtmlUrl(url) {
  return url.replace(/&amp;/g, "&");
}

function replaceUrlInNote(originalUrl, newUrl) {
  const noteContent = api.originEntity.getContent();
  const replacements = {};
  replacements[originalUrl] = newUrl;

  const replaceRegex = createDynamicRegex(ignoredDomains);
  const updatedContent = noteContent.replace(
    replaceRegex,
    (match, group1, group2) => {
      const url = group1 || group2;
      if (replacements[url]) {
        if (group2) {
          return match.replace(group2, replacements[url]);
        }
        return replacements[url];
      }
      return match;
    },
  );

  api.originEntity.setContent(updatedContent);
  api.log(`Replaced ${originalUrl} with ${newUrl} in note`);
}

function createBookmark(url, token) {
  const note = api.originEntity;
  const noteTitle = note.title;
  const noteUrl = getNoteUrl(note);
  const triliumNotes = [{ noteTitle: noteTitle, noteUrl: noteUrl }];
  const noteText =
    "Trilium Notes:\n[\n  " +
    triliumNotes.map((n) => JSON.stringify(n)).join(",\n  ") +
    "\n]";

  return fetch(`${karakeepUrl}/api/v1/bookmarks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      type: "link",
      url: decodeHtmlUrl(url),
      note: noteText,
      source: "api",
    }),
  })
    .then((response) => {
      const status = response.status;
      return response.json().then((data) => ({ status: status, data: data }));
    })
    .then((result) => {
      const responseData = result.data;
      const status = result.status;

      api.log(JSON.stringify(responseData));

      const bookmarkId = responseData.id;

      if (!bookmarkId) {
        api.log("Error: Bookmark ID not found in the response");
        return null;
      }

      // If bookmark already exists (200), update it to append note info
      if (status === 200) {
        api.log(`Bookmark already exists for ${url}, updating with note info`);
        return updateBookmarkNote(bookmarkId, responseData.note, token).then(
          () => {
            const newUrl = `${karakeepUrl}/dashboard/preview/${bookmarkId}`;
            addToKarakeepList(bookmarkId, token);
            return { originalUrl: url, newUrl: newUrl };
          },
        );
      }

      // New bookmark created (201)
      const newUrl = `${karakeepUrl}/dashboard/preview/${bookmarkId}`;
      addToKarakeepList(bookmarkId, token);
      return { originalUrl: url, newUrl: newUrl };
    })
    .then((result) => {
      if (!result) return null;

      replaceUrlInNote(result.originalUrl, result.newUrl);
      return result;
    })
    .catch((error) => {
      api.log("Error making API request: ", error);

      return null;
    });
}

function updateBookmarkNote(bookmarkId, existingNote, token) {
  const note = api.originEntity;
  const noteTitle = note.title;
  const noteUrl = getNoteUrl(note);

  // Parse existing Trilium notes or create new array
  let triliumNotes = [];
  let otherNoteContent = "";

  if (existingNote) {
    const triliumNotesMarker = "Trilium Notes:";
    const markerIndex = existingNote.indexOf(triliumNotesMarker);

    if (markerIndex !== -1) {
      // Extract other content before the marker
      otherNoteContent = existingNote.substring(0, markerIndex).trim();

      // Extract and parse JSON array
      const jsonStart = markerIndex + triliumNotesMarker.length;
      const jsonString = existingNote.substring(jsonStart).trim();

      try {
        triliumNotes = JSON.parse(jsonString);
      } catch {
        api.log("Failed to parse existing Trilium notes JSON, starting fresh");
        triliumNotes = [];
      }
    } else {
      // No marker found, treat all as other content
      otherNoteContent = existingNote.trim();
    }
  }

  // Add new note reference if not already present (check by URL)
  const noteExists = triliumNotes.some((n) => n.noteUrl === noteUrl);

  if (!noteExists) {
    triliumNotes.push({ noteTitle: noteTitle, noteUrl: noteUrl });
  }

  // Build updated note with compact formatting
  let updatedNote = otherNoteContent ? `${otherNoteContent}\n\n` : "";
  updatedNote +=
    "Trilium Notes:\n[\n  " +
    triliumNotes.map((n) => JSON.stringify(n)).join(",\n  ") +
    "\n]";

  return fetch(`${karakeepUrl}/api/v1/bookmarks/${bookmarkId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      note: updatedNote,
    }),
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return response.json();
    })
    .then((responseData) => {
      api.log(`Successfully updated bookmark ${bookmarkId} with note info`);
      return responseData;
    })
    .catch((error) => {
      api.log("Error updating bookmark note: ", error);
      return null;
    });
}

function addToKarakeepList(bookmarkId, token) {
  return fetch(
    `${karakeepUrl}/api/v1/lists/${karakeepListId}/bookmarks/${bookmarkId}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  )
    .then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return response.text().then((text) => (text ? JSON.parse(text) : {}));
    })
    .then(() => {
      api.log(`successfully added ${bookmarkId} to ${karakeepListId}`);
    })
    .catch((error) => {
      api.log("Error adding to list: ", error);
      return null;
    });
}

// api.log(api.originEntity.getContent());

// Check if the note has the url-archiver=ignore attribute
if (
  api.originEntity.type !== "code" &&
  !api.originEntity.hasAttribute("label", "urlArchiver", "ignore")
) {
  for (const url of urls) {
    createBookmark(url, karakeepApiToken);
  }
}

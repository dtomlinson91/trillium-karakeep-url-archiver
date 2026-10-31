const ignoredDomains = ["example.com", "example.net"];
const karakeepUrl = "https://karakeep.example.com";
const karakeepApiToken = "<karakeep-api-token>";
const karakeepListId = "<karakeep-list-id>";
const triliumUrl = "https://trilium.example.com";

const dynamicRegex = createDynamicRegex(ignoredDomains);
const urls = getUrls();

function getAncestorPath(note) {
  var path = [];
  var current = note;

  while (current.getParentNotes().length > 0) {
    var parent = current.getParentNotes()[0];
    if (parent.noteId === "root") break;
    path.unshift(parent.noteId);
    current = parent;
  }

  return path;
}

function getNoteUrl(note) {
  var ancestors = getAncestorPath(note);
  var noteId = note.noteId;
  var pathParts = ["root"].concat(ancestors).concat([noteId]);
  return `${triliumUrl}/#${pathParts.join("/")}`;
}

function createDynamicRegex(domains) {
  const escapedDomains = domains.map((domain) => domain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const dynamicPart = escapedDomains.map((domain) => `(?:[a-zA-Z0-9-]+\\.)*${domain}(?![\\w-]|\\.[\\w-])`).join("|");
  const regexPattern = `(?<!<code[^>]>[^<])(?<!<img[^>]>[^<])(https:\\/\\/(?!${dynamicPart})[\\w.-]+(?:\\.[\\w.-]+)+[^\\s<>\"\\)]*)(?![^<]*<\\/code>)(?![^<]*>)|<a[^>]+?href="(https:\\/\\/(?!${dynamicPart})[\\w.-]+(?:\\.[\\w.-]+)+[^\\s<>\"\\)]*)`;

  return new RegExp(regexPattern, "g");
}

function getUrls() {
  var noteContent = api.originEntity.getContent();
  var urlsFound = [];
  var match;

  dynamicRegex.lastIndex = 0;
  while ((match = dynamicRegex.exec(noteContent)) !== null) {
    var url = match[1] || match[2];
    if (url) urlsFound.push(url);
  }

  var dedupSet = new Set(urlsFound);
  var dedup = Array.from(dedupSet);

  return dedup;
}

function replaceUrlInNote(originalUrl, newUrl) {
  var noteContent = api.originEntity.getContent();
  var replacements = {};
  replacements[originalUrl] = newUrl;

  var replaceRegex = createDynamicRegex(ignoredDomains);
  var updatedContent = noteContent.replace(replaceRegex, function (match, group1, group2) {
    var url = group1 || group2;
    if (replacements[url]) {
      if (group2) {
        return match.replace(group2, replacements[url]);
      }
      return replacements[url];
    }
    return match;
  });

  api.originEntity.setContent(updatedContent);
  api.log(`Replaced ${originalUrl} with ${newUrl} in note`);
}

function createBookmark(url, token) {
  var note = api.originEntity;
  var noteTitle = note.title;
  var noteUrl = getNoteUrl(note);
  var triliumNotes = [{ noteTitle: noteTitle, noteUrl: noteUrl }];
  var noteText = "Trilium Notes:\n[\n  " + triliumNotes.map(function(n) { return JSON.stringify(n); }).join(",\n  ") + "\n]";

  return fetch(`${karakeepUrl}/api/v1/bookmarks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: "Bearer " + token,
    },
    body: JSON.stringify({
      type: "link",
      url: url,
      note: noteText,
      source: "api",
    }),
  })
    .then(function (response) {
      var status = response.status;
      return response.json().then(function (data) {
        return { status: status, data: data };
      });
    })
    .then(function (result) {
      var responseData = result.data;
      var status = result.status;

      api.log(JSON.stringify(responseData));

      var bookmarkId = responseData.id;

      if (!bookmarkId) {
        api.log("Error: Bookmark ID not found in the response");
        return null;
      }

      // If bookmark already exists (200), update it to append note info
      if (status === 200) {
        api.log(`Bookmark already exists for ${url}, updating with note info`);
        return updateBookmarkNote(bookmarkId, responseData.note, token).then(function () {
          var newUrl = `${karakeepUrl}/dashboard/preview/${bookmarkId}`;
          addToKarakeepList(bookmarkId, token);
          return { originalUrl: url, newUrl: newUrl };
        });
      }

      // New bookmark created (201)
      var newUrl = `${karakeepUrl}/dashboard/preview/${bookmarkId}`;
      addToKarakeepList(bookmarkId, token);
      return { originalUrl: url, newUrl: newUrl };
    })
    .then(function (result) {
      if (!result) return null;

      replaceUrlInNote(result.originalUrl, result.newUrl);
      return result;
    })
    .catch(function (error) {
      api.log("Error making API request: ", error);

      return null;
    });
}

function updateBookmarkNote(bookmarkId, existingNote, token) {
  var note = api.originEntity;
  var noteTitle = note.title;
  var noteUrl = getNoteUrl(note);

  // Parse existing Trilium notes or create new array
  var triliumNotes = [];
  var otherNoteContent = "";

  if (existingNote) {
    var triliumNotesMarker = "Trilium Notes:";
    var markerIndex = existingNote.indexOf(triliumNotesMarker);

    if (markerIndex !== -1) {
      // Extract other content before the marker
      otherNoteContent = existingNote.substring(0, markerIndex).trim();

      // Extract and parse JSON array
      var jsonStart = markerIndex + triliumNotesMarker.length;
      var jsonString = existingNote.substring(jsonStart).trim();

      try {
        triliumNotes = JSON.parse(jsonString);
      } catch (e) {
        api.log("Failed to parse existing Trilium notes JSON, starting fresh");
        triliumNotes = [];
      }
    } else {
      // No marker found, treat all as other content
      otherNoteContent = existingNote.trim();
    }
  }

  // Add new note reference if not already present (check by URL)
  var noteExists = triliumNotes.some(function (n) {
    return n.noteUrl === noteUrl;
  });

  if (!noteExists) {
    triliumNotes.push({ noteTitle: noteTitle, noteUrl: noteUrl });
  }

  // Build updated note with compact formatting
  var updatedNote = otherNoteContent ? otherNoteContent + "\n\n" : "";
  updatedNote += "Trilium Notes:\n[\n  " + triliumNotes.map(function(n) { return JSON.stringify(n); }).join(",\n  ") + "\n]";

  return fetch(`${karakeepUrl}/api/v1/bookmarks/${bookmarkId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: "Bearer " + token,
    },
    body: JSON.stringify({
      note: updatedNote,
    }),
  })
    .then(function (response) {
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return response.json();
    })
    .then(function (responseData) {
      api.log(`Successfully updated bookmark ${bookmarkId} with note info`);
      return responseData;
    })
    .catch(function (error) {
      api.log("Error updating bookmark note: ", error);
      return null;
    });
}

function addToKarakeepList(bookmarkId, token) {
  return fetch(`${karakeepUrl}/api/v1/lists/${karakeepListId}/bookmarks/${bookmarkId}`, {
    method: "PUT",
    headers: {
      Authorization: "Bearer " + token,
    },
  })
    .then(function (response) {
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return response.text().then(function (text) {
        return text ? JSON.parse(text) : {};
      });
    })
    .then(function (responseData) {
      api.log(`successfully added ${bookmarkId} to ${karakeepListId}`);
    })
    .catch(function (error) {
      api.log("Error adding to list: ", error);
      return null;
    });
}

// api.log(api.originEntity.getContent());

// Check if the note has the url-archiver=ignore attribute
if (api.originEntity.type !== "code" && !api.originEntity.hasAttribute("label", "urlArchiver", "ignore")) {
  for (var i = 0; i < urls.length; i++) {
    createBookmark(urls[i], karakeepApiToken);
  }
}

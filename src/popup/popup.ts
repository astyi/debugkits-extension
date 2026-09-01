// Populate dynamic values in the popup UI.
const manifest = chrome.runtime.getManifest()
const versionEl = document.getElementById("version")
if (versionEl) versionEl.textContent = `v${manifest.version}`

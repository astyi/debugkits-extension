// Content script — runs in Chrome's ISOLATED world.
//
// Cannot use script tag injection (CSP blocks inline scripts).
// Cannot set window.* directly (isolated world has its own window).
//
// Solution: localStorage is DOM storage, shared across the same origin
// regardless of isolated vs main world boundary. No CSP restrictions apply.

;(function injectExtId() {
  try {
    localStorage.setItem("__dk_ext_id__", chrome.runtime.id)
  } catch {
    // localStorage unavailable (e.g. strict private browsing) — silently skip
  }
})()

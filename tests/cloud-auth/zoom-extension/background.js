/* global chrome */
chrome.runtime.onInstalled.addListener(() => { /* Native zoom is controlled only by the isolated test worker. */ });

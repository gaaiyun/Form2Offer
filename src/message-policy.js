(function attachForm2OfferMessagePolicy(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.Form2OfferMessagePolicy = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createMessagePolicy() {
  "use strict";

  const PRIVILEGED_MESSAGE_TYPES = new Set([
    "OJAF_SAVE_SETTINGS",
    "OJAF_CLEAR_SETTINGS",
    "OJAF_LIST_MODELS",
    "OJAF_TEST_CONNECTION",
    "OJAF_GET_JOB_APPLICATIONS",
    "OJAF_SAVE_JOB_APPLICATION",
    "OJAF_IMPORT_JOB_APPLICATIONS",
    "OJAF_DELETE_JOB_APPLICATION",
    "OJAF_CLEAR_JOB_APPLICATIONS",
    "OJAF_GET_ANSWER_LIBRARY",
    "OJAF_SAVE_ANSWER_LIBRARY",
    "OJAF_DELETE_ANSWER_LIBRARY_ITEM",
    "OJAF_CLEAR_ANSWER_LIBRARY",
    "OJAF_SAVE_AGENT_CONFIG",
    "OJAF_AGENT_HEALTH",
    "OJAF_AGENT_PAIR",
    "OJAF_AGENT_SOURCES",
    "OJAF_AGENT_CREATE_SESSION",
    "OJAF_AGENT_GET_SESSION",
    "OJAF_AGENT_PLAN_PREVIEWS",
    "OJAF_AGENT_CANCEL_SESSION",
    "OJAF_APPLY_AGENT_PLAN",
    "OJAF_AGENT_STATUS",
    "OJAF_AGENT_CHECK_APPLIED",
    "OJAF_AGENT_STAGED_PROFILE",
    "OJAF_AGENT_CLEAR_STAGED_PROFILE",
    "OJAF_AGENT_LINK_STATUS",
    "OJAF_SAVE_AGENT_LINK"
  ]);

  function isTrustedExtensionPage(sender = {}, context = {}) {
    const runtimeId = String(context.runtimeId || "");
    const extensionBaseUrl = String(context.extensionBaseUrl || "");
    const senderId = String(sender?.id || "");
    const senderUrl = String(sender?.url || "");

    return Boolean(
      runtimeId &&
      extensionBaseUrl &&
      senderId === runtimeId &&
      senderUrl.startsWith(extensionBaseUrl)
    );
  }

  function canHandleRuntimeMessage(type, sender = {}, context = {}) {
    const messageType = String(type || "");
    return !PRIVILEGED_MESSAGE_TYPES.has(messageType) || isTrustedExtensionPage(sender, context);
  }

  return {
    PRIVILEGED_MESSAGE_TYPES,
    isTrustedExtensionPage,
    canHandleRuntimeMessage
  };
});

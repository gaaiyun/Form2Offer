"use strict";

const { classifyFieldRisk, sanitizePromptText } = require("./security.js");

const PLAN_VERSION = 1;
const PLAN_ITEM_RISKS = new Set(["standard", "sensitive", "declaration", "blocked"]);

function normalizeEvidence(input) {
  return (Array.isArray(input) ? input : [])
    .slice(0, 8)
    .map((item) => ({
      source: sanitizePromptText(item?.source, 240),
      section: sanitizePromptText(item?.section, 240),
      excerpt: sanitizePromptText(item?.excerpt, 600)
    }))
    .filter((item) => item.source || item.section || item.excerpt);
}

function validateAgentFillPlan(input, session) {
  const source = input && typeof input === "object" ? input : {};
  const sessionFields = new Map((session?.request?.scan?.fields || []).map((field) => [field.fieldId, field]));
  const profilePaths = new Map((session?.request?.profileCatalog?.fields || []).map((field) => [field.path, field]));
  const seen = new Set();
  const items = [];
  const rejected = [];

  for (const raw of Array.isArray(source.items) ? source.items.slice(0, 300) : []) {
    const fieldId = sanitizePromptText(raw?.fieldId, 160);
    const field = sessionFields.get(fieldId);
    if (!field || seen.has(fieldId)) {
      rejected.push({ fieldId, reason: field ? "duplicate field" : "unknown field" });
      continue;
    }
    seen.add(fieldId);
    const actualRisk = classifyFieldRisk(field);
    if (actualRisk !== "standard") {
      rejected.push({ fieldId, reason: `${actualRisk} fields are not executable by an agent plan` });
      continue;
    }
    const sourcePath = sanitizePromptText(raw?.sourcePath, 180);
    const value = String(raw?.value == null ? "" : raw.value).trim().slice(0, 8000);
    if (sourcePath && !profilePaths.has(sourcePath)) {
      rejected.push({ fieldId, reason: "unknown profile sourcePath" });
      continue;
    }
    if (sourcePath && classifyFieldRisk({ ...field, label: `${field.label || ""} ${profilePaths.get(sourcePath)?.label || ""}` }) !== "standard") {
      rejected.push({ fieldId, reason: "sensitive profile sourcePath is not executable" });
      continue;
    }
    if (!sourcePath && !value) {
      rejected.push({ fieldId, reason: "missing sourcePath or value" });
      continue;
    }
    const declaredRisk = PLAN_ITEM_RISKS.has(raw?.risk) ? raw.risk : actualRisk;
    if (declaredRisk !== "standard") {
      rejected.push({ fieldId, reason: "non-standard declared risk" });
      continue;
    }
    items.push({
      fieldId,
      sourcePath,
      value: sourcePath ? "" : value,
      confidence: Math.max(0, Math.min(1, Number(raw?.confidence) || 0)),
      risk: "standard",
      reason: sanitizePromptText(raw?.reason, 300),
      evidence: normalizeEvidence(raw?.evidence)
    });
  }

  return {
    version: PLAN_VERSION,
    sessionId: session.id,
    summary: sanitizePromptText(source.summary, 1000),
    warnings: (Array.isArray(source.warnings) ? source.warnings : [])
      .slice(0, 20)
      .map((warning) => sanitizePromptText(warning, 400))
      .filter(Boolean),
    items,
    rejected,
    generatedAt: new Date().toISOString()
  };
}

function getAgentPlanJsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["summary", "warnings", "items"],
    properties: {
      summary: { type: "string" },
      warnings: { type: "array", items: { type: "string" }, maxItems: 20 },
      items: {
        type: "array",
        maxItems: 300,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["fieldId", "sourcePath", "value", "confidence", "risk", "reason", "evidence"],
          properties: {
            fieldId: { type: "string" },
            sourcePath: { type: "string" },
            value: { type: "string" },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            risk: { type: "string", enum: ["standard", "sensitive", "declaration", "blocked"] },
            reason: { type: "string" },
            evidence: {
              type: "array",
              maxItems: 8,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["source", "section", "excerpt"],
                properties: {
                  source: { type: "string" },
                  section: { type: "string" },
                  excerpt: { type: "string" }
                }
              }
            }
          }
        }
      }
    }
  };
}

module.exports = { PLAN_VERSION, validateAgentFillPlan, getAgentPlanJsonSchema };

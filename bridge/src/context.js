"use strict";

const { platformKnowledge, jobInsight } = require("./shared.js");
const { loadApplicationRecords, checkApplied } = require("./applications.js");

function analyzeJob(job = {}, config = {}) {
  const text = [job.title, job.description].filter(Boolean).join("\n");
  const analysis = jobInsight.analyzeJobText(text, { title: job.title || "" });
  return {
    analysis,
    assessment: jobInsight.assessRequirements(analysis, config.candidate || {}),
    recommendedResume: jobInsight.recommendResumeVersion(analysis, config.resumeVersions || [], text)
  };
}

function checkAppliedFromConfig(config = {}, query = {}) {
  const data = loadApplicationRecords(config.applicationsFile);
  return { ...checkApplied(data, query), source: config.applicationsFile ? "configured" : "none", error: data.error };
}

// 会话上下文：平台坑点、岗位速读、投递查重。只在 Bridge 本机计算，供 Agent 读取。
function buildSessionContext(request = {}, config = {}) {
  const page = request.page || {};
  const guide = platformKnowledge.getPlatformGuide(page.origin || `https://${page.hostname || ""}`, request.signals || []);
  const job = request.job || {};
  const hasJob = Boolean(job.title || job.description);
  return {
    platform: guide.platform ? { id: guide.platform.id, name: guide.platform.name, familyLabel: guide.platform.familyLabel, parse: guide.platform.parse, save: guide.platform.save, submitEvidence: guide.platform.submitEvidence, limits: guide.platform.limits } : null,
    tips: guide.tips,
    agentNotes: guide.agentNotes,
    generalRules: guide.generalRules,
    insight: hasJob ? analyzeJob(job, config) : null,
    applied: job.company || page.hostname
      ? checkAppliedFromConfig(config, { company: job.company, role: job.title, hostname: page.hostname })
      : null
  };
}

module.exports = { buildSessionContext, analyzeJob, checkAppliedFromConfig };

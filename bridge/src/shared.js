"use strict";

const fs = require("node:fs");
const path = require("node:path");

// 平台知识库和岗位速读与浏览器扩展共用同一份源码：仓库里从 ../../src 读取，发布包里从 ../lib 读取。
function loadShared(fileName) {
  const candidates = [
    path.join(__dirname, "..", "lib", fileName),
    path.join(__dirname, "..", "..", "src", fileName)
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return require(candidate);
    }
  }
  throw new Error(`Form2Offer shared module is missing: ${fileName}`);
}

module.exports = {
  platformKnowledge: loadShared("platform-knowledge.js"),
  jobInsight: loadShared("job-insight.js"),
  fillRules: loadShared("fill-rules.js")
};

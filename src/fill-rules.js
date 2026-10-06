(function attachForm2OfferFillRules(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.Form2OfferFillRules = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createForm2OfferFillRules() {
  "use strict";

  // 成绩排名：页面档位常与本人排名不一致（51job 只有前5%/前20%/前50%）。
  // 只选“仍包含真实排名的最小档”，不能选比真实成绩更好的档位。
  function parseRankPercent(value) {
    const text = String(value == null ? "" : value).replace(/\s+/g, "");
    const match = text.match(/(?:前|top)?(\d{1,3}(?:\.\d+)?)%/i);
    if (!match) return null;
    const percent = Number(match[1]);
    return percent > 0 && percent <= 100 ? percent : null;
  }

  function parseRankOption(label) {
    const text = String(label == null ? "" : label).replace(/\s+/g, "").replace(/％/g, "%");
    if (!/%/.test(text)) return null;
    const range = text.match(/(\d{1,3}(?:\.\d+)?)%?[-~～至到](\d{1,3}(?:\.\d+)?)%/);
    if (range) {
      const low = Number(range[1]);
      const high = Number(range[2]);
      return low < high ? { low, high } : null;
    }
    const after = text.match(/(\d{1,3}(?:\.\d+)?)%(?:以后|以下|之后|后)/);
    if (after) return { low: Number(after[1]), high: 100 };
    const within = text.match(/(?:前|top)?(\d{1,3}(?:\.\d+)?)%(?:以内|以上|之内)?/i);
    if (within) return { low: 0, high: Number(within[1]) };
    return null;
  }

  function pickRankOption(value, optionLabels) {
    const rank = parseRankPercent(value);
    if (rank == null) return null;
    const options = (Array.isArray(optionLabels) ? optionLabels : [])
      .map((label) => ({ label: String(label == null ? "" : label).trim(), bucket: parseRankOption(label) }))
      .filter((option) => option.label && option.bucket);
    if (options.length === 0) return null;
    const containing = options
      .filter((option) => (option.bucket.low === 0 ? rank <= option.bucket.high : option.bucket.low < rank && rank <= option.bucket.high))
      .sort((left, right) => left.bucket.high - right.bucket.high || right.bucket.low - left.bucket.low);
    if (containing.length === 0) return null;
    const chosen = containing[0];
    return {
      label: chosen.label,
      exact: chosen.bucket.high === rank,
      reason: chosen.bucket.high === rank
        ? "页面档位与资料排名一致"
        : `资料排名前${rank}%，页面没有该档，选择仍包含真实排名的“${chosen.label}”`
    };
  }

  // 只有年月的经历在要求精确到日的控件里：开始取 1 日、结束取月末（网申通行填报约定）。
  function projectMonthToDay(value, role) {
    const text = String(value == null ? "" : value).trim();
    if (!text || /至今|今|present|now/i.test(text)) return "";
    const full = text.match(/(\d{4})\s*[年./-]\s*(\d{1,2})\s*[月./-]\s*(\d{1,2})/);
    if (full) return `${full[1]}-${pad(full[2])}-${pad(full[3])}`;
    const month = text.match(/(\d{4})\s*[年./-]\s*(\d{1,2})/);
    if (!month) return "";
    const year = Number(month[1]);
    const monthNumber = Number(month[2]);
    if (monthNumber < 1 || monthNumber > 12) return "";
    const day = role === "end" ? new Date(Date.UTC(year, monthNumber, 0)).getUTCDate() : 1;
    return `${year}-${pad(monthNumber)}-${pad(day)}`;
  }

  function inferDateRole(label) {
    const text = String(label == null ? "" : label);
    if (/开始|起始|入学|入职|起|\b(?:from|start)\b/i.test(text)) return "start";
    if (/结束|截止|毕业|离职|止|\b(?:to|end)\b/i.test(text)) return "end";
    return "";
  }

  // 旧版北森 My97 日期框要求 yyyy/mm/dd，写 yyyy-mm-dd 会报“日期格式不正确”。
  function formatDateForPattern(value, pattern) {
    const text = String(value == null ? "" : value).trim();
    const hint = String(pattern == null ? "" : pattern);
    const match = text.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);
    if (!match) return text;
    const separator = /y{2,4}\s*\/\s*m{1,2}/i.test(hint) ? "/" : /y{2,4}\s*\.\s*m{1,2}/i.test(hint) ? "." : "-";
    return [match[1], match[2], match[3]].filter(Boolean).join(separator);
  }

  // 51job / 应届生企业表单的 maxlength 按字节算，汉字占 2。
  const BYTE_COUNTED_HOSTS = /(?:^|\.)(?:51job\.com|yingjiesheng\.com)$/i;

  function getMaxLengthUnit(hostname) {
    return BYTE_COUNTED_HOSTS.test(String(hostname || "")) ? "byte" : "char";
  }

  function measureTextLength(value, unit = "char") {
    const text = String(value == null ? "" : value);
    if (unit !== "byte") return Array.from(text).length;
    let length = 0;
    for (const char of text) {
      length += char.codePointAt(0) > 0xff ? 2 : 1;
    }
    return length;
  }

  function checkMaxLength(value, maxLength, unit = "char") {
    const limit = Number(maxLength);
    const length = measureTextLength(value, unit);
    if (!Number.isFinite(limit) || limit <= 0) {
      return { fits: true, length, maxLength: 0, unit };
    }
    return { fits: length <= limit, length, maxLength: limit, unit };
  }

  function pickVariantWithinLimit(variants, maxLength, unit = "char") {
    const candidates = (Array.isArray(variants) ? variants : [])
      .map((variant) => String(variant == null ? "" : variant).trim())
      .filter(Boolean);
    const fitting = candidates.filter((variant) => checkMaxLength(variant, maxLength, unit).fits);
    if (fitting.length === 0) return "";
    return fitting.sort((left, right) => measureTextLength(right, unit) - measureTextLength(left, unit))[0];
  }

  function pad(value) {
    return String(Number(value)).padStart(2, "0");
  }

  return {
    parseRankPercent,
    parseRankOption,
    pickRankOption,
    projectMonthToDay,
    inferDateRole,
    formatDateForPattern,
    getMaxLengthUnit,
    measureTextLength,
    checkMaxLength,
    pickVariantWithinLimit
  };
});

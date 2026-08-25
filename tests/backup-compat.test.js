const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const optionsSource = fs.readFileSync(path.join(root, "src", "options.js"), "utf8");
const sampleBackup = JSON.parse(fs.readFileSync(path.join(root, "sample-profile.json"), "utf8"));

test("exports Form2Offer backups and accepts both predecessor formats", () => {
  assert.match(optionsSource, /PROFILE_BACKUP_FORMAT = "Form2OfferProfileBackup"/);
  assert.match(optionsSource, /RESUMEBRIDGE_PROFILE_BACKUP_FORMAT = "ResumeBridgeProfileBackup"/);
  assert.match(optionsSource, /LEGACY_PROFILE_BACKUP_FORMAT = "OpenJobAutofillProfileBackup"/);
  assert.match(optionsSource, /supportedFormats\.has\(parsed\.format\)/);
  assert.match(optionsSource, /form2offer-profile-/);
  assert.equal(sampleBackup.format, "Form2OfferProfileBackup");
});

test("public manifest stays least-privilege and independently branded", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));

  assert.match(manifest.name, /Form2Offer/);
  assert.equal(manifest.version, "0.9.0");
  assert.equal(manifest.short_name, "Form2Offer");
  assert.equal(manifest.permissions.includes("alarms"), false);
  assert.equal(Object.hasOwn(manifest, "host_permissions"), false);
  assert.deepEqual(manifest.permissions, ["activeTab", "scripting", "storage"]);
  assert.equal(Object.hasOwn(manifest.background, "type"), false);
});

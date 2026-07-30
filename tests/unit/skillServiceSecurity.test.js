// Unit tests for the skillService security boundaries (review G1/G2,
// tech-design D9 + security section). These are implementation-tool unit
// tests (TDD discipline), not business-contract tests — the signed-off
// behavior contracts live under tests/capabilities/.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Settings/agent-registry isolation must be configured before the service
// modules are exercised (both read env lazily, so plain top-level assignment
// is safe even with ESM import hoisting).
const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "opc-skillsec-config-"));
process.env.OPC_WORKSTATION_CONFIG_DIR = configDir;

const skillService = await import("../../src/services/skillService.js");
const settingsService = await import("../../src/services/settingsService.js");

const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opc-skillsec-lib-"));
const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "opc-skillsec-outside-"));

function writeSkillMd(dir, { name, description }) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n\nBody\n`);
}

// A legitimately installed source inside the library.
writeSkillMd(path.join(repoRoot, "acme-tools", "skills", "review"), { name: "review", description: "Review code" });
// A malicious "source" that is itself a symlink escaping the library — this
// is what a local install of a symlinked directory plants (cpSync copies the
// link verbatim with dereference:false).
writeSkillMd(path.join(outsideDir, "evil-src", "skills", "escape"), { name: "escape", description: "escaped content" });
fs.symlinkSync(path.join(outsideDir, "evil-src"), path.join(repoRoot, "evil-tools"), "dir");

settingsService.saveSettings({ skillRepoPath: repoRoot });

after(() => {
  fs.rmSync(configDir, { recursive: true, force: true });
  fs.rmSync(repoRoot, { recursive: true, force: true });
  fs.rmSync(outsideDir, { recursive: true, force: true });
});

function assertIdentityInvalid(fn, label) {
  assert.throws(fn, (err) => {
    assert.equal(err.status, 400, `${label}: expected 400`);
    assert.equal(err.code, "SKILL_IDENTITY_INVALID", `${label}: expected SKILL_IDENTITY_INVALID`);
    return true;
  });
}

describe("G1: slug/skillName identity containment", () => {
  const project = { localPath: outsideDir, agentTypes: [] };

  it("rejects traversal slugs on link (../, .., nested paths, absolute)", () => {
    for (const slug of ["../sibling", "..", "a/b", "a\\b", path.resolve(repoRoot, "acme-tools")]) {
      assertIdentityInvalid(() => skillService.linkSkillToProject(project, { slug, skillName: "review" }), slug);
    }
  });

  it("rejects traversal/whitespace/control-char skillNames on link", () => {
    for (const skillName of ["../escape", "..", "a/b", "bad name", "bad\0name", "."]) {
      assertIdentityInvalid(() => skillService.linkSkillToProject(project, { slug: "acme-tools", skillName }), skillName);
    }
  });

  it("keeps SKILL_IDENTITY_REQUIRED for missing identity", () => {
    assert.throws(() => skillService.linkSkillToProject(project, { skillName: "review" }), (err) => {
      assert.equal(err.status, 400);
      assert.equal(err.code, "SKILL_IDENTITY_REQUIRED");
      return true;
    });
  });

  it("rejects traversal slugs on deleteSource without touching anything", () => {
    const sentinel = path.join(outsideDir, "sentinel.txt");
    fs.writeFileSync(sentinel, "do not delete");
    const parentOfRoot = path.dirname(repoRoot);
    const relativeEscape = path.relative(repoRoot, path.join(parentOfRoot, path.basename(outsideDir)));
    for (const slug of ["..", "../sibling", relativeEscape]) {
      assertIdentityInvalid(() => skillService.deleteSource(slug), slug);
    }
    assert.ok(fs.existsSync(sentinel), "outside content must be untouched");
    assert.ok(fs.existsSync(path.join(repoRoot, "acme-tools")), "library content must be untouched");
  });

  it("rejects traversal slugs on requestSourceUpdate", async () => {
    for (const slug of ["..", "../sibling", "a/b"]) {
      await assert.rejects(() => skillService.requestSourceUpdate(slug), (err) => {
        assert.equal(err.status, 400);
        assert.equal(err.code, "SKILL_IDENTITY_INVALID");
        return true;
      });
    }
  });

  it("D9: refuses to link a skill dir whose realpath escapes the library", () => {
    assert.throws(
      () => skillService.linkSkillToProject(project, { slug: "evil-tools", skillName: "escape" }),
      (err) => {
        assert.equal(err.status, 400);
        assert.equal(err.code, "SKILL_SOURCE_INVALID");
        return true;
      }
    );
    // No link may have been created anywhere.
    assert.ok(!fs.existsSync(path.join(outsideDir, ".claude", "skills", "escape")));
  });
});

describe("G2: git identifier protocol whitelist", () => {
  it("rejects option-shaped identifiers (--upload-pack et al.) before creating a job", async () => {
    for (const identifier of ["--upload-pack=touch /tmp/pwn", "-c core.sshCommand=x", "--depth"]) {
      await assert.rejects(() => skillService.startInstall({ sourceType: "git", identifier }), (err) => {
        assert.equal(err.status, 400, `${identifier}: expected 400`);
        assert.equal(err.code, "SKILL_SOURCE_INVALID", `${identifier}: expected SKILL_SOURCE_INVALID`);
        return true;
      });
    }
  });

  it("rejects executable transports (ext::, ftp) and bare paths", async () => {
    for (const identifier of ["ext::touch /tmp/pwn2", "ftp://example.com/repo.git", "/tmp/local-repo", "git://example.com/r.git"]) {
      await assert.rejects(() => skillService.startInstall({ sourceType: "git", identifier }), (err) => {
        assert.equal(err.status, 400, `${identifier}: expected 400`);
        assert.equal(err.code, "SKILL_SOURCE_INVALID", `${identifier}: expected SKILL_SOURCE_INVALID`);
        return true;
      });
    }
  });

  it("accepts https/ssh/scp-like/file identifiers (whitelist shape only)", async () => {
    // These must pass the whitelist and fail later (git fetch of a bogus
    // host), proving the rejection above comes from the whitelist, not from
    // generic fetch failure. file:// bogus paths reach the async job as
    // SKILL_FETCH_FAILED rather than a synchronous 400.
    const { jobId } = await skillService.startInstall({ sourceType: "git", identifier: "file:///definitely/not/here" });
    assert.ok(jobId, "file:// identifiers must pass the whitelist");
  });
});

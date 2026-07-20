// 测试夹具：临时项目目录 helper（真实文件系统隔离）。
// 支撑 REQ-COLL-001/002/003、REQ-SCHEDULE-008、REQ-WORKSPACE-008/010 的真实 I/O 断言。
// 每个测试用例独立 mkdtemp，afterEach 清理，避免共享可变状态。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * 创建临时项目目录（含素材库常用子目录）。
 *
 * @param {string} [prefix="opc-media-proj-"]
 * @returns {{dir: string, outputsDir: string, materialsDir: string, cleanup: () => void}}
 */
export function makeTmpProjectDir(prefix = "opc-media-proj-") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const outputsDir = path.join(dir, "outputs");
  const materialsDir = path.join(dir, "materials");
  fs.mkdirSync(outputsDir, { recursive: true });
  fs.mkdirSync(materialsDir, { recursive: true });
  return {
    dir,
    outputsDir,
    materialsDir,
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
}

/**
 * 创建裸临时目录（不预建子目录；HOME/userData 模拟用）。
 *
 * @param {string} [prefix="opc-media-home-"]
 * @returns {{dir: string, cleanup: () => void}}
 */
export function makeTmpDir(prefix = "opc-media-home-") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return {
    dir,
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
}

/** 断言辅助：读取文件内容，不存在时返回 null（不抛错，交给断言给出可读失败信息）。 */
export function readFileIfExists(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

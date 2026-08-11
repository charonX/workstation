// src/services/policyRules.js
// 出厂权限规则声明式数据（tech-design 接口 5；REQ-AGENT-041）——评估器与生成器
// 共同消费的**唯一真源**。
//
// 规则形态：每条 `{ pattern, decision, hotPathVisible, family, globs }`。
//   - pattern：bash 破坏性模式的 RegExp source（评估器 new RegExp 编译，语义与
//     既有附录 A 字面量逐字一致——行为保持硬标准：permissionPolicy 既有测试不修改全绿）；
//   - decision：命中裁决（本层无 deny 类，∈ {allow, ask}）；
//   - hotPathVisible：gotgenes 热路径（tree-sitter command-enumeration）对该命令/
//     运算符可见与否——`false` = 重定向/管道不可见族（BUG-002：热路径枚举跳过
//     file_redirect 节点与 `|` 匿名 token），仅评估器/pre-gate 消费，**不进入**
//     部署 JSON（B7：不可见族只活在 pre-gate）；
//   - family：归属族（B7 双确认家族判别定位：redirect / pipe-to-shell / destructive-fs
//     / privilege-escalation / process / file-permission / disk / git-force-push /
//     global-install / git-destructive / code-execution / script-execution /
//     global-config）；
//   - globs：gotgenes glob 渲染清单（仅 hotPathVisible:true 且 decision:ask 的规则
//     有部署表达面；生成器按其输出 `bash` surface，顺序即 JSON 键序）。
//
// 非声明化部分（tech-design 接口 5「非声明化部分」）：cwd 外路径启发式、strip
// 算法、wrapper floor（gotgenes #481）留 permissionPolicy——本就不在 JSON 表达面；
// 工具默认裁决（读 allow/写 ask）与 CLI 高危分类（既有 toolAdapter TOOL_DEFS
// 单一真源）保持评估器内建。
//
// 消费方：
//   - permissionPolicy 评估器：BASH_DESTRUCTIVE_PATTERNS（全部 bash 模式，无论
//     可见性——重定向/管道在评估层照常 ask）；
//   - scripts/gen-agent-policy.mjs 生成器：BASH_RULES（hotPathVisible:true 族的
//     globs → 部署 JSON）。

// bash 破坏性模式规则表（自 permissionPolicy 既有 BASH_DESTRUCTIVE_PATTERNS
// 平移；顺序保持评估层既有匹配顺序）。
export const BASH_RULES = [
  {
    pattern: "(^|\\s)(rm|rmdir)(\\s|$)",
    decision: "ask",
    hotPathVisible: true,
    family: "destructive-fs",
    globs: ["rm *", "rm", "rmdir *"],
  },
  {
    pattern: "(^|\\s)sudo(\\s|$)",
    decision: "ask",
    hotPathVisible: true,
    family: "privilege-escalation",
    globs: ["sudo *"],
  },
  {
    pattern: ">+",
    decision: "ask",
    hotPathVisible: false, // 重定向不可见族：只活在 pre-gate（B7）
    family: "redirect",
  },
  {
    pattern: "\\|\\s*(ba)?sh(\\s|$)",
    decision: "ask",
    hotPathVisible: false, // 管道到 shell 不可见族：只活在 pre-gate（B7）
    family: "pipe-to-shell",
  },
  {
    pattern: "(^|\\s)(kill|pkill)(\\s|$)",
    decision: "ask",
    hotPathVisible: true,
    family: "process",
    globs: ["kill *", "pkill *"],
  },
  {
    pattern: "(^|\\s)(chmod|chown)(\\s|$)",
    decision: "ask",
    hotPathVisible: true,
    family: "file-permission",
    globs: ["chmod *", "chown *"],
  },
  {
    pattern: "(^|\\s)dd(\\s|$)",
    decision: "ask",
    hotPathVisible: true,
    family: "disk",
    globs: ["dd *"],
  },
  {
    pattern: "(^|\\s)mkfs(\\s|$)",
    decision: "ask",
    hotPathVisible: true,
    family: "disk",
    globs: ["mkfs *"],
  },
  {
    pattern: "(^|\\s)mv(\\s|$)",
    decision: "ask",
    hotPathVisible: true,
    family: "destructive-fs",
    globs: ["mv *", "mv"],
  },
  {
    pattern: "(^|\\s)git\\s+push\\s+(--force|-f)",
    decision: "ask",
    hotPathVisible: true,
    family: "git-force-push",
    globs: ["git push --force*", "git push -f*"],
  },
  {
    pattern: "(^|\\s)(npm|pnpm)\\s+(i|install|add)\\s+(-g|--global)",
    decision: "ask",
    hotPathVisible: true,
    family: "global-install",
    globs: [
      "npm i -g *",
      "npm i --global *",
      "npm install -g *",
      "npm install --global *",
      "npm add -g *",
      "npm add --global *",
      "pnpm i -g *",
      "pnpm i --global *",
      "pnpm install -g *",
      "pnpm install --global *",
      "pnpm add -g *",
      "pnpm add --global *",
    ],
  },
  {
    pattern: "(^|\\s)yarn\\s+global(\\s|$)",
    decision: "ask",
    hotPathVisible: true,
    family: "global-install",
    globs: ["yarn global *"],
  },
  // ── 出厂高危清单扩围（对齐 Claude Code 分类器默认拦截面的确定性危险命令；
  //    兜底仍为 `"*": "allow"`，命中才 ask）──
  // git-destructive：丢弃未提交改动族（reset --hard / checkout -- / restore /
  // clean / stash drop|clear）。
  {
    pattern: "(^|\\s)git\\s+reset\\s+--hard(\\s|$)",
    decision: "ask",
    hotPathVisible: true,
    family: "git-destructive",
    globs: ["git reset --hard*"],
  },
  {
    pattern: "(^|\\s)git\\s+checkout\\s+--(\\s|$)",
    decision: "ask",
    hotPathVisible: true,
    family: "git-destructive",
    globs: ["git checkout --*"],
  },
  {
    pattern: "(^|\\s)git\\s+restore(\\s|$)",
    decision: "ask",
    hotPathVisible: true,
    family: "git-destructive",
    globs: ["git restore*"],
  },
  {
    pattern: "(^|\\s)git\\s+clean(\\s|$)",
    decision: "ask",
    hotPathVisible: true,
    family: "git-destructive",
    globs: ["git clean*"],
  },
  {
    pattern: "(^|\\s)git\\s+stash\\s+(drop|clear)(\\s|$)",
    decision: "ask",
    hotPathVisible: true,
    family: "git-destructive",
    globs: ["git stash drop*", "git stash clear*"],
  },
  // code-execution：内联代码执行族（解释器 -c/-e/-r 直接执行代码串）。
  {
    pattern: "(^|\\s)(python|python3)\\s+-c(\\s|$)",
    decision: "ask",
    hotPathVisible: true,
    family: "code-execution",
    globs: ["python -c*", "python3 -c*"],
  },
  {
    pattern: "(^|\\s)node\\s+(-e|--eval)(\\s|$)",
    decision: "ask",
    hotPathVisible: true,
    family: "code-execution",
    globs: ["node -e*", "node --eval*"],
  },
  {
    pattern: "(^|\\s)perl\\s+-e(\\s|$)",
    decision: "ask",
    hotPathVisible: true,
    family: "code-execution",
    globs: ["perl -e*"],
  },
  {
    pattern: "(^|\\s)ruby\\s+-e(\\s|$)",
    decision: "ask",
    hotPathVisible: true,
    family: "code-execution",
    globs: ["ruby -e*"],
  },
  {
    pattern: "(^|\\s)php\\s+-r(\\s|$)",
    decision: "ask",
    hotPathVisible: true,
    family: "code-execution",
    globs: ["php -r*"],
  },
  // script-execution：直接执行脚本族（sh/bash 执行脚本或 bash -c；与既有
  // pipe-to-shell 区分——这里是直接执行，不是管道到 shell）。bash 无参不在
  // glob 面（`bash script.sh` 会 ask）。
  {
    pattern: "(^|\\s)(sh|bash)\\s+(-c\\s+)?(\\S+)?(\\s|$)",
    decision: "ask",
    hotPathVisible: true,
    family: "script-execution",
    globs: ["sh *", "bash *"],
  },
  {
    pattern: "(^|\\s)source\\s+(\\S+)(\\s|$)",
    decision: "ask",
    hotPathVisible: true,
    family: "script-execution",
    globs: ["source *"],
  },
  // global-config：全局配置篡改族（git config --global / npm|pnpm config set）。
  {
    pattern: "(^|\\s)git\\s+config\\s+--global(\\s|$)",
    decision: "ask",
    hotPathVisible: true,
    family: "global-config",
    globs: ["git config --global*"],
  },
  {
    pattern: "(^|\\s)(npm|pnpm)\\s+config\\s+set(\\s|$)",
    decision: "ask",
    hotPathVisible: true,
    family: "global-config",
    globs: ["npm config set*", "pnpm config set*"],
  },
];

// 评估器消费面：全部 bash 破坏性模式（无论 hotPathVisible——不可见族在评估层
// 照常 ask，pre-gate 不可见族三逻辑不变），编译为 RegExp 清单（无 flags，与既有
// 字面量语义逐字一致）。
export const BASH_DESTRUCTIVE_PATTERNS = BASH_RULES.map((rule) => new RegExp(rule.pattern));

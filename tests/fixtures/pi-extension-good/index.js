// Fixture：合法 pi extension（本地路径来源测试用）。
// 注册一个固定工具 fixture_echo，供会话工具面断言。
export default function fixtureExtension(pi) {
  pi.registerTool({
    name: "fixture_echo",
    description: "echo back the input (test fixture)",
    parameters: { type: "object", properties: { text: { type: "string" } } },
    async execute(_id, params) {
      return { content: [{ type: "text", text: String(params?.text ?? "") }] };
    },
  });
}

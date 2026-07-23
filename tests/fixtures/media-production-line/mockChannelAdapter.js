// 测试夹具：channelAdapter 接口的内存 fake（不依赖飞书 SDK / 网络）。
// 支撑 REQ-SCHEDULE-009（终态投递钩子）、REQ-CHANNEL-002（IM 路由）的集成测试。
//
// 接口契约对齐 tech-design「channelAdapter 接口」：
//   start({credentials}) / send({chatId, text}) / reply({messageId, text}) / getStatus() / onMessage(callback)
// 这是测试替身（Fake），可完整使用；不是产品代码骨架。

/**
 * 创建一个记录全部调用的 fake channelAdapter。
 *
 * @returns {{
 *   start: (args: {credentials: object}) => Promise<void>,
 *   send: (args: {chatId: string, text: string}) => Promise<{messageId: string}>,
 *   reply: (args: {messageId: string, text: string}) => Promise<{messageId: string}>,
 *   getStatus: () => "connecting"|"online"|"offline",
 *   onMessage: (cb: (msg: {messageId: string, chatId: string, senderId: string, text: string}) => void) => void,
 *   emitMessage: (msg: object) => void,
 *   setStatus: (status: "connecting"|"online"|"offline") => void,
 *   failNextSend: (times?: number) => void,
 *   sent: Array<{chatId: string, text: string}>,
 *   replies: Array<{messageId: string, text: string}>,
 *   startedWith: Array<object>
 * }}
 */
export function createMockChannelAdapter() {
  let status = "offline";
  let sendFailuresRemaining = 0;
  const listeners = new Set();
  const sent = [];
  const replies = [];
  const startedWith = [];
  let seq = 0;

  return {
    sent,
    replies,
    startedWith,

    async start({ credentials } = {}) {
      startedWith.push(credentials || {});
      status = "online";
    },

    async send({ chatId, text, msgType, content } = {}) {
      sent.push({ chatId, text, msgType, content });
      if (sendFailuresRemaining > 0) {
        sendFailuresRemaining -= 1;
        throw new Error("E-CHANNEL-SEND: mock channel adapter injected send failure");
      }
      seq += 1;
      return { messageId: `om_mock_${seq}` };
    },

    async reply({ messageId, text, msgType, content } = {}) {
      replies.push({ messageId, text, msgType, content });
      if (sendFailuresRemaining > 0) {
        sendFailuresRemaining -= 1;
        throw new Error("E-CHANNEL-SEND: mock channel adapter injected reply failure");
      }
      seq += 1;
      return { messageId: `om_mock_reply_${seq}` };
    },

    getStatus() {
      return status;
    },

    onMessage(cb) {
      listeners.add(cb);
    },

    /** 测试侧注入一条入向 IM 消息（等价于 WS 收到 im.message.receive_v1）。 */
    emitMessage(msg) {
      for (const cb of listeners) {
        cb(msg);
      }
    },

    setStatus(next) {
      status = next;
    },

    /** 让下 times 次 send/reply 抛错（投递失败不反转终态分支用）。 */
    failNextSend(times = 1) {
      sendFailuresRemaining += times;
    }
  };
}

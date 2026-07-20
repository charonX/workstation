// Per-project serial execution queue.
// Enforces a single in-flight execution per projectId and a maximum queue depth
// of 50 (including the running one). Surplus enqueue requests are rejected with
// E-QUEUE-FULL so callers can reply appropriately.

const PROJECT_QUEUE_LIMIT = 50;

export function createExecutionQueue() {
  const queues = new Map();
  let destroyed = false;

  function getProjectQueue(projectId) {
    if (!queues.has(projectId)) {
      queues.set(projectId, []);
    }
    return queues.get(projectId);
  }

  function totalItems() {
    let total = 0;
    for (const q of queues.values()) {
      total += q.length;
    }
    return total;
  }

  function dequeueNext(projectId) {
    if (destroyed) return;
    const q = queues.get(projectId);
    if (!q || q.length === 0) return;
    const next = q[0];
    Promise.resolve()
      .then(() => next.run())
      .then((value) => next.resolve(value), (err) => next.reject(err))
      .finally(() => {
        const current = queues.get(projectId);
        if (current && current[0] === next) {
          current.shift();
        }
        // Do not continue processing a queue that has been torn down; any
        // remaining pending items were rejected by destroy().
        if (!destroyed) {
          dequeueNext(projectId);
        }
      });
  }

  return {
    enqueue({ projectId, executionId, run }) {
      if (typeof run !== "function") {
        return Promise.reject(new Error("run must be a function"));
      }
      const q = getProjectQueue(projectId);
      if (q.length >= PROJECT_QUEUE_LIMIT) {
        const err = new Error("Project execution queue is full (E-QUEUE-FULL)");
        err.code = "E-QUEUE-FULL";
        return Promise.reject(err);
      }
      return new Promise((resolve, reject) => {
        const item = { projectId, executionId, run, resolve, reject };
        const wasEmpty = q.length === 0;
        q.push(item);
        if (wasEmpty) {
          dequeueNext(projectId);
        }
      });
    },

    getPosition(executionId) {
      for (const q of queues.values()) {
        const index = q.findIndex((item) => item.executionId === executionId);
        if (index !== -1) {
          return index + 1;
        }
      }
      return -1;
    },

    size(projectId) {
      if (projectId) {
        return queues.get(projectId)?.length ?? 0;
      }
      return queues.size;
    },

    pendingCount() {
      return totalItems();
    },

    isDestroyed() {
      return destroyed;
    },

    destroy() {
      destroyed = true;
      for (const q of queues.values()) {
        // Reject every pending item except the one currently running (q[0]).
        for (let i = 1; i < q.length; i++) {
          const item = q[i];
          const err = new Error("Execution queue was drained (E-QUEUE-DRAINED)");
          err.code = "E-QUEUE-DRAINED";
          try {
            item.reject(err);
          } catch {
            // Ignore reject handler failures.
          }
        }
        q.length = 1;
      }
    },

    clear() {
      queues.clear();
    }
  };
}

// Server startup recovery: any execution left queued or running from a previous
// process is marked error with reason=server-restart. We do not auto-re-run them.
export function recoverInterruptedExecutions(db) {
  const select = db.prepare(`SELECT id, variables FROM executions WHERE status IN (?, ?)`);
  const update = db.prepare(`UPDATE executions SET status = ?, endedAt = ?, variables = ? WHERE id = ?`);
  const now = new Date().toISOString();
  const recover = db.transaction(() => {
    for (const row of select.all("queued", "running")) {
      const variables = JSON.parse(row.variables || "{}");
      variables.reason = "server-restart";
      update.run("error", now, JSON.stringify(variables), row.id);
    }
  });
  recover();
}

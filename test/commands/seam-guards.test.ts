import { describe, expect, it } from "vitest";
import { rmCommand } from "../../src/commands/crud.js";
import type { TasksContext } from "../../src/context.js";
import type { Task, TaskInput } from "../../src/model.js";
import type { Capabilities, Store } from "../../src/store.js";

/**
 * A minimal in-memory Store with NO internal guards, standing in for a
 * backend (e.g. a remote tracker) whose `remove` would happily de-manage a
 * task that still blocks others. The seam-level dependents guard in the
 * command layer must protect it anyway - `makeFakeBackendBacklog` cannot
 * prove that, because its wrapped MarkdownStore guards internally too.
 */
class GuardlessStore implements Store {
  tasks = new Map<string, Task>();
  removeCalls: string[] = [];

  capabilities(): Capabilities {
    return {
      backend: "guardless",
      deps: true,
      prune: false,
      comments: false,
      fullTextSearch: false,
      realtimeSync: false,
      customStates: false,
      serverMintsIds: false,
      publicFollowups: false,
    };
  }

  seed(task: Partial<Task> & { id: string }): void {
    this.tasks.set(task.id, {
      title: task.id,
      state: "queued",
      links: [],
      deps: [],
      ...task,
    });
  }

  create(input: TaskInput): Promise<Task> {
    this.seed(input as Partial<Task> & { id: string });
    return Promise.resolve(this.tasks.get(input.id) as Task);
  }

  get(id: string): Promise<Task | null> {
    return Promise.resolve(this.tasks.get(id) ?? null);
  }

  update(): Promise<never> {
    return Promise.reject(new Error("not implemented"));
  }

  remove(id: string): Promise<Task> {
    this.removeCalls.push(id);
    const task = this.tasks.get(id) as Task;
    this.tasks.delete(id);
    return Promise.resolve(task);
  }

  list(): Promise<{ items: Task[]; total: number }> {
    const items = [...this.tasks.values()];
    return Promise.resolve({ items, total: items.length });
  }

  transition(): Promise<never> {
    return Promise.reject(new Error("not implemented"));
  }

  addDep(): Promise<never> {
    return Promise.reject(new Error("not implemented"));
  }

  removeDep(): Promise<never> {
    return Promise.reject(new Error("not implemented"));
  }

  updatePublicFollowup(): Promise<never> {
    return Promise.reject(new Error("not implemented"));
  }
}

function guardlessCtx(store: GuardlessStore): TasksContext {
  return {
    store,
    config: { backend: "guardless", path: "/nonexistent/backlog.md", doneKeep: 10 },
  };
}

describe("rm dependents guard at the seam", () => {
  it("refuses to remove a task that still blocks active tasks", async () => {
    const store = new GuardlessStore();
    store.seed({ id: "blocker-t1" });
    store.seed({
      id: "dependent-d2",
      deps: [{ type: "blocked-by", id: "blocker-t1" }],
    });
    await expect(
      rmCommand(["blocker-t1"], guardlessCtx(store)),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: 'Task "blocker-t1" is still blocking active tasks: dependent-d2',
    });
    expect(store.removeCalls).toEqual([]);
  });

  it("allows removal once the dependent is done", async () => {
    const store = new GuardlessStore();
    store.seed({ id: "blocker-t1" });
    store.seed({
      id: "dependent-d2",
      state: "done",
      deps: [{ type: "blocked-by", id: "blocker-t1" }],
    });
    const out = await rmCommand(["blocker-t1"], guardlessCtx(store));
    expect(out).toContain("ok: removed blocker-t1");
    expect(store.removeCalls).toEqual(["blocker-t1"]);
  });
});

// Şevval Boyraz, 2200004208
// Bonus 13: the open WebSockets of every user, so a change reaches only its owner.
import type { Task } from "./schema.ts";

export type LiveEvent = {
  type: "created" | "updated" | "deleted" | "restored";
  task: Task;
};

export class LiveHub {
  #sockets = new Map<number, Set<WebSocket>>();

  add(userId: number, socket: WebSocket) {
    let set = this.#sockets.get(userId);
    if (!set) this.#sockets.set(userId, set = new Set());
    set.add(socket);
  }

  remove(userId: number, socket: WebSocket) {
    const set = this.#sockets.get(userId);
    set?.delete(socket);
    if (set?.size === 0) this.#sockets.delete(userId);
  }

  /** How many sockets a user has open (for tests and logs). */
  count(userId: number): number {
    return this.#sockets.get(userId)?.size ?? 0;
  }

  /** Send to this user's sockets only, never to everyone. */
  send(userId: number, event: LiveEvent) {
    const message = JSON.stringify(event);
    for (const socket of this.#sockets.get(userId) ?? []) {
      if (socket.readyState === WebSocket.OPEN) socket.send(message);
    }
  }
}

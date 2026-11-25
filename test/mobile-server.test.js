import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import test from "node:test";
import WebSocket from "ws";

const publicOrigin = "https://game.example.test";

// Register the listener before sending an action so fast local replies are observed.
function nextMessage(socket, accept) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error("Timed out waiting for the game server")), 5000);
    function finish(error, message) {
      clearTimeout(timer);
      socket.off("message", receive);
      socket.off("error", finish);
      if (error) reject(error);
      else resolve(message);
    }
    function receive(data) {
      const message = JSON.parse(data);
      if (message.type === "error") finish(new Error(message.text));
      else if (accept(message)) finish(null, message);
    }
    socket.on("message", receive);
    socket.once("error", finish);
  });
}

test("self-hosted mobile entry and multiplayer", { timeout: 30000 }, async (t) => {
  const child = spawn(process.execPath, ["server.js"], {
    cwd: new URL("../", import.meta.url),
    env: { ...process.env, HOST: "127.0.0.1", PORT: "0", PUBLIC_ORIGIN: publicOrigin },
    stdio: ["ignore", "pipe", "inherit"],
  });
  t.after(() => child.kill());
  const lines = createInterface({ input: child.stdout });
  let origin;
  for await (const line of lines) {
    const match = line.match(/本机 (http:\/\/127\.0\.0\.1:\d+)\//);
    if (match) { origin = match[1]; break; }
  }
  assert.ok(origin, "server started");

  await t.test("room invitations, game assets and home-screen launch use the mobile route", async () => {
    const response = await fetch(origin + "/mobile?room=ABCDE", { redirect: "manual" });
    assert.equal(response.headers.get("location"), "/mobile/?room=ABCDE");
    const entry = origin + "/mobile/";
    const html = await (await fetch(entry)).text();
    assert.match(html, /id="btn-lan"/);
    const manifestUrl = new URL("./manifest.webmanifest", entry);
    const manifest = await (await fetch(manifestUrl)).json();
    for (const key of ["id", "start_url", "scope"]) assert.equal(new URL(manifest[key], manifestUrl).href, entry);
    for (const file of ["style.css", "mobile.css", "js/main.js", "js/lan.js", "node_modules/three/build/three.module.js",
      ...manifest.icons.map((icon) => icon.src)]) {
      assert.equal((await fetch(new URL(file, entry), { method: "HEAD" })).status, 200, file);
    }
    assert.equal((await fetch(entry + "server.js")).status, 404);
  });

  const endpoint = origin.replace("http:", "ws:") + "/lan";
  await t.test("an unrelated Origin is refused", async () => {
    const socket = new WebSocket(endpoint, { origin: "https://other.example.test" });
    const [error] = await once(socket, "error");
    assert.match(error.message, /403/);
  });

  for (const mode of ["coop", "pvp"]) {
    await t.test(mode + " clients join a room and receive the first playing snapshot", async (t) => {
      const createClient = async () => {
        const socket = new WebSocket(endpoint, { origin: publicOrigin });
        t.after(() => socket.terminate());
        const hello = await nextMessage(socket, (msg) => msg.type === "hello");
        assert.deepEqual(hello.addresses, [publicOrigin]);
        return socket;
      };
      const host = await createClient();
      const guest = await createClient();
      const created = nextMessage(host, (msg) => msg.type === "room");
      host.send(JSON.stringify({ type: "create", mode, name: "Host" }));
      const { code } = await created;
      const joined = nextMessage(guest, (msg) => msg.type === "room" && msg.members.length === 2);
      guest.send(JSON.stringify({ type: "join", code, name: "Guest" }));
      assert.equal((await joined).mode, mode);
      const started = Promise.all([host, guest].map((socket) => nextMessage(socket, (msg) => msg.type === "snapshot")));
      host.send(JSON.stringify({ type: "start" }));
      for (const snapshot of await started) {
        assert.equal(snapshot.phase, "playing");
        assert.equal(snapshot.mode, mode);
        assert.equal(snapshot.players.length, 2);
      }
    });
  }
});

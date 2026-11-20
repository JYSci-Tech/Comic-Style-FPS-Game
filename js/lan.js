import { INPUT_KEYS, KILL_LIMIT, ROOM_SIZE } from "./lan-rules.js";
import { LanView } from "./lan-view.js";

const element = (id) => document.getElementById(id);
const show = (node, visible) => node.classList.toggle("hidden", !visible);
const modeName = (mode) => mode === "coop" ? "合作闯关" : "玩家对战";

export class LanClient {
  constructor(engine, callbacks) {
    this.engine = engine;
    this.callbacks = callbacks;
    this.view = new LanView(engine);
    this.entryScreen = element("lan-screen");
    this.matchScreen = element("lan-match-screen");
    this.respawnScreen = element("respawn-screen");
    this.name = element("lan-name");
    this.code = element("lan-code");
    this.status = element("lan-status");
    this.board = element("hud-lan");
    this.pending = [];
    this.addresses = [];
    this.lastInput = 0;
    this.resultRevealAt = 0;
    this.resultRevealTimer = null;

    this.name.value = "玩家" + Math.floor(1000 + Math.random() * 9000);
    const invite = new URLSearchParams(location.search).get("room");
    if (/^[A-Z2-9]{5}$/i.test(invite || "")) this.code.value = invite.toUpperCase();

    element("btn-lan").addEventListener("click", () => this.open());
    element("lan-back").addEventListener("click", () => this.close());
    element("lan-reconnect").addEventListener("click", () => this.connect());
    for (const [button, mode] of [["lan-coop", "coop"], ["lan-pvp", "pvp"]]) {
      element(button).addEventListener("click", () => {
        if (this.name.reportValidity()) this.send({ type: "create", name: this.name.value, mode });
      });
    }
    element("lan-join").addEventListener("submit", (event) => {
      event.preventDefault();
      if (this.name.reportValidity()) this.send({ type: "join", name: this.name.value, code: this.code.value });
    });
    element("lan-invite").addEventListener("focus", (event) => event.currentTarget.select());
    for (const [button, type] of [["lan-start", "start"], ["lan-leave", "leave"], ["lan-exit", "leave"],
      ["lan-next", "next"], ["lan-retry", "retry"], ["lan-return", "lobby"]]) {
      element(button).addEventListener("click", () => this.send({ type }));
    }
    element("lan-focus").addEventListener("click", () => {
      this.engine.audio.init();
      this.callbacks.lockPointer();
    });
    element("lan-home").addEventListener("click", () => this.close());
    if (this.code.value) this.open();
  }

  get isHost() {
    return this.room?.host === this.id;
  }

  get focused() {
    return document.pointerLockElement === this.engine.glCanvas;
  }

  get canControl() {
    return this.match?.phase === "playing" && this.focused && this.view.me?.hp > 0;
  }

  open() {
    this.active = true;
    this.callbacks.onOpen();
    this.renderRoom();
    this.connect();
  }

  close() {
    this.active = false;
    const socket = this.socket;
    this.socket = null;
    if (socket) socket.close();
    this.id = null;
    this.room = null;
    this.clearMatch();
    show(this.entryScreen, false);
    this.callbacks.onClose();
  }

  connect() {
    if (this.socket && this.socket.readyState < WebSocket.CLOSING) return;
    this.status.textContent = "正在连接局域网服务…";
    this.setConnected(false);
    show(element("lan-reconnect"), false);
    const url = new URL("/lan", location.href);
    url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(url);
    this.socket = socket;
    const timeout = setTimeout(() => { if (!this.id) socket.close(); }, 5000);
    socket.addEventListener("message", (event) => {
      if (socket === this.socket) this.receive(JSON.parse(event.data));
    });
    socket.addEventListener("close", () => {
      clearTimeout(timeout);
      if (socket !== this.socket) return;
      const wasConnected = Boolean(this.id);
      this.socket = null;
      this.id = null;
      this.room = null;
      this.clearMatch();
      this.renderRoom();
      this.setConnected(false);
      this.status.textContent = wasConnected
        ? "连接已中断。重新连接后可加入房间。"
        : "连接失败。请确认房主已运行联机服务，并从房主提供的地址打开游戏。";
      show(element("lan-reconnect"), true);
    });
  }

  setConnected(connected) {
    for (const id of ["lan-pvp", "lan-coop", "lan-join-button"]) element(id).disabled = !connected;
  }

  send(message) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  receive(message) {
    if (message.type === "hello") {
      this.id = message.id;
      this.addresses = message.addresses;
      this.setConnected(true);
      this.renderRoom();
    } else if (message.type === "error") {
      this.status.textContent = message.text;
    } else if (message.type === "room") {
      this.room = message;
      if (!message.playing) this.clearMatch();
      this.renderRoom();
      if (this.match) this.renderMatch();
    } else if (message.type === "left") {
      this.room = null;
      this.clearMatch();
      this.renderRoom();
    } else if (message.type === "snapshot" && this.room?.playing) {
      this.applySnapshot(message);
    }
  }

  renderRoom() {
    show(this.entryScreen, this.active && !this.room?.playing);
    show(element("lan-room"), Boolean(this.room));
    show(element("lan-entry"), !this.room);
    if (!this.room) {
      if (this.id) this.status.textContent = "同一网络下的 2–4 名玩家可以一起游戏。";
      return;
    }
    const { code, mode, members, host, note } = this.room;
    this.code.value = code;
    element("lan-room-mode").textContent = modeName(mode) + " · " + code;
    const localHostname = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
    const invite = new URL(localHostname && this.addresses.length ? this.addresses[0] : "/", location.href);
    invite.searchParams.set("room", code);
    element("lan-invite").value = invite.href;
    element("lan-members").replaceChildren(...members.map((member) => {
      const row = document.createElement("li");
      row.textContent = member.name + (member.id === this.id ? "（你）" : "") + (member.id === host ? " · 房主" : "");
      return row;
    }));
    show(element("lan-start"), this.isHost);
    element("lan-start").disabled = members.length < 2;
    const rule = mode === "coop" ? "组队完成五期关卡" : "率先击倒对手 10 次获胜";
    this.status.textContent = note || (members.length < 2 ? "把邀请链接发给队友，至少两人即可开始。"
      : members.length + "/" + ROOM_SIZE + " 人 · " + rule + (this.isHost ? "" : " · 等待房主开始"));
  }

  applySnapshot(snapshot) {
    const me = snapshot.players.find((player) => player.id === this.id);
    if (!me) return;
    const changedRound = snapshot.round !== this.match?.round;
    const changedPhase = snapshot.phase !== this.match?.phase;
    const changedLife = changedRound || this.view.me?.life !== me.life;
    this.match = snapshot;
    if (changedLife || changedPhase || me.hp <= 0) this.clearControls();
    if (changedLife) this.weapon = me.weapon;
    this.view.apply(snapshot, this.room, this.id, changedRound, changedLife);
    if (changedRound || snapshot.phase !== "playing") this.callbacks.unlockPointer();
    if (changedRound || changedPhase) {
      this.callbacks.onMatch(true);
      if (snapshot.phase !== "playing") {
        this.startResultDelay();
      } else {
        this.clearResultDelay();
      }
      this.renderMatch();
    }
    this.renderRespawnOverlay();
    this.renderScoreboard();
  }

  clearResultDelay() {
    this.resultRevealAt = 0;
    if (this.resultRevealTimer) {
      clearInterval(this.resultRevealTimer);
      this.resultRevealTimer = null;
    }
  }

  startResultDelay() {
    this.clearResultDelay();
    this.resultRevealAt = performance.now() + 2600;
    this.resultRevealTimer = setInterval(() => {
      this.updateMatchActionDelay();
      if (performance.now() >= this.resultRevealAt) {
        this.clearResultDelay();
      }
    }, 100);
  }

  updateMatchActionDelay() {
    const actions = element("lan-match-actions");
    const waitEl = element("lan-match-wait");
    const isEnd = this.match && this.match.phase !== "playing";
    if (!isEnd) {
      show(waitEl, false);
      show(actions, true);
      return;
    }
    const remaining = Math.max(0, (this.resultRevealAt - performance.now()) / 1000);
    if (remaining > 0.05) {
      show(actions, false);
      show(waitEl, true);
      waitEl.textContent = `对局结果展示中 · ${Math.ceil(remaining)}s 后显示操作选项...`;
    } else {
      show(waitEl, false);
      const wasHidden = actions.classList.contains("hidden");
      show(actions, true);
      if (wasHidden) {
        actions.classList.remove("actions-reveal");
        void actions.offsetWidth;
        actions.classList.add("actions-reveal");
      }
    }
  }

  renderRespawnOverlay() {
    const me = this.view.me;
    const deadInMatch = Boolean(this.match && this.match.phase === "playing" && me && me.hp <= 0);
    show(this.respawnScreen, deadInMatch);
    if (!deadInMatch) return;

    const total = Math.max(0.5, me.respawnTotal || (this.match.mode === "pvp" ? 3 : 6));
    const left = Math.max(0, me.respawn || 0);
    const killerMember = me.lastKiller ? this.room?.members?.find((m) => m.id === me.lastKiller) : null;
    element("respawn-tag").textContent = this.match.mode === "pvp" ? "PVP · K.O.!" : "CO-OP · DOWN!";
    element("respawn-reason").textContent = killerMember
      ? `被 ${killerMember.name} 击倒！复活后保留阵亡前武器`
      : this.match.mode === "pvp"
      ? "你已阵亡！复活后保留阵亡前武器"
      : "已倒下！等待复活，复活后保留阵亡前武器";
    element("respawn-timer").textContent = `${left.toFixed(1)}s`;
    element("respawn-fill").style.width = `${Math.min(100, Math.max(0, (1 - left / total) * 100))}%`;
  }

  clearMatch() {
    this.clearResultDelay();
    element("game-shell")?.classList.remove("defeat-monochrome");
    if (this.match) {
      this.clearControls();
      this.view.clear();
      this.match = null;
      this.callbacks.unlockPointer();
      this.callbacks.onMatch(false);
    }
    show(this.respawnScreen, false);
    show(this.matchScreen, false);
    show(this.board, false);
  }

  renderMatch() {
    const phase = this.match?.phase;
    const isPlaying = phase === "playing";
    show(this.matchScreen, Boolean(phase) && (!isPlaying || !this.focused));
    if (!phase) return;
    show(element("lan-focus"), isPlaying);
    show(element("lan-next"), phase === "cleared" && this.isHost);
    show(element("lan-retry"), phase === "failed" && this.isHost);
    show(element("lan-return"), !isPlaying && this.isHost);
    show(element("lan-home"), true);

    this.matchScreen.classList.remove("result-victory", "result-defeat");
    const banner = element("lan-match-banner");
    const shell = element("game-shell");
    if (!isPlaying) {
      const won =
        phase === "cleared" ||
        (phase === "finished" && (this.match.mode === "coop" || this.match.winner === this.id));
      shell?.classList.toggle("defeat-monochrome", !won);
      banner.className = `result-status-banner ${won ? "victory" : "defeat"}`;
      if (phase === "cleared") banner.textContent = `★ ${this.engine.level.issue} 合作通关 · CLEARED! ★`;
      else if (phase === "failed") banner.textContent = "✖ 挑战失败 · TEAM WIPED ✖";
      else if (this.match.mode === "pvp") banner.textContent = won ? "★ 对局胜利 · VICTORY! ★" : "✖ 对局失败 · DEFEAT ✖";
      else banner.textContent = "★ 全队通关 · VICTORY! ★";
      void this.matchScreen.offsetWidth;
      this.matchScreen.classList.add(won ? "result-victory" : "result-defeat");
    } else {
      shell?.classList.remove("defeat-monochrome");
      show(banner, false);
    }
    const title = element("lan-match-title");
    const desc = element("lan-match-desc");
    const tag = element("lan-match-tag");
    show(tag, !isPlaying);
    if (isPlaying) {
      title.textContent = modeName(this.match.mode);
      desc.textContent = this.match.mode === "coop"
        ? this.engine.level.issue + " · " + this.engine.level.name + "。点击进入战斗锁定鼠标。"
        : "率先击倒对手 " + KILL_LIMIT + " 次获胜。点击进入战斗锁定鼠标。";
    } else if (phase === "cleared") {
      tag.textContent = "STAGE CLEARED!";
      title.textContent = this.engine.level.issue + " 已通关";
      desc.textContent = this.isHost ? "全队准备好后，进入下一期。" : "等待房主进入下一期。";
    } else if (phase === "failed") {
      tag.textContent = "TEAM WIPED";
      title.textContent = "全队倒下";
      desc.textContent = this.isHost ? "可以带全队重开本关。" : "等待房主重开本关。";
    } else if (this.match.mode === "pvp") {
      tag.textContent = "PVP MATCH RESULT";
      const winner = this.room.members.find((member) => member.id === this.match.winner);
      title.textContent = winner ? winner.name + " 获胜！" : "对局结束";
      const summary = [...this.match.players]
        .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths)
        .map((p) => {
          const m = this.room.members.find((e) => e.id === p.id);
          return m ? `${m.name}: ${p.kills} 击杀 / ${p.deaths} 阵亡` : "";
        })
        .filter(Boolean)
        .join("  ·  ");
      desc.textContent = summary || (this.isHost ? "返回房间后可以再打一局。" : "等待房主返回房间。");
    } else {
      tag.textContent = "VICTORY!";
      title.textContent = "全队通关！";
      desc.textContent = "已完成全部五期 · 团队得分 " + this.match.score;
    }
    this.updateMatchActionDelay();
  }

  renderScoreboard() {
    const { mode, players, phase } = this.match;
    const seconds = Math.ceil(this.view.me.respawn);
    const rows = [modeName(mode)];
    if (seconds && phase === "playing") rows.push(seconds + " 秒后复活");
    else if (this.view.me.invulnerable && phase === "playing") rows.push("复活保护中");
    for (const player of [...players].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths)) {
      const member = this.room.members.find((entry) => entry.id === player.id);
      if (member) rows.push(member.name + (member.id === this.id ? "（你）" : "") + " · "
        + (mode === "pvp" ? player.kills + "/" + KILL_LIMIT : Math.ceil(player.hp) + " HP"));
    }
    const text = rows.join("\n");
    if (this.board.textContent !== text) this.board.textContent = text;
    show(this.board, true);
  }

  pointerChanged() {
    if (!this.match) return;
    if (!this.focused) this.releaseInput();
    this.renderMatch();
  }

  pointerError() {
    if (this.match?.phase === "playing") {
      element("lan-match-desc").textContent = "无法锁定鼠标，请点击「进入战斗」重试。";
    }
  }

  clearControls() {
    this.engine.keys = {};
    this.engine.mouseDown = false;
    this.engine.setAds(false);
    this.pending.length = 0;
  }

  releaseInput() {
    this.clearControls();
    this.sendInput();
  }

  sendInput() {
    if (this.match?.phase !== "playing" || !this.view.me || this.view.me.hp <= 0) return;
    const player = this.engine.player;
    const keys = INPUT_KEYS.reduce((bits, key, index) => bits | (this.engine.keys[key] ? 1 << index : 0), 0);
    this.send({ type: "input", round: this.match.round, life: this.view.me.life, keys, yaw: player.yaw, pitch: player.pitch,
      weapon: this.weapon, ads: this.engine.weapons.isAds, fire: this.engine.mouseDown, actions: this.pending.splice(0) });
    this.lastInput = performance.now();
  }

  action(name) {
    this.pending.push(name);
    this.sendInput();
  }

  update(dt) {
    if (!this.match) return;
    if (this.canControl) {
      if (this.engine.keys.ArrowLeft) this.engine.player.yaw += 2.3 * dt;
      if (this.engine.keys.ArrowRight) this.engine.player.yaw -= 2.3 * dt;
      if (performance.now() - this.lastInput >= 32) this.sendInput();
    }
    this.view.update(dt);
  }
}

import { useEffect, useRef, useState } from "react";
import RFB from "@novnc/novnc";
import { t } from "@/lib/i18n";

/** Served through the app's normal route/build. Only desktop pixels and
 * input cross the VM boundary; the VM never supplies this page's code. */
export function LocalVmViewer() {
  const screen = useRef<HTMLDivElement>(null);
  const rfb = useRef<RFB | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState(t("localVmViewer.connecting"));
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState("");
  const target = new URLSearchParams(location.hash.slice(1)).get("target");

  useEffect(() => {
    const controller = new AbortController();
    let client: RFB | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const oldTitle = document.title;
    document.title = t("localVmViewer.title");
    setConnected(false);
    setStatus(t("localVmViewer.connecting"));
    const connect = async () => {
      try {
        if (!target || !/^(shared|bot-[a-f0-9]{64}|pool-\d+)$/.test(target)) throw new Error(t("localVmViewer.invalid"));
        const path = `/api/local-computer/viewer/${target}`;
        const response = await fetch(path, {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
          credentials: "same-origin", cache: "no-store",
        });
        const config = await response.json();
        if (controller.signal.aborted) return;
        if (!response.ok) throw new Error(config.error || t("localVmViewer.disconnected"));
        const websocket = new URL(`${path}/websockify`, location.href);
        websocket.protocol = location.protocol === "https:" ? "wss:" : "ws:";
        client = new RFB(screen.current!, websocket.href, {
          credentials: { password: config.password ?? "", username: "", target: "" },
        });
        rfb.current = client;
        client.scaleViewport = true;
        deadline = setTimeout(() => {
          client?.disconnect();
          setStatus(t("localVmViewer.disconnected"));
        }, 15_000);
        client.addEventListener("connect", () => {
          if (controller.signal.aborted) return;
          clearTimeout(deadline);
          setConnected(true);
          setStatus(t("localVmViewer.connected"));
        });
        client.addEventListener("disconnect", () => {
          if (controller.signal.aborted) return;
          clearTimeout(deadline);
          setConnected(false);
          setStatus(t("localVmViewer.disconnected"));
        });
      } catch (error) {
        if (!controller.signal.aborted) setStatus(error instanceof Error ? error.message : t("localVmViewer.disconnected"));
      }
    };
    void connect();
    const disconnect = () => client?.disconnect();
    const restore = (event: PageTransitionEvent) => { if (event.persisted) setAttempt(value => value + 1); };
    window.addEventListener("pagehide", disconnect);
    window.addEventListener("pageshow", restore);
    return () => {
      controller.abort();
      clearTimeout(deadline);
      client?.disconnect();
      if (rfb.current === client) rfb.current = null;
      window.removeEventListener("pagehide", disconnect);
      window.removeEventListener("pageshow", restore);
      document.title = oldTitle;
    };
  }, [target, attempt]);

  const button = "min-h-11 rounded border border-zinc-500 bg-zinc-800 px-3 py-2 disabled:opacity-50";
  return (
    <div className="flex h-dvh flex-col bg-zinc-900 text-sm text-white">
      <header className="flex flex-wrap items-center gap-2 p-2">
        <span id="status" role="status" className="min-w-36 flex-1">{status}</span>
        <button id="retry" className={button} onClick={() => setAttempt(value => value + 1)}>{t("localVmViewer.reconnect")}</button>
        <button id="keyboard" className={button} disabled={!connected} aria-expanded={typing} onClick={() => setTyping(value => !value)}>{t("localVmViewer.keyboard")}</button>
        <button id="ctrl-alt-del" className={button} disabled={!connected} onClick={() => rfb.current?.sendCtrlAltDel()}>Ctrl–Alt–Del</button>
        <a className="text-blue-200 underline" href="/licenses/novnc/NOTICE.txt" target="_blank" rel="noreferrer">noVNC</a>
      </header>
      {typing && <form className="flex gap-2 p-2" onSubmit={event => {
        event.preventDefault();
        if (!rfb.current || !connected) return;
        // A text field gives phones a keyboard without reading their
        // clipboard automatically. Send characters as standard VNC keysyms.
        for (const char of text) {
          const code = char.codePointAt(0)!;
          rfb.current.sendKey(code === 10 ? 0xff0d : code === 9 ? 0xff09 : code <= 255 ? code : 0x01000000 | code, null);
        }
        setText("");
      }}>
        <textarea id="text" aria-label={t("localVmViewer.text")} className="min-w-0 flex-1 rounded border border-zinc-500 bg-zinc-800 p-2 text-base" rows={2} maxLength={4096} autoComplete="off" autoCapitalize="off" spellCheck={false} value={text} onChange={event => setText(event.target.value)} />
        <button id="send" type="submit" className={button} disabled={!connected}>{t("localVmViewer.send")}</button>
      </form>}
      <div id="screen" ref={screen} aria-label={t("localVmViewer.title")} className="min-h-0 flex-1 overflow-hidden" />
    </div>
  );
}

import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import type { LayoutStorage } from "react-resizable-panels";
import { Columns2, Maximize2, MessageSquare, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Group, Panel, Separator, useDefaultLayout, usePanelRef } from "react-resizable-panels";

// Chat on the left, preview on the right: a draggable divider and a chat panel
// that collapses out of the way.
//
// A phone keeps the same arrangement — chat left, preview right — rather than
// stacking, with the chat taking the larger share because prose and a text
// input suffer more from being narrow than a rendered app does.
//
// Two columns on a 390px screen is genuinely tight, so the split is a starting
// point rather than the only view: a three-way control gives either pane the
// whole width with one tap. Neither pane is unmounted when hidden, so the
// conversation, its scroll position and anything half-typed survive switching
// back and forth.
//
// react-resizable-panels was already a dependency here and imported by
// nothing. Persistence uses the library's own useDefaultLayout rather than a
// hand-rolled localStorage read: it restores the saved split without a layout
// shift on load, which a manual read-then-remount does not.
//
// Two things about this library that are easy to get wrong, both learned the
// hard way:
//   - A NUMBER size means PIXELS, so defaultSize={32} is a 32-pixel panel.
//     Sizes need an explicit unit: the size parser does read a unitless string
//     as a percentage, but before the client has measured anything the library
//     writes defaultSize straight into flex-basis, and "32" is invalid CSS —
//     the browser drops it and the panel collapses to its content width. That
//     is the server render and the first client paint, so use "32%".
//   - Panels must be direct DOM children of their Group.
//
// The `key` below is load-bearing. The server has no storage, so it renders the
// default split; the client reads the saved one synchronously. React hydration
// does not patch mismatched style attributes, so the server's flex-basis would
// stick and the saved split would be silently ignored. Changing the key after
// hydration gives the Group one real client mount, which applies it. Nothing is
// generated yet at that point, so remounting the preview costs nothing.
//
// It runs before paint, so a returning visitor never sees the default split
// painted and then jump to their saved one. With a plain useEffect the remount
// lands after the first paint and that jump is visible.

const GROUP_ID = "devstation-app-builder";
/** A phone remembers its own split. A width chosen on a 1400px screen means
 *  nothing on a 390px one. */
const MOBILE_GROUP_ID = "devstation-app-builder-mobile";

// The hook falls back to localStorage when `storage` is undefined, which throws
// during SSR. Hand it an inert store on the server instead of nothing.
const NO_STORAGE: LayoutStorage = { getItem: () => null, setItem: () => {} };

// useLayoutEffect warns when it runs on the server, where it does nothing
// useful anyway; useEffect is the right no-op there.
const useBeforePaint = typeof window === "undefined" ? useEffect : useLayoutEffect;
const CHAT = "chat";
const PREVIEW = "preview";

/** Below this the split stacks. 768px is the same breakpoint Tailwind's `md`
 *  uses, which is where the app's sidebar already switches behaviour. */
const MOBILE_QUERY = "(max-width: 767px)";
/** Chat's share of a phone screen in the split. Slightly over half: the chat
 *  holds prose and an input, which suffer more from being narrow than a
 *  rendered app does. */
const MOBILE_CHAT_SHARE = "55%";

interface Props {
  chat: ReactNode;
  preview: ReactNode;
}

export function SplitLayout({ chat, preview }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  // The server cannot know the viewport, so it renders the desktop split and
  // the client corrects it. Done before paint, so a phone never shows the
  // side-by-side layout even for a frame.
  const [mobile, setMobile] = useState(false);
  /** Mobile only: which pane has the screen. "split" shows both. */
  const [mobileFocus, setMobileFocus] = useState<"split" | "chat" | "preview">("split");
  // Collapsing through the library rather than unmounting: the panes stay
  // alive, so the preview iframe is not torn down and rebuilt every time you
  // switch, and the chat keeps its scroll position.
  const chatPanelRef = usePanelRef();
  const previewPanelRef = usePanelRef();

  const focusPane = (next: "split" | "chat" | "preview") => {
    setMobileFocus(next);
    const chatPanel = chatPanelRef.current;
    const previewPanel = previewPanelRef.current;
    // Expand the pane being shown BEFORE collapsing the other. Do it the other
    // way round and the call is refused: collapsing the second panel while the
    // first is still collapsed would leave the group with nothing visible, so
    // the library declines and the switch silently does nothing.
    if (next === "chat") {
      chatPanel?.expand();
      previewPanel?.collapse();
    } else if (next === "preview") {
      previewPanel?.expand();
      chatPanel?.collapse();
    } else {
      chatPanel?.expand();
      previewPanel?.expand();
    }
  };

  useBeforePaint(() => {
    setHydrated(true);
    const mq = window.matchMedia(MOBILE_QUERY);
    setMobile(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setMobile(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const mobileLayout = useDefaultLayout({
    id: MOBILE_GROUP_ID,
    panelIds: [CHAT, PREVIEW],
    storage: typeof localStorage === "undefined" ? NO_STORAGE : localStorage,
  });

  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: GROUP_ID,
    // Listed so a collapsed-then-expanded chat comes back at its saved width.
    panelIds: [CHAT, PREVIEW],
    storage: typeof localStorage === "undefined" ? NO_STORAGE : localStorage,
  });

  if (mobile) {
    // Side by side on a phone, as asked, with the same draggable divider the
    // desktop has — 390px split two ways is tight enough that being able to
    // shift the balance matters more here than it does on a large screen.
    //
    // The switcher above collapses a pane through the library instead of
    // unmounting it, so the preview iframe is never torn down and rebuilt and
    // the chat keeps its scroll position.
    const tab = (active: boolean) =>
      `flex flex-1 items-center justify-center gap-1.5 rounded py-1.5 font-mono text-[10px] transition ${
        active ? "bg-surface-2 text-foreground" : "text-meta"
      }`;

    return (
      <div className="flex h-[calc(100vh-3.5rem)] flex-col">
        {/* Its own bar, not floating over the panes: a floating control here
            sat directly on top of the composer. */}
        <div className="flex shrink-0 items-center gap-1 border-b border-border bg-surface px-1.5 py-1">
          <button onClick={() => focusPane("chat")} className={tab(mobileFocus === "chat")}>
            <MessageSquare className="h-3 w-3" /> Chat
          </button>
          <button onClick={() => focusPane("split")} className={tab(mobileFocus === "split")}>
            <Columns2 className="h-3 w-3" /> Split
          </button>
          <button onClick={() => focusPane("preview")} className={tab(mobileFocus === "preview")}>
            <Maximize2 className="h-3 w-3" /> Preview
          </button>
        </div>

        <Group
          key={hydrated ? "client" : "server"}
          orientation="horizontal"
          defaultLayout={mobileLayout.defaultLayout}
          onLayoutChanged={mobileLayout.onLayoutChanged}
          className="flex min-h-0 flex-1"
        >
          <Panel
            id={CHAT}
            panelRef={chatPanelRef}
            collapsible
            collapsedSize="0%"
            defaultSize={MOBILE_CHAT_SHARE}
            minSize="25%"
            // No maxSize: the preview's own minSize already stops a drag from
            // squeezing it out, and a maxSize here would cap how far the chat
            // can expand — which silently prevents the preview from ever
            // collapsing, since the chat cannot grow to take its place.
            className="flex min-w-0 flex-col"
          >
            {chat}
          </Panel>

          {/* Wider grab area than the desktop divider: a finger is not a
              cursor, and a one-pixel target is not a target. */}
          <Separator className="relative z-10 flex w-px cursor-col-resize items-center justify-center bg-border transition-colors after:absolute after:inset-y-0 after:left-1/2 after:w-6 after:-translate-x-1/2 active:bg-primary" />

          <Panel
            id={PREVIEW}
            panelRef={previewPanelRef}
            collapsible
            collapsedSize="0%"
            minSize="20%"
            className="flex min-w-0 flex-col"
          >
            {preview}
          </Panel>
        </Group>
      </div>
    );
  }

  return (
    <div className="relative flex h-[calc(100vh-3.5rem)] flex-col">
      <Group
        key={hydrated ? "client" : "server"}
        orientation="horizontal"
        defaultLayout={defaultLayout}
        onLayoutChanged={onLayoutChanged}
        className="flex h-full w-full"
      >
        {!collapsed && (
          <Panel
            id={CHAT}
            defaultSize="32%"
            minSize="20%"
            maxSize="60%"
            className="flex min-w-0 flex-col"
          >
            {chat}
          </Panel>
        )}

        {!collapsed && (
          // z-10 is load-bearing. The divider is one pixel wide and widens its
          // grab area with an ::after reaching into the panels either side. Any
          // positioned element inside a panel paints over that, and the drag
          // silently stops working — pointer events land on the panel instead,
          // with no error and nothing in the DOM to suggest why.
          <Separator className="relative z-10 flex w-px cursor-col-resize items-center justify-center bg-border transition-colors after:absolute after:inset-y-0 after:left-1/2 after:w-2 after:-translate-x-1/2 hover:bg-primary/60" />
        )}

        <Panel id={PREVIEW} minSize="30%" className="flex min-w-0 flex-col">
          {/* The toggle lives here, at the preview's bottom-left corner, rather
              than the window's. Anchored to the window it sat on top of the
              chat composer whenever the chat was open — visible in any
              screenshot, invisible in the code. */}
          <div className="relative flex h-full min-h-0 flex-col">
            {preview}
            <button
              onClick={() => setCollapsed((v) => !v)}
              title={collapsed ? "Show chat" : "Hide chat"}
              className="absolute bottom-3 left-3 z-20 rounded border border-border bg-surface p-1.5 text-meta shadow-sm transition hover:text-foreground"
            >
              {collapsed ? (
                <PanelLeftOpen className="h-3.5 w-3.5" />
              ) : (
                <PanelLeftClose className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
        </Panel>
      </Group>
    </div>
  );
}

import { useEffect } from "react";

function postAgent(path: string, body: Record<string, unknown>) {
  void fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => {
    // Local agent is dev-only; ignore when unavailable.
  });
}

function reportSnapshot() {
  const text = document.body?.innerText ?? "";
  postAgent("/__agent/browser-snapshot", {
    url: window.location.href,
    title: document.title,
    text,
  });
}

export function BrowserVerifier() {
  useEffect(() => {
    const originalError = console.error;
    const originalWarn = console.warn;

    console.error = (...args: unknown[]) => {
      postAgent("/__agent/browser-console", {
        level: "error",
        message: args.map(String).join(" "),
      });
      originalError(...args);
    };

    console.warn = (...args: unknown[]) => {
      postAgent("/__agent/browser-console", {
        level: "warn",
        message: args.map(String).join(" "),
      });
      originalWarn(...args);
    };

    reportSnapshot();
    const interval = window.setInterval(reportSnapshot, 1500);
    const observer = new MutationObserver(() => reportSnapshot());
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });

    return () => {
      window.clearInterval(interval);
      observer.disconnect();
      console.error = originalError;
      console.warn = originalWarn;
    };
  }, []);

  return null;
}

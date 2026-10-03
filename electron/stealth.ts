/**
 * Stealth — hides `navigator.webdriver` from websites so they don't flag Echo
 * as a bot. Uses CDP (Chrome DevTools Protocol) to inject the override into
 * every page context before any page script runs.
 *
 * This replaces the `--disable-blink-features=AutomationControlled` flag, which
 * triggers a persistent yellow "unsupported flag" infobar in Chromium v152+.
 */

import { log } from "./log.js";

/**
 * Apply anti-bot-detection stealth via CDP.
 *
 * Uses Target.setAutoAttach to intercept every new page target, then calls
 * Page.addScriptToEvaluateOnNewDocument on each one to redefine
 * `navigator.webdriver` as undefined before any page JS runs.
 *
 * Best-effort: a failure here should never block the browser launch.
 */
export async function applyStealth(cdpPort: number): Promise<void> {
	try {
		// 1. Get the browser WebSocket URL
		const versionResp = await fetch(
			`http://127.0.0.1:${cdpPort}/json/version`,
			{ signal: AbortSignal.timeout(5000) },
		);
		if (!versionResp.ok) {
			throw new Error(`/json/version returned ${versionResp.status}`);
		}
		const versionInfo = (await versionResp.json()) as {
			webSocketDebuggerUrl?: string;
		};
		if (!versionInfo.webSocketDebuggerUrl) {
			throw new Error("No webSocketDebuggerUrl in /json/version response");
		}

		// 2. Connect to the browser WebSocket
		const ws = new WebSocket(versionInfo.webSocketDebuggerUrl);
		await new Promise<void>((resolve, reject) => {
			ws.onopen = () => resolve();
			ws.onerror = (e) => reject(new Error(String(e)));
			setTimeout(() => reject(new Error("WebSocket connect timeout")), 5000);
		});

		// 3. Build the stealth injection script
		const stealthScript =
			"Object.defineProperty(navigator,'webdriver',{get:()=>undefined});";

		// 4. Send Target.setAutoAttach to intercept every new target
		const send = (method: string, params: Record<string, unknown>) =>
			ws.send(JSON.stringify({ id: 1, method, params }));

		const waitForResult = (): Promise<void> =>
			new Promise((resolve, reject) => {
				const timeout = setTimeout(
					() => reject(new Error("setAutoAttach timeout")),
					5000,
				);
				ws.onmessage = (event) => {
					const msg = JSON.parse(event.data as string);
					if (msg.id === 1 && !msg.error) {
						clearTimeout(timeout);

						// On each attached target, inject the stealth script
						ws.onmessage = (event2) => {
							const msg2 = JSON.parse(event2.data as string);
							if (msg2.method === "Target.attachedToTarget" && msg2.params) {
								const sessionId = msg2.params.sessionId as string;
								ws.send(
									JSON.stringify({
										id: 2,
										sessionId,
										method: "Page.addScriptToEvaluateOnNewDocument",
										params: { source: stealthScript },
									}),
								);
							}
						};

						resolve();
					}
				};
			});

		send("Target.setAutoAttach", {
			autoAttach: true,
			waitForDebuggerOnStart: false,
			flatten: true,
		});

		await waitForResult();
		ws.close();
		log("stealth", "info", "CDP stealth applied — navigator.webdriver hidden");
	} catch (err) {
		log("stealth", "warn", "stealth injector failed (best-effort)", {
			err: String(err),
		});
		// Never throw — stealth is optional; the browser still works fine without it.
	}
}

/**
 * UpdateSettings — app + Chromium engine update status.
 *
 * Phase 1: App card is live (check / download / restart-to-update).
 *          Chromium card is a "Coming soon" placeholder.
 * Phase 3: Chromium card goes live.
 */

import { useEffect, useState } from "react";
import {
	Card,
	Text,
	Group,
	Badge,
	Button,
	Progress,
	Code,
	Stack,
	Divider,
} from "@mantine/core";
import {
	IconRefresh,
	IconRestore,
	IconServer,
	IconAppWindow,
} from "@tabler/icons-react";
import api from "../../api";

interface AppInfo {
	currentVersion: string;
	latestVersion: string | null;
	state: string;
	progress: number;
	releaseNotes: string | null;
	error: string | null;
	lastCheckedAt: string | null;
}

/**
 * Release notes arrive as HTML: electron-updater reads GitHub's release .atom
 * feed, whose <content> is rendered HTML. Printing it raw showed users `<h3>`
 * and `<p>` tags, so flatten it to readable plain text.
 *
 * Deliberately NOT dangerouslySetInnerHTML — these notes are remote content and
 * have no business executing inside the app.
 */
function readableNotes(raw: string): string {
	if (!/[<&]/.test(raw)) return raw;
	try {
		const doc = new DOMParser().parseFromString(raw, "text/html");
		doc.querySelectorAll("br").forEach((el) => el.replaceWith("\n"));
		doc.querySelectorAll("li").forEach((el) => el.prepend("\u2022 "));
		doc
			.querySelectorAll("p, li, h1, h2, h3, h4, h5, h6, div, tr")
			.forEach((el) => el.append("\n"));
		return (doc.body.textContent ?? "")
			.replace(/[ \t]+\n/g, "\n")
			.replace(/\n{3,}/g, "\n\n")
			.trim();
	} catch {
		return raw;
	}
}

export default function UpdateSettings() {
	const [app, setApp] = useState<AppInfo | null>(null);
	const [chromium, setChromium] = useState<AppInfo | null>(null);
	const [checkingApp, setCheckingApp] = useState(false);
	const [checkingEngine, setCheckingEngine] = useState(false);
	const [installing, setInstalling] = useState(false);

	useEffect(() => {
		fetchStatus();
		const interval = setInterval(fetchStatus, 2000);
		return () => clearInterval(interval);
	}, []);

	async function fetchStatus() {
		try {
			const data = await api.updates.getStatus();
			setApp(data.app as AppInfo);
			setChromium((data.chromium as AppInfo) ?? null);
		} catch {
			/* server not up yet */
		}
	}

	async function handleCheckApp() {
		setCheckingApp(true);
		try {
			await api.updates.checkApp();
		} catch {
			/* error shown in status */
		}
		setTimeout(() => setCheckingApp(false), 2000);
	}

	async function handleCheckEngine() {
		setCheckingEngine(true);
		try {
			await api.updates.checkChromium();
		} catch {
			/* error shown in status */
		}
		setTimeout(() => setCheckingEngine(false), 2000);
	}

	async function handleInstallApp() {
		setInstalling(true);
		try {
			await api.updates.installApp();
		} catch {
			/* error shown in status */
		}
		setTimeout(() => setInstalling(false), 2000);
	}

	async function handleApplyEngine() {
		setInstalling(true);
		try {
			await api.updates.applyChromium();
		} catch {
			/* error shown in status */
		}
		setTimeout(() => setInstalling(false), 2000);
	}

	// ── Status helpers ──────────────────────────────────────

	function statusPill(label: string, color: string): React.ReactNode {
		return (
			<Badge color={color} variant="light" size="sm">
				{label}
			</Badge>
		);
	}

	function statePill(info: AppInfo | null): React.ReactNode {
		if (!info) return statusPill("Connecting…", "gray");
		switch (info.state) {
			case "checking":
				return statusPill("Checking…", "blue");
			case "up-to-date":
				return statusPill("Up to date", "green");
			case "available":
				return statusPill(`v${info.latestVersion} available`, "yellow");
			case "downloading":
				return statusPill(`Downloading ${info.progress}%`, "blue");
			case "downloaded":
				return statusPill("Ready to apply", "teal");
			case "error":
				return statusPill("Error", "red");
			default:
				return statusPill("Idle", "gray");
		}
	}

	function versionLabel(info: AppInfo | null, fallback: string): string {
		return info ? `v${info.currentVersion}` : fallback;
	}

	/** One plain sentence saying what is actually happening right now. */
	function stateText(info: AppInfo | null, kind: "app" | "engine"): string {
		if (!info) return "Connecting to the update service…";
		switch (info.state) {
			case "checking":
				return "Checking for updates…";
			case "up-to-date":
				return `Up to date (${versionLabel(info, "?")}).`;
			case "available":
				return `Version ${info.latestVersion} found — downloading in the background.`;
			case "downloading":
				return `Downloading ${info.latestVersion ?? "update"} — ${info.progress}%`;
			case "downloaded":
				return kind === "app"
					? `${info.latestVersion} is downloaded and ready to install.`
					: `${info.latestVersion} is downloaded and ready to apply.`;
			case "error":
				return "The last update check failed.";
			default:
				return info.latestVersion
					? `Newest version seen: ${info.latestVersion}.`
					: "No update check has run yet.";
		}
	}

	// ── Render ──────────────────────────────────────────────

	return (
		<Stack gap="lg">
			{/* ── App updates ── */}
			<Card withBorder padding="lg" radius="md">
				<Group mb="sm" justify="space-between">
					<Group gap="xs">
						<IconAppWindow size={20} />
						<Text fw={600}>Echo</Text>
						<Text size="sm" c="dimmed">
							installed {versionLabel(app, "…")}
						</Text>
					</Group>
					{statePill(app)}
				</Group>

				<Text size="sm" c="dimmed" mb="sm">
					{stateText(app, "app")}
				</Text>

				{app?.state === "downloading" && (
					<Progress value={app.progress} size="sm" mb="sm" />
				)}

				{app?.releaseNotes && (
					<Code block mb="sm" style={{ maxHeight: 120, overflow: "auto" }}>
						{readableNotes(app.releaseNotes)}
					</Code>
				)}

				{app?.error && (
					<Text size="sm" c="red" mb="sm">
						{app.error}
					</Text>
				)}

				{app?.lastCheckedAt && (
					<Text size="xs" c="dimmed" mb="sm">
						Last checked: {new Date(app.lastCheckedAt).toLocaleString()}
					</Text>
				)}

				<Group>
					<Button
						size="sm"
						variant="light"
						leftSection={<IconRefresh size={16} />}
						loading={checkingApp}
						onClick={handleCheckApp}
					>
						Check for updates
					</Button>
					{app?.state === "downloaded" && (
						<Button
							size="sm"
							variant="filled"
							color="teal"
							leftSection={<IconRestore size={16} />}
							loading={installing}
							onClick={handleInstallApp}
						>
							Restart to update
						</Button>
					)}
				</Group>
			</Card>

			<Divider />

			{/* ── Engine updates ── */}
			<Card withBorder padding="lg" radius="md">
				<Group mb="sm" justify="space-between">
					<Group gap="xs">
						<IconServer size={20} />
						<Text fw={600}>Chromium Engine</Text>
						<Text size="sm" c="dimmed">
							installed {versionLabel(chromium, "…")}
						</Text>
					</Group>
					{chromium ? (
						statePill(chromium)
					) : (
						<Badge color="gray" variant="light" size="sm">
							Connecting…
						</Badge>
					)}
				</Group>

				<Text size="sm" c="dimmed" mb="sm">
					{stateText(chromium, "engine")}
				</Text>

				{chromium?.state === "downloading" && (
					<Progress value={chromium.progress} size="sm" mb="sm" />
				)}

				{chromium?.releaseNotes && (
					<Code block mb="sm" style={{ maxHeight: 120, overflow: "auto" }}>
						{readableNotes(chromium.releaseNotes)}
					</Code>
				)}

				{chromium?.error && (
					<Text size="sm" c="red" mb="sm">
						{chromium.error}
					</Text>
				)}

				<Group>
					<Button
						size="sm"
						variant="light"
						leftSection={<IconRefresh size={16} />}
						loading={checkingEngine}
						onClick={handleCheckEngine}
					>
						Check for engine
					</Button>
					{chromium?.state === "downloaded" && (
						<Button
							size="sm"
							variant="filled"
							color="teal"
							leftSection={<IconRestore size={16} />}
							loading={installing}
							onClick={handleApplyEngine}
						>
							Apply engine update
						</Button>
					)}
				</Group>
			</Card>
		</Stack>
	);
}

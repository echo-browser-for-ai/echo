import { useState, useEffect } from "react";
import {
	Paper,
	Stack,
	Group,
	SegmentedControl,
	Switch,
	Text,
	Title,
	useMantineColorScheme,
} from "@mantine/core";
import type { Settings } from "../../types/api";

const DEFAULT_SETTINGS: Settings = {
	openAtLogin: false,
	theme: "dark",
};

export default function GeneralSettings() {
	const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
	const { setColorScheme } = useMantineColorScheme();

	useEffect(() => {
		window.api.settings
			.get()
			.then(setSettings)
			.catch(() => {});

		// Listen for theme changes from other sources (sidebar toggle)
		const cleanup = window.api.settings.onThemeChanged?.((theme: string) => {
			setSettings((prev) => ({ ...prev, theme: theme as "dark" | "light" }));
		});
		return () => {
			cleanup?.();
		};
	}, []);

	const handleToggle = (
		key: "openAtLogin" | "theme",
		value: boolean | string,
	) => {
		setSettings((prev) => ({ ...prev, [key]: value }) as Settings);
		window.api.settings.set(key, value).catch(() => {});
		if (key === "theme") {
			setColorScheme(value as "dark" | "light");
			document.documentElement.setAttribute("data-theme", value as string);
		}
	};

	return (
		<>
			<Title order={3} mb="sm">
				General
			</Title>
			<Paper withBorder p="md" radius={8}>
				<Stack gap="lg">
					<Group justify="space-between" wrap="nowrap">
						<div>
							<Text size="sm" fw={500}>
								Start with Windows
							</Text>
							<Text size="xs" c="dimmed">
								Echo auto-starts when you log in
							</Text>
						</div>
						<Switch
							size="md"
							color="cyan"
							checked={settings.openAtLogin}
							onChange={(e) =>
								handleToggle("openAtLogin", e.currentTarget.checked)
							}
						/>
					</Group>
					<Group justify="space-between" wrap="nowrap">
						<div>
							<Text size="sm" fw={500}>
								Appearance
							</Text>
							<Text size="xs" c="dimmed">
								Switch between dark and light theme
							</Text>
						</div>
						<SegmentedControl
							value={settings.theme || "dark"}
							onChange={(value) => handleToggle("theme", value)}
							data={[
								{ value: "dark", label: "Dark" },
								{ value: "light", label: "Light" },
							]}
							size="xs"
							radius={6}
						/>
					</Group>
				</Stack>
			</Paper>
		</>
	);
}

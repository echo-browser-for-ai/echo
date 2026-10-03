/**
 * Echo Settings Panel — clean sidebar layout.
 * Replaces the old BrowserChrome shell (address bar + tabs + browser view).
 */

import { useState } from "react";
import {
	Box,
	Text,
	Stack,
	NavLink,
	Group,
	ActionIcon,
	Badge,
	Divider,
} from "@mantine/core";
import {
	IconSettings,
	IconTool,
	IconInfoCircle,
	IconSun,
	IconMoon,
	IconPlugConnected,
	IconRefresh,
} from "@tabler/icons-react";

import GeneralSettings from "./settings/GeneralSettings";
import AdvancedSettings from "./settings/AdvancedSettings";
import UpdateSettings from "./settings/UpdateSettings";
import AboutSettings from "./settings/AboutSettings";

type Page = "general" | "advanced" | "updates" | "about";

interface Props {
	theme: "dark" | "light";
	onToggleTheme: () => void;
}

export default function SettingsPanel({ theme, onToggleTheme }: Props) {
	const [page, setPage] = useState<Page>("general");

	const navItems: { page: Page; label: string; icon: React.ReactNode }[] = [
		{ page: "general", label: "General", icon: <IconSettings size={18} /> },
		{ page: "advanced", label: "Advanced", icon: <IconTool size={18} /> },
		{ page: "updates", label: "Updates", icon: <IconRefresh size={18} /> },
		{ page: "about", label: "About", icon: <IconInfoCircle size={18} /> },
	];

	const renderPage = () => {
		switch (page) {
			case "general":
				return <GeneralSettings />;
			case "advanced":
				return <AdvancedSettings />;
			case "updates":
				return <UpdateSettings />;
			case "about":
				return <AboutSettings />;
		}
	};

	return (
		<Box style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
			{/* ── Sidebar ── */}
			<Box
				style={{
					width: 220,
					minWidth: 220,
					borderRight: "1px solid var(--mantine-color-default-border)",
					display: "flex",
					flexDirection: "column",
					background: "var(--mantine-color-body)",
				}}
			>
				{/* Brand header */}
				<Box p="md" pb="xs">
					<Group gap="xs">
						<Text
							fw={700}
							size="lg"
							style={{ color: "var(--mantine-color-blue-4)" }}
						>
							Echo
						</Text>
					</Group>
					<Text size="xs" c="dimmed" mt={2}>
						Browser for AI
					</Text>
				</Box>

				<Divider mb="xs" />

				{/* Navigation */}
				<Stack gap={0} px="xs" style={{ flex: 1 }}>
					{navItems.map((item) => (
						<NavLink
							key={item.page}
							label={item.label}
							leftSection={item.icon}
							active={page === item.page}
							onClick={() => setPage(item.page)}
							variant="light"
							style={{ borderRadius: 6 }}
						/>
					))}
				</Stack>

				<Divider mb="xs" />

				{/* Bottom actions */}
				<Box p="xs">
					<Group justify="space-between">
						<ActionIcon
							variant="subtle"
							color="gray"
							size="lg"
							onClick={onToggleTheme}
							title={theme === "dark" ? "Light mode" : "Dark mode"}
						>
							{theme === "dark" ? (
								<IconSun size={18} />
							) : (
								<IconMoon size={18} />
							)}
						</ActionIcon>
						<Badge
							size="xs"
							variant="dot"
							color="green"
							leftSection={<IconPlugConnected size={10} />}
						>
							Connected
						</Badge>
					</Group>
				</Box>
			</Box>

			{/* ── Content area ── */}
			<Box
				style={{
					flex: 1,
					overflow: "auto",
					background: "var(--mantine-color-body)",
				}}
				p="xl"
			>
				{renderPage()}
			</Box>
		</Box>
	);
}

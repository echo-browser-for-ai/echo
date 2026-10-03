import { useEffect, useState } from "react";
import { Paper, Stack, Text, Title, Group, Button } from "@mantine/core";
import { IconBrandGithub } from "@tabler/icons-react";
import api from "../../api";

export default function AboutSettings() {
	const [version, setVersion] = useState("…");

	useEffect(() => {
		api.updates
			.getStatus()
			.then((data: any) => {
				if (data?.app?.currentVersion) setVersion(data.app.currentVersion);
			})
			.catch(() => {});
	}, []);

	const handleOpenGitHub = () => {
		window.api.shell.open("https://github.com/echo-browser-for-ai/echo");
	};

	return (
		<>
			<Title order={3} mb="sm">
				About
			</Title>
			<Paper withBorder p="md" radius={8}>
				<Stack gap="lg">
					<Text size="sm" fw={500}>
						Echo v{version}
					</Text>
					<Text size="xs" c="dimmed">
						Electron 43.1 · React 19 · Mantine 9
					</Text>

					<Group mt="md">
						<Button
							variant="outline"
							leftSection={<IconBrandGithub size={14} />}
							onClick={handleOpenGitHub}
						>
							Open GitHub repo
						</Button>
					</Group>

					<Text size="xs" c="dimmed" mt="md">
						Made with care by Uzair
					</Text>
				</Stack>
			</Paper>
		</>
	);
}

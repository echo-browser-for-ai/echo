import { useState } from "react";
import { Paper, Stack, Group, Text, Title, Button, Modal } from "@mantine/core";

export default function AdvancedSettings() {
	const [resetModalOpen, setResetModalOpen] = useState(false);
	const [clearModalOpen, setClearModalOpen] = useState(false);
	const [clearing, setClearing] = useState(false);

	const handleReset = async () => {
		await window.api.settings.reset();
		setResetModalOpen(false);
	};

	const handleClearStorage = async () => {
		setClearing(true);
		try {
			// Server kills Chromium, wipes the profile, and relaunches.
			// The settings tab reloads automatically when Chromium reopens it.
			await (window as any).api.browser.resetData();
		} catch {
			setClearing(false);
		}
	};

	return (
		<>
			<Title order={3} mb="sm">
				Advanced
			</Title>
			<Paper withBorder p="md" radius={8}>
				<Stack gap="lg">
					<Group mt="md">
						<Button
							variant="outline"
							color="red"
							onClick={() => setClearModalOpen(true)}
						>
							Clear browsing data
						</Button>
						<Button
							variant="outline"
							color="orange"
							onClick={() => setResetModalOpen(true)}
						>
							Reset all settings
						</Button>
					</Group>
				</Stack>
			</Paper>

			<Modal
				opened={clearModalOpen}
				onClose={() => setClearModalOpen(false)}
				title="Clear browsing data"
				size="sm"
			>
				<Text size="sm" mb="md">
					Removes all history, cookies, cache, and shortcuts. The browser will
					restart. This cannot be undone.
				</Text>
				<Group justify="flex-end">
					<Button
						variant="subtle"
						onClick={() => setClearModalOpen(false)}
						disabled={clearing}
					>
						Cancel
					</Button>
					<Button color="red" onClick={handleClearStorage} loading={clearing}>
						{clearing ? "Clearing…" : "Clear everything"}
					</Button>
				</Group>
			</Modal>

			<Modal
				opened={resetModalOpen}
				onClose={() => setResetModalOpen(false)}
				title="Reset all settings"
				size="sm"
			>
				<Text size="sm" mb="md">
					This will reset every setting to its default value. This cannot be
					undone.
				</Text>
				<Group justify="flex-end">
					<Button variant="subtle" onClick={() => setResetModalOpen(false)}>
						Cancel
					</Button>
					<Button color="red" onClick={handleReset}>
						Reset everything
					</Button>
				</Group>
			</Modal>
		</>
	);
}

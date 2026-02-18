// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
	integrations: [
		starlight({
			title: 'Tars',
			logo: {
				src: './src/assets/tars-cartoon-logo.png',
				replacesTitle: true,
			},
			social: [
				{ icon: 'github', label: 'GitHub', href: 'https://github.com/agustinsacco/tars' },
				{ icon: 'discord', label: 'Discord', href: 'https://discord.gg/your-invite-link' }
			],
			defaultLocale: 'en',
			sidebar: [
				{
					label: 'The Neural Core',
					items: [
						{ label: 'Introduction', slug: 'index' },
						{ label: 'Setup (The Boot Sequence)', slug: 'guides/setup' },
					],
				},
				{
					label: 'Functional Anatomy',
					items: [
						{ label: 'Frontal Lobe (Supervisor)', slug: 'anatomy/supervisor' },
						{ label: 'Autonomic Nervous System (Heartbeat)', slug: 'anatomy/heartbeat' },
						{ label: 'Hippocampus (Knowledge System)', slug: 'anatomy/knowledge' },
						{ label: 'Working Memory (GEMINI.md)', slug: 'anatomy/memory' },
					],
				},
				{
					label: 'Learned Skills',
					items: [
						{ label: 'Extensions (MCP)', slug: 'skills/extensions' },
						{ label: 'Self-Modification', slug: 'skills/self-modification' },
					],
				},
			],
			customCss: [
				'./src/styles/custom.css',
			],
		}),
	],
});

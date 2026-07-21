import { type AgentTool } from '@earendil-works/pi-agent-core';
import { Type } from 'typebox';
import { describe, expect, it, vi } from 'vitest';

import { routeMcpTools } from '../../tools/mcp-tool-router.js';

function createTool(name: string, description: string): AgentTool {
    return {
        description,
        execute: vi.fn().mockResolvedValue({
            content: [{ type: 'text', text: `${name} result` }],
            details: { source: name }
        }),
        label: name,
        name,
        parameters: Type.Object({ value: Type.String() })
    };
}

describe('routeMcpTools', () => {
    it('keeps core tools direct and discovers only relevant optional schemas', async () => {
        // ARRANGE
        const memory = createTool('manage_facts', 'Manage durable memory');
        const browser = createTool('browser_navigate', 'Navigate a browser to a URL');
        const portfolio = createTool('questrade_accounts', 'Read Questrade account balances');

        // ACT
        const routed = routeMcpTools([memory, browser, portfolio]);
        const discover = routed.routerTools.find(({ name }) => name === 'discover_extension_tools');
        if (!discover) throw new Error('Discovery tool was not created');
        const discovery = await discover.execute('call-1', { query: 'browser navigation' });

        // ASSERT
        expect(routed.directTools).toEqual([memory]);
        expect(routed.routerTools).toHaveLength(2);
        expect(discovery.content[0]).toMatchObject({
            type: 'text',
            text: expect.stringContaining('browser_navigate')
        });
        expect(discovery.content[0]).not.toMatchObject({
            text: expect.stringContaining('questrade_accounts')
        });
    });

    it('invokes an optional tool by exact discovered name', async () => {
        // ARRANGE
        const browser = createTool('browser_navigate', 'Navigate a browser to a URL');
        const routed = routeMcpTools([browser]);
        const invoke = routed.routerTools.find(({ name }) => name === 'invoke_extension_tool');
        if (!invoke) throw new Error('Invocation tool was not created');

        // ACT
        const result = await invoke.execute('call-2', {
            arguments: { value: 'https://example.com' },
            name: 'browser_navigate'
        });

        // ASSERT
        expect(browser.execute).toHaveBeenCalledWith(
            'call-2',
            { value: 'https://example.com' },
            undefined,
            undefined
        );
        expect(result.content[0]).toMatchObject({ text: 'browser_navigate result' });
    });
});
